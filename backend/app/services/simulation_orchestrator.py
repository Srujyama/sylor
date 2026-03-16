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
"""
import asyncio
import uuid
import json
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

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
from app.models.simulation import SimulationConfig, SimulationResults


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


# ── Orchestrator ─────────────────────────────────────────────────────────────

class SimulationOrchestrator:
    """
    Coordinates the full simulation pipeline across all phases.
    Merges MiroFish's SimulationManager + Sylor's existing flow.
    """

    _projects: Dict[str, Project] = {}
    _tasks: Dict[str, Task] = {}

    # ── Project Management ───────────────────────────────────────────────────

    def create_project(self, name: str, category: str = "startup") -> Project:
        """Create a new orchestration project."""
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        project = Project(
            project_id=project_id,
            name=name,
            simulation_category=category,
        )
        self._projects[project_id] = project
        return project

    def get_project(self, project_id: str) -> Optional[Project]:
        return self._projects.get(project_id)

    def list_projects(self) -> List[Dict[str, Any]]:
        return sorted(
            [p.to_dict() for p in self._projects.values()],
            key=lambda x: x["created_at"],
            reverse=True,
        )

    def delete_project(self, project_id: str) -> bool:
        if project_id in self._projects:
            project = self._projects[project_id]
            # Clean up associated resources
            if project.graph_id:
                graph_builder.delete_graph(project.graph_id)
            if project.report_id:
                ReportAgent.delete_report(project.report_id)
            del self._projects[project_id]
            return True
        return False

    # ── Task Management (from MiroFish's TaskManager) ────────────────────────

    def _create_task(self, task_type: str) -> Task:
        task = Task(
            task_id=f"task_{uuid.uuid4().hex[:12]}",
            task_type=task_type,
        )
        self._tasks[task.task_id] = task
        return task

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

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
        project = self.get_project(project_id)
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
        project = self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.extracted_text:
            raise ValueError("No documents uploaded. Upload documents first.")

        task = self._create_task("graph_build")
        project.status = ProjectStatus.GRAPH_BUILDING

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

        try:
            # Create graph
            graph = await graph_builder.create_graph(
                project.name, project.simulation_category
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

    # ── Phase 3: Agent Profile Generation ────────────────────────────────────

    async def generate_profiles(
        self,
        project_id: str,
        use_llm: bool = True,
        max_profiles: int = 20,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """Generate agent profiles from knowledge graph."""
        project = self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        task = self._create_task("profile_generation")

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

    # ── Phase 4: Run Simulation ──────────────────────────────────────────────

    async def run_simulation(
        self,
        project_id: str,
        config: SimulationConfig,
        num_runs: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run Monte Carlo simulation using Sylor's engine."""
        project = self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        project.status = ProjectStatus.RUNNING
        project.simulation_config = config.model_dump()

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
            except Exception:
                pass

            project.simulation_results = results.model_dump()
            project.status = ProjectStatus.COMPLETED
            project.updated_at = datetime.utcnow().isoformat()

            return project.simulation_results

        except Exception as e:
            project.status = ProjectStatus.FAILED
            project.error = str(e)
            raise

    # ── Phase 5: Report Generation ───────────────────────────────────────────

    async def generate_report(
        self,
        project_id: str,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """Generate an analysis report from simulation results."""
        project = self.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.simulation_results:
            raise ValueError("No simulation results available. Run simulation first.")

        task = self._create_task("report_generation")

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
            )

            project.report_id = report.report_id
            task.status = TaskStatus.COMPLETED
            task.progress = 100.0
            task.result = {"report_id": report.report_id}

        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)

        project.updated_at = datetime.utcnow().isoformat()

    # ── Phase 6: Chat ────────────────────────────────────────────────────────

    async def chat_with_report(
        self,
        project_id: str,
        message: str,
    ) -> str:
        """Chat about a project's report."""
        project = self.get_project(project_id)
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
        project = self.create_project(name, config.category.value)

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
