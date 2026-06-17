"""
Unified Simulation Orchestrator for Sylor.
Combines MiroFish's multi-phase pipeline with Sylor's Monte Carlo engine.

This creates a unified workflow:
1. Document Upload -> Knowledge Graph (MiroFish-inspired)
2. Context Analysis -> AI-generated parameters (Sylor existing)
3. Agent Profile Generation (MiroFish-inspired, enhanced)
4. Monte Carlo Simulation (Sylor existing engine)
5. ReACT Report Generation (MiroFish-inspired)
6. Interactive Chat (MiroFish-inspired)

Improvements over MiroFish:
- Fully async (vs threading)
- Domain-agnostic (works for business, finance, biology, trend)
- Unified data model across all phases
- Real-time progress streaming via SSE
- Firestore persistence for tasks
"""
import asyncio
import logging
import uuid
import json
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)

from app.services.knowledge_graph import (
    KnowledgeGraphBuilder, graph_builder, KnowledgeGraph, Ontology
)
from app.services.text_processor import TextProcessor, ProcessedDocument
from app.services.agent_profile_generator import (
    AgentProfileGenerator, profile_generator, AgentProfile
)
from app.services.report_agent import ReportAgent, report_agent, Report
from app.services.simulation_engine import SimulationEngine
from app.services.llm_client import llm_client
from app.models.simulation import (
    SimulationConfig, SimulationResults, SimulationVariable, AgentConfig,
    SimulationCategory, SimulationStatus,
)

# Strong references to in-flight simulation tasks. asyncio only keeps weak
# references to tasks, so without this set a background run could be
# garbage-collected mid-flight. Tasks remove themselves on completion.
_simulation_tasks: set = set()


# ── Project & Task Models (adapted from MiroFish) ───────────────────────────

class ProjectStatus(str, Enum):
    CREATED = "created"
    DOCUMENTS_UPLOADED = "documents_uploaded"
    GRAPH_BUILDING = "graph_building"
    GRAPH_READY = "graph_ready"
    PROFILES_GENERATED = "profiles_generated"
    SIMULATION_READY = "simulation_ready"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Task:
    """Background task tracking (from MiroFish's TaskManager)."""
    task_id: str
    task_type: str
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    message: str = ""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    user_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "user_id": self.user_id,
        }


@dataclass
class Project:
    """
    Orchestration project combining all phases.
    Adapted from MiroFish's Project model with Sylor-specific additions.
    """
    project_id: str
    name: str
    status: ProjectStatus = ProjectStatus.CREATED
    simulation_category: str = "startup"
    user_id: Optional[str] = None

    # Document phase
    documents: List[Dict[str, Any]] = field(default_factory=list)
    extracted_text: str = ""
    text_stats: Optional[Dict[str, Any]] = None

    # Graph phase
    graph_id: Optional[str] = None
    ontology: Optional[Dict[str, Any]] = None

    # Profile phase
    agent_profiles: List[Dict[str, Any]] = field(default_factory=list)

    # Simulation phase
    simulation_id: Optional[str] = None
    simulation_config: Optional[Dict[str, Any]] = None
    simulation_results: Optional[Dict[str, Any]] = None

    # Report phase
    report_id: Optional[str] = None

    # Metadata
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "name": self.name,
            "status": self.status.value,
            "simulation_category": self.simulation_category,
            "user_id": self.user_id,
            "documents": self.documents,
            "text_stats": self.text_stats,
            "graph_id": self.graph_id,
            "ontology": self.ontology,
            "agent_profiles_count": len(self.agent_profiles),
            "simulation_id": self.simulation_id,
            "simulation_results_available": self.simulation_results is not None,
            "report_id": self.report_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error": self.error,
        }

    def to_firestore_dict(self) -> Dict[str, Any]:
        """Full serialisation for Firestore persistence (hot-cache parity).

        Mirrors the persistence pattern used by ``KnowledgeGraph`` — every
        field needed to reconstruct the project, not just the API summary.
        """
        return {
            "project_id": self.project_id,
            "name": self.name,
            "status": self.status.value,
            "simulation_category": self.simulation_category,
            "user_id": self.user_id,
            "documents": self.documents,
            "extracted_text": self.extracted_text,
            "text_stats": self.text_stats,
            "graph_id": self.graph_id,
            "ontology": self.ontology,
            "agent_profiles": self.agent_profiles,
            "simulation_id": self.simulation_id,
            "simulation_config": self.simulation_config,
            "simulation_results": self.simulation_results,
            "report_id": self.report_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error": self.error,
        }

    @classmethod
    def from_firestore_dict(cls, data: Dict[str, Any]) -> "Project":
        """Reconstruct a Project from a Firestore document."""
        return cls(
            project_id=data["project_id"],
            name=data.get("name", ""),
            status=ProjectStatus(data.get("status", "created")),
            simulation_category=data.get("simulation_category", "startup"),
            user_id=data.get("user_id"),
            documents=data.get("documents", []),
            extracted_text=data.get("extracted_text", ""),
            text_stats=data.get("text_stats"),
            graph_id=data.get("graph_id"),
            ontology=data.get("ontology"),
            agent_profiles=data.get("agent_profiles", []),
            simulation_id=data.get("simulation_id"),
            simulation_config=data.get("simulation_config"),
            simulation_results=data.get("simulation_results"),
            report_id=data.get("report_id"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            error=data.get("error"),
        )


# ── Orchestrator ─────────────────────────────────────────────────────────────

class SimulationOrchestrator:
    """
    Coordinates the full simulation pipeline across all phases.
    Merges MiroFish's SimulationManager + Sylor's existing flow.
    """

    # Projects live in Firestore for durability (Fly autoscales to zero, which
    # would otherwise lose the entire in-memory store). The dict is a hot cache.
    PROJECTS_COLLECTION = "projects"

    _projects: Dict[str, Project] = {}
    _tasks: Dict[str, Task] = {}

    # ── Project persistence helpers ──────────────────────────────────────────

    async def _persist_project(self, project: Project) -> None:
        """Save or overwrite a project document in Firestore."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            doc_ref = db.collection(self.PROJECTS_COLLECTION).document(project.project_id)
            await doc_ref.set(project.to_firestore_dict())
        except Exception as exc:
            logger.warning("Failed to persist project %s to Firestore: %s", project.project_id, exc)

    async def _load_project_from_firestore(self, project_id: str) -> Optional[Project]:
        """Load a project from Firestore and populate the in-memory cache."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            snap = await db.collection(self.PROJECTS_COLLECTION).document(project_id).get()
            if not snap.exists:
                return None
            project = Project.from_firestore_dict(snap.to_dict())
            self._projects[project_id] = project
            return project
        except Exception as exc:
            logger.warning("Failed to load project %s from Firestore: %s", project_id, exc)
            return None

    async def _delete_project_from_firestore(self, project_id: str) -> None:
        """Delete a project document from Firestore."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            await db.collection(self.PROJECTS_COLLECTION).document(project_id).delete()
        except Exception as exc:
            logger.warning("Failed to delete project %s from Firestore: %s", project_id, exc)

    # ── Project Management ───────────────────────────────────────────────────

    async def create_project(
        self, name: str, category: str = "startup", user_id: Optional[str] = None,
    ) -> Project:
        """Create a new orchestration project owned by *user_id* and persist it."""
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        project = Project(
            project_id=project_id,
            name=name,
            simulation_category=category,
            user_id=user_id,
        )
        self._projects[project_id] = project
        await self._persist_project(project)
        return project

    async def get_project(self, project_id: str) -> Optional[Project]:
        """Return a project, treating Firestore as the source of truth.

        The in-memory ``_projects`` dict is a write-through accelerator, not an
        authoritative store: under Fly autoscaling more than one machine may be
        live, and every project mutation is persisted to Firestore. We therefore
        always reconcile against Firestore so a project updated or deleted on
        another instance is not shadowed by a stale local cache entry. If the
        Firestore read fails (transient error), we fall back to the cached copy
        rather than reporting the project as missing.
        """
        refreshed = await self._load_project_from_firestore(project_id)
        if refreshed is not None:
            return refreshed
        # _load returns None both for a genuinely-absent doc and for a transient
        # read failure. Distinguish: if the doc truly does not exist, drop any
        # stale cache entry so a cross-instance delete is honored.
        existed = await self._project_doc_exists(project_id)
        if existed is False:
            self._projects.pop(project_id, None)
            return None
        # Unknown (read error) — serve the cached copy if we have one.
        return self._projects.get(project_id)

    async def _project_doc_exists(self, project_id: str) -> Optional[bool]:
        """Return True/False if Firestore is reachable, None on read error."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            snap = await db.collection(self.PROJECTS_COLLECTION).document(project_id).get()
            return bool(snap.exists)
        except Exception as exc:
            logger.warning("Project existence check failed for %s: %s", project_id, exc)
            return None

    async def list_projects(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List projects, scoped to *user_id* (queried from Firestore)."""
        if user_id is not None:
            try:
                from app.services.firebase_admin import query_collection
                docs = await query_collection(
                    self.PROJECTS_COLLECTION,
                    [("user_id", "==", user_id)],
                )
                # Firestore is authoritative: refresh the cache from the query
                # result (overwriting stale entries) and prune cached projects
                # for this user that no longer exist in Firestore (e.g. deleted
                # on another instance).
                fresh_ids = set()
                for doc in docs:
                    pid = doc.get("project_id")
                    if pid:
                        fresh_ids.add(pid)
                        self._projects[pid] = Project.from_firestore_dict(doc)
                for pid in [
                    p.project_id
                    for p in list(self._projects.values())
                    if p.user_id == user_id and p.project_id not in fresh_ids
                ]:
                    self._projects.pop(pid, None)
            except Exception as exc:
                logger.warning("Firestore query failed in list_projects: %s", exc)

            projects = [p for p in self._projects.values() if p.user_id == user_id]
        else:
            projects = list(self._projects.values())

        return sorted(
            [p.to_dict() for p in projects],
            key=lambda x: x["created_at"],
            reverse=True,
        )

    async def delete_project(self, project_id: str) -> bool:
        project = await self.get_project(project_id)
        if project is None:
            return False
        # Clean up associated resources
        if project.graph_id:
            await graph_builder.delete_graph(project.graph_id)
        if project.report_id:
            await ReportAgent.delete_report(project.report_id)
        self._projects.pop(project_id, None)
        await self._delete_project_from_firestore(project_id)
        return True

    # ── Task Management (from MiroFish's TaskManager) ────────────────────────

    TASK_COLLECTION = "tasks"

    async def _persist_task(self, task: Task) -> None:
        """Save or update a task document in Firestore."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            doc_ref = db.collection(self.TASK_COLLECTION).document(task.task_id)
            await doc_ref.set(task.to_dict())
        except Exception as exc:
            logger.warning("Failed to persist task %s to Firestore: %s", task.task_id, exc)

    async def _load_task_from_firestore(self, task_id: str) -> Optional[Task]:
        """Load a task from Firestore into the in-memory cache."""
        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            snap = await db.collection(self.TASK_COLLECTION).document(task_id).get()
            if not snap.exists:
                return None
            data = snap.to_dict()
            task = Task(
                task_id=data["task_id"],
                task_type=data.get("task_type", ""),
                status=TaskStatus(data.get("status", "pending")),
                progress=data.get("progress", 0.0),
                message=data.get("message", ""),
                result=data.get("result"),
                error=data.get("error"),
                created_at=data.get("created_at", ""),
                user_id=data.get("user_id"),
            )
            self._tasks[task_id] = task
            return task
        except Exception as exc:
            logger.warning("Failed to load task %s from Firestore: %s", task_id, exc)
            return None

    async def _create_task(self, task_type: str, user_id: Optional[str] = None) -> Task:
        task = Task(
            task_id=f"task_{uuid.uuid4().hex[:12]}",
            task_type=task_type,
            user_id=user_id,
        )
        self._tasks[task.task_id] = task
        await self._persist_task(task)
        return task

    async def _update_task_status(self, task: Task) -> None:
        """Persist current task state to Firestore (called on status transitions)."""
        await self._persist_task(task)

    async def get_task(self, task_id: str) -> Optional[Task]:
        task = self._tasks.get(task_id)
        if task is not None:
            return task
        return await self._load_task_from_firestore(task_id)

    # ── Phase 1: Document Processing ─────────────────────────────────────────

    async def upload_documents(
        self,
        project_id: str,
        files: List[tuple[str, bytes]],  # (filename, content)
    ) -> Dict[str, Any]:
        """
        Process uploaded documents.
        Adapted from MiroFish's graph.py upload flow.
        """
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        all_text_parts = []

        for filename, content in files:
            processed = TextProcessor.process_document(content, filename)
            project.documents.append({
                "filename": filename,
                "size": len(content),
                "text_length": len(processed.text),
                "stats": {
                    "words": processed.stats.total_words,
                    "sentences": processed.stats.total_sentences,
                    "language": processed.stats.language_hint,
                },
            })
            all_text_parts.append(processed.text)

        project.extracted_text = "\n\n---\n\n".join(all_text_parts)
        text_stats = TextProcessor.get_stats(project.extracted_text)
        project.text_stats = {
            "total_chars": text_stats.total_chars,
            "total_words": text_stats.total_words,
            "estimated_tokens": text_stats.estimated_tokens,
        }
        project.status = ProjectStatus.DOCUMENTS_UPLOADED
        project.updated_at = datetime.utcnow().isoformat()
        await self._persist_project(project)

        return {
            "project_id": project_id,
            "documents_processed": len(files),
            "text_stats": project.text_stats,
        }

    # ── Phase 2: Knowledge Graph Building ────────────────────────────────────

    async def build_knowledge_graph(
        self,
        project_id: str,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """
        Build knowledge graph from uploaded documents.
        Returns task_id for progress tracking.
        """
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.extracted_text:
            raise ValueError("No documents uploaded. Upload documents first.")

        task = await self._create_task("graph_build", user_id=project.user_id)
        project.status = ProjectStatus.GRAPH_BUILDING
        await self._persist_project(project)

        # Run in background
        asyncio.create_task(
            self._build_graph_worker(project, task, progress_callback)
        )

        return task.task_id

    async def _build_graph_worker(
        self,
        project: Project,
        task: Task,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ):
        """Background graph building worker."""
        task.status = TaskStatus.PROCESSING
        await self._update_task_status(task)

        try:
            # Create graph (owned by the project's user)
            graph = await graph_builder.create_graph(
                project.name, project.simulation_category, user_id=project.user_id
            )
            project.graph_id = graph.graph_id

            # Build with progress
            async def update_progress(pct: float, msg: str):
                task.progress = pct
                task.message = msg
                if progress_callback:
                    await progress_callback(pct, msg)

            await graph_builder.build_graph(
                graph_id=graph.graph_id,
                text=project.extracted_text,
                simulation_category=project.simulation_category,
                progress_callback=update_progress,
            )

            # Save ontology
            if graph.ontology:
                project.ontology = graph.ontology.to_dict()

            project.status = ProjectStatus.GRAPH_READY
            task.status = TaskStatus.COMPLETED
            task.progress = 100.0
            task.result = {
                "graph_id": graph.graph_id,
                "node_count": len(graph.nodes),
                "edge_count": len(graph.edges),
            }

        except Exception as e:
            project.status = ProjectStatus.FAILED
            project.error = str(e)
            task.status = TaskStatus.FAILED
            task.error = str(e)

        project.updated_at = datetime.utcnow().isoformat()
        await self._persist_project(project)
        await self._update_task_status(task)

    # ── Phase 3: Agent Profile Generation ────────────────────────────────────

    async def generate_profiles(
        self,
        project_id: str,
        use_llm: bool = True,
        max_profiles: int = 20,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """Generate agent profiles from knowledge graph."""
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        task = await self._create_task("profile_generation", user_id=project.user_id)

        asyncio.create_task(
            self._generate_profiles_worker(
                project, task, use_llm, max_profiles, progress_callback
            )
        )

        return task.task_id

    async def _generate_profiles_worker(
        self,
        project: Project,
        task: Task,
        use_llm: bool,
        max_profiles: int,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ):
        """Background profile generation worker."""
        task.status = TaskStatus.PROCESSING
        await self._update_task_status(task)

        try:
            async def update_progress(pct: float, msg: str):
                task.progress = pct
                task.message = msg
                if progress_callback:
                    await progress_callback(pct, msg)

            if project.graph_id:
                profiles = await profile_generator.generate_profiles_from_graph(
                    graph_id=project.graph_id,
                    simulation_category=project.simulation_category,
                    max_profiles=max_profiles,
                    use_llm=use_llm,
                    progress_callback=update_progress,
                )
            else:
                profiles = []

            project.agent_profiles = [p.to_dict() for p in profiles]
            project.status = ProjectStatus.PROFILES_GENERATED
            task.status = TaskStatus.COMPLETED
            task.progress = 100.0
            task.result = {"profile_count": len(profiles)}

        except Exception as e:
            project.status = ProjectStatus.FAILED
            project.error = str(e)
            task.status = TaskStatus.FAILED
            task.error = str(e)

        project.updated_at = datetime.utcnow().isoformat()
        await self._persist_project(project)
        await self._update_task_status(task)

    # ── Phase 4: Run Simulation ──────────────────────────────────────────────

    async def run_simulation(
        self,
        project_id: str,
        config: SimulationConfig,
        num_runs: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run Monte Carlo simulation synchronously using Sylor's engine.

        Used by the quick (no-document) pipeline. The pollable, simulation-doc
        backed pipeline phase is ``run_simulation_pipeline`` below.
        """
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        project.status = ProjectStatus.RUNNING
        project.simulation_config = config.model_dump()
        await self._persist_project(project)

        try:
            engine = SimulationEngine(config)
            results = await engine.run(num_runs=num_runs)

            # Enhance with AI insights
            try:
                from app.services.ai_insights import generate_ai_insights
                ai_data = await generate_ai_insights(
                    config, results,
                    company_context=config.company_context,
                )
                results.key_insights = ai_data.get("key_insights", results.key_insights)
                results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
                results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
            except Exception as exc:
                logger.warning(
                    "AI insights enhancement failed for project %s: %s",
                    project_id, exc,
                )

            project.simulation_results = results.model_dump()
            project.status = ProjectStatus.COMPLETED
            project.updated_at = datetime.utcnow().isoformat()
            await self._persist_project(project)

            return project.simulation_results

        except Exception as e:
            project.status = ProjectStatus.FAILED
            project.error = str(e)
            await self._persist_project(project)
            raise

    # ── Phase 4 (pipeline): pollable, simulation-doc backed run ──────────────

    def _build_config_from_project(
        self,
        project: Project,
        num_runs: Optional[int],
        time_horizon: Optional[int],
        variable_overrides: Optional[Dict[str, float]],
    ) -> SimulationConfig:
        """Build a SimulationConfig from a project for the run-simulation phase.

        - category: from the project's simulation_category (falls back to startup)
        - agents:   from generated agent profiles (via the to_monte_carlo_config
                    bridge) when present, else sensible category defaults
        - variables: category defaults, then overlaid with request overrides
        """
        category = self._resolve_category(project.simulation_category)

        default_vars, default_agents = self._category_defaults(category)

        # Variables: start from defaults, then apply request overrides on top.
        variables = list(default_vars)
        if variable_overrides:
            by_name = {v.name: v for v in variables}
            for name, value in variable_overrides.items():
                if name in by_name:
                    by_name[name].value = float(value)
                else:
                    variables.append(SimulationVariable(
                        name=name, label=name.replace("_", " ").title(), value=float(value),
                    ))

        # Agents: prefer the project's generated profiles (persona-driven).
        agents: List[AgentConfig] = []
        if project.agent_profiles:
            from app.services.agent_profile_generator import AgentProfile
            for raw in project.agent_profiles:
                try:
                    profile = AgentProfile.from_dict(raw)
                    agents.append(AgentConfig(**profile.to_monte_carlo_config()))
                except Exception as exc:
                    logger.warning("Skipping unconvertible agent profile: %s", exc)
        if not agents:
            agents = list(default_agents)

        return SimulationConfig(
            name=project.name or "Simulation",
            category=category,
            variables=variables,
            agents=agents,
            num_runs=num_runs or 1000,
            time_horizon=time_horizon or 12,
        )

    @staticmethod
    def _resolve_category(raw: Optional[str]) -> SimulationCategory:
        try:
            return SimulationCategory(raw)
        except (ValueError, TypeError):
            return SimulationCategory.STARTUP

    @staticmethod
    def _category_defaults(category: SimulationCategory):
        """Sensible default variables + agents per domain when none are given."""
        if category == SimulationCategory.FINANCE:
            variables = [
                SimulationVariable(name="portfolio_value", label="Capital", type="currency", value=100000),
                SimulationVariable(name="volatility", label="Volatility", type="percentage", value=20),
                SimulationVariable(name="num_assets", label="Assets", value=5),
            ]
            agents = [
                AgentConfig(type="trader", name="Traders", count=3, sensitivity=0.7),
                AgentConfig(type="market_maker", name="Market Maker", count=1, sensitivity=0.5),
            ]
        elif category == SimulationCategory.BIOLOGY:
            variables = [
                SimulationVariable(name="num_molecules", label="Molecules", value=128),
                SimulationVariable(name="sim_steps", label="Steps", value=500),
                SimulationVariable(name="temperature", label="Temperature", value=310),
                SimulationVariable(name="ph_level", label="pH", value=7.4),
                SimulationVariable(name="binding_affinity", label="Kd", value=10),
                SimulationVariable(name="concentration", label="Concentration", value=100),
            ]
            agents = [
                AgentConfig(type="molecule", name="Ligand", count=128, sensitivity=0.7),
                AgentConfig(type="enzyme", name="Enzyme", count=5, sensitivity=0.6),
            ]
        elif category == SimulationCategory.TREND:
            variables = [
                SimulationVariable(name="forecast_periods", label="Periods", value=24),
                SimulationVariable(name="confidence_level", label="Confidence", value=95),
                SimulationVariable(name="trend_strength", label="Trend", value=50),
                SimulationVariable(name="seasonality_period", label="Season", value=12),
                SimulationVariable(name="noise_level", label="Noise", value=15),
            ]
            agents = [
                AgentConfig(type="data_stream", name="Signal", count=3, sensitivity=0.7),
            ]
        else:  # startup / business defaults
            variables = [
                SimulationVariable(name="budget", label="Budget", type="currency", value=50000),
                SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
                SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
                SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
                SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=3),
            ]
            agents = [
                AgentConfig(type="customer", name="Customers", count=100, sensitivity=0.7),
                AgentConfig(type="competitor", name="Competitor", count=1, sensitivity=0.5),
                AgentConfig(type="market", name="Market", count=1, sensitivity=0.6),
            ]
        return variables, agents

    async def run_simulation_pipeline(
        self,
        project_id: str,
        num_runs: Optional[int] = None,
        time_horizon: Optional[int] = None,
        variable_overrides: Optional[Dict[str, float]] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Pipeline phase 4: kick off a pollable Monte Carlo run.

        Creates an owner-scoped ``simulations`` document (same shape the
        simulations router writes), launches the engine in a tracked background
        task, and returns immediately with a task_id + simulation_id. The task
        is pollable via GET /api/projects/tasks/{task_id}; on completion
        task.result == {"simulation_id": ...}.
        """
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        config = self._build_config_from_project(
            project, num_runs, time_horizon, variable_overrides
        )

        sim_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        sim_doc = {
            "id": sim_id,
            "user_id": project.user_id,
            "name": project.name or "Simulation",
            "description": None,
            "category": config.category.value,
            "config": config.model_dump(mode="json"),
            "status": SimulationStatus.RUNNING.value,
            "results": None,
            "created_at": now,
            "updated_at": now,
            "run_count": 0,
            "project_id": project.project_id,  # cross-link sim -> project
        }

        try:
            from app.services.firebase_admin import get_db
            db = get_db()
            await db.collection("simulations").document(sim_id).set(sim_doc)
        except Exception as exc:
            logger.warning("Failed to create simulation doc %s: %s", sim_id, exc)

        task = await self._create_task("project_simulation", user_id=project.user_id)

        # Cross-link project -> simulation and mark running.
        project.simulation_id = sim_id
        project.simulation_config = config.model_dump()
        project.status = ProjectStatus.RUNNING
        project.updated_at = now
        await self._persist_project(project)

        bg = asyncio.create_task(self._run_simulation_pipeline_worker(
            project, task, sim_id, config,
            num_runs=config.num_runs, variable_overrides=variable_overrides,
        ))
        _simulation_tasks.add(bg)
        bg.add_done_callback(_simulation_tasks.discard)

        return {
            "task_id": task.task_id,
            "simulation_id": sim_id,
            "status": "running",
            "message": f"Simulation started. Poll /api/projects/tasks/{task.task_id} for status.",
        }

    async def _run_simulation_pipeline_worker(
        self,
        project: Project,
        task: Task,
        sim_id: str,
        config: SimulationConfig,
        num_runs: Optional[int],
        variable_overrides: Optional[Dict[str, float]],
    ):
        """Background worker: run the engine and write results to both docs."""
        from app.services.firebase_admin import update_document

        task.status = TaskStatus.PROCESSING
        await self._update_task_status(task)

        try:
            engine = SimulationEngine(config)
            results = await engine.run(
                num_runs=num_runs, variable_overrides=variable_overrides
            )

            # Best-effort AI insight enhancement.
            try:
                from app.services.ai_insights import generate_ai_insights
                ai_data = await generate_ai_insights(
                    config, results, company_context=config.company_context,
                )
                results.key_insights = ai_data.get("key_insights", results.key_insights)
                results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
                results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
            except Exception as exc:
                logger.warning("AI insights failed for simulation %s: %s", sim_id, exc)

            now = datetime.utcnow().isoformat()
            await update_document("simulations", sim_id, {
                "status": SimulationStatus.COMPLETED.value,
                "results": results.model_dump(mode="json"),
                "run_count": 1,
                "updated_at": now,
            })

            # Record run history (best-effort, never raises)
            from app.services.run_history import record_run
            await record_run(
                sim_id, project.user_id, num_runs or config.num_runs, results,
                variable_overrides=variable_overrides,
            )

            project.simulation_results = results.model_dump()
            project.status = ProjectStatus.COMPLETED
            project.updated_at = now
            await self._persist_project(project)

            task.status = TaskStatus.COMPLETED
            task.progress = 100.0
            task.result = {"simulation_id": sim_id}

        except Exception as e:
            now = datetime.utcnow().isoformat()
            try:
                await update_document("simulations", sim_id, {
                    "status": SimulationStatus.FAILED.value,
                    "error": str(e),
                    "updated_at": now,
                })
            except Exception as exc:
                logger.warning("Failed to mark simulation %s failed: %s", sim_id, exc)
            project.status = ProjectStatus.FAILED
            project.error = str(e)
            project.updated_at = now
            await self._persist_project(project)
            task.status = TaskStatus.FAILED
            task.error = str(e)

        await self._update_task_status(task)

    # ── Phase 5: Report Generation ───────────────────────────────────────────

    async def generate_report(
        self,
        project_id: str,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """Generate an analysis report from simulation results."""
        project = await self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.simulation_results:
            raise ValueError("No simulation results available. Run simulation first.")

        task = await self._create_task("report_generation", user_id=project.user_id)

        asyncio.create_task(
            self._generate_report_worker(project, task, progress_callback)
        )

        return task.task_id

    async def _generate_report_worker(
        self,
        project: Project,
        task: Task,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ):
        """Background report generation worker."""
        task.status = TaskStatus.PROCESSING
        await self._update_task_status(task)

        try:
            async def update_progress(pct: float, msg: str):
                task.progress = pct
                task.message = msg
                if progress_callback:
                    await progress_callback(pct, msg)

            agent = ReportAgent(graph_id=project.graph_id)
            report = await agent.generate_report(
                simulation_id=project.simulation_id or project.project_id,
                simulation_data=project.simulation_results,
                category=project.simulation_category,
                graph_id=project.graph_id,
                progress_callback=update_progress,
                user_id=project.user_id,
            )

            project.report_id = report.report_id
            task.status = TaskStatus.COMPLETED
            task.progress = 100.0
            task.result = {"report_id": report.report_id}

        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)

        project.updated_at = datetime.utcnow().isoformat()
        await self._persist_project(project)
        await self._update_task_status(task)

    # ── Phase 6: Chat ────────────────────────────────────────────────────────

    async def chat_with_report(
        self,
        project_id: str,
        message: str,
    ) -> str:
        """Chat about a project's report."""
        project = await self.get_project(project_id)
        if not project or not project.report_id:
            return "No report available for this project."

        agent = ReportAgent(graph_id=project.graph_id)
        return await agent.chat(
            report_id=project.report_id,
            message=message,
            simulation_data=project.simulation_results,
        )

    # ── Quick Pipeline (no documents) ────────────────────────────────────────

    async def quick_simulate(
        self,
        name: str,
        config: SimulationConfig,
        company_context: Optional[Dict[str, Any]] = None,
        generate_profiles: bool = True,
        generate_report_flag: bool = True,
    ) -> Dict[str, Any]:
        """
        Quick pipeline without document upload.
        Runs simulation -> generates profiles -> generates report.
        """
        project = await self.create_project(name, config.category.value)

        # Generate agent profiles from config
        if generate_profiles:
            profiles = await profile_generator.generate_profiles_standalone(
                simulation_category=config.category.value,
                agent_configs=[a.model_dump() for a in config.agents],
                company_context=company_context,
            )
            project.agent_profiles = [p.to_dict() for p in profiles]

        # Run simulation
        results = await self.run_simulation(project.project_id, config)

        result = {
            "project_id": project.project_id,
            "simulation_results": results,
            "agent_profiles": project.agent_profiles if generate_profiles else [],
        }

        # Generate report
        if generate_report_flag and results:
            agent = ReportAgent(graph_id=project.graph_id)
            report = await agent.generate_report(
                simulation_id=project.project_id,
                simulation_data=results,
                category=config.category.value,
            )
            project.report_id = report.report_id
            result["report"] = report.to_dict()

        return result


# Singleton
orchestrator = SimulationOrchestrator()
