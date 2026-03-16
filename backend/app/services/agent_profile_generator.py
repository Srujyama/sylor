"""
LLM-powered Agent Profile Generator for Sylor.
Adapted from MiroFish's oasis_profile_generator.py with improvements:
- Async-first with concurrent profile generation
- Anthropic Claude for richer personas (vs generic OpenAI-compat)
- Domain-specific profile templates for Sylor's business/finance/biology domains
- Generates profiles usable by BOTH Monte Carlo engine AND narrative simulation
- Graceful degradation chain: LLM -> rule-based -> minimal fallback (MiroFish pattern)
"""
import asyncio
import json
import uuid
import random
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from enum import Enum

from app.services.llm_client import LLMClient, llm_client
from app.services.knowledge_graph import EntityNode, KnowledgeGraphBuilder, graph_builder


@dataclass
class AgentProfile:
    """
    Rich agent profile combining MiroFish's persona depth with Sylor's agent types.
    Usable by both Monte Carlo engine (numeric params) and narrative simulation (persona).
    """
    agent_id: str
    name: str
    agent_type: str  # Sylor agent type (customer, competitor, etc.)
    entity_name: Optional[str] = None  # Source entity from knowledge graph

    # Persona (from MiroFish)
    description: str = ""
    personality: str = ""
    goals: List[str] = field(default_factory=list)
    background: str = ""
    decision_style: str = "balanced"  # aggressive, conservative, balanced, reactive

    # Behavioral parameters (for Monte Carlo)
    sensitivity: float = 0.7
    activity_level: float = 0.5  # 0-1 how active (from MiroFish)
    influence_weight: float = 0.5  # 0-1 how influential
    sentiment_bias: float = 0.0  # -1 to 1 (negative to positive)
    risk_tolerance: float = 0.5  # 0-1

    # Interaction rules (for narrative simulation)
    behavior_rules: List[str] = field(default_factory=list)
    interaction_patterns: List[str] = field(default_factory=list)
    memory: List[str] = field(default_factory=list)  # Key memories (from MiroFish)

    # Metadata
    source: str = "generated"  # "generated", "graph_entity", "template", "rule_based"
    entity_uuid: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "agent_type": self.agent_type,
            "entity_name": self.entity_name,
            "description": self.description,
            "personality": self.personality,
            "goals": self.goals,
            "background": self.background,
            "decision_style": self.decision_style,
            "sensitivity": self.sensitivity,
            "activity_level": self.activity_level,
            "influence_weight": self.influence_weight,
            "sentiment_bias": self.sentiment_bias,
            "risk_tolerance": self.risk_tolerance,
            "behavior_rules": self.behavior_rules,
            "interaction_patterns": self.interaction_patterns,
            "memory": self.memory,
            "source": self.source,
            "entity_uuid": self.entity_uuid,
        }

    def to_monte_carlo_config(self) -> Dict[str, Any]:
        """Convert to config usable by Sylor's SimulationEngine."""
        return {
            "type": self.agent_type,
            "name": self.name,
            "count": 1,
            "sensitivity": self.sensitivity,
            "behavior_rules": self.behavior_rules,
        }


class AgentProfileGenerator:
    """
    Generates rich agent profiles from knowledge graph entities or from scratch.
    Adapted from MiroFish's OasisProfileGenerator with domain-specific improvements.
    """

    # Domain-specific personality templates (from MiroFish pattern, adapted for Sylor)
    PERSONALITY_TEMPLATES = {
        "customer": {
            "aggressive": {"sensitivity": 0.9, "activity": 0.8, "risk_tolerance": 0.3},
            "conservative": {"sensitivity": 0.4, "activity": 0.3, "risk_tolerance": 0.8},
            "balanced": {"sensitivity": 0.6, "activity": 0.5, "risk_tolerance": 0.5},
        },
        "competitor": {
            "aggressive": {"sensitivity": 0.95, "activity": 0.9, "risk_tolerance": 0.2},
            "conservative": {"sensitivity": 0.5, "activity": 0.4, "risk_tolerance": 0.7},
            "reactive": {"sensitivity": 0.8, "activity": 0.6, "risk_tolerance": 0.4},
        },
        "investor": {
            "aggressive": {"sensitivity": 0.85, "activity": 0.7, "risk_tolerance": 0.2},
            "conservative": {"sensitivity": 0.4, "activity": 0.3, "risk_tolerance": 0.9},
            "balanced": {"sensitivity": 0.6, "activity": 0.5, "risk_tolerance": 0.5},
        },
        "trader": {
            "aggressive": {"sensitivity": 0.9, "activity": 0.95, "risk_tolerance": 0.15},
            "conservative": {"sensitivity": 0.5, "activity": 0.4, "risk_tolerance": 0.7},
            "balanced": {"sensitivity": 0.7, "activity": 0.7, "risk_tolerance": 0.4},
        },
    }

    def __init__(self, client: Optional[LLMClient] = None):
        self.llm = client or llm_client

    async def generate_profiles_from_graph(
        self,
        graph_id: str,
        simulation_category: str = "startup",
        max_profiles: int = 20,
        use_llm: bool = True,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> List[AgentProfile]:
        """
        Generate agent profiles from knowledge graph entities.
        Follows MiroFish pattern: read entities -> generate profiles -> parallel execution.
        """
        graph = graph_builder.get_graph(graph_id)
        if not graph:
            raise ValueError(f"Graph {graph_id} not found")

        entities = list(graph.nodes.values())[:max_profiles]
        if not entities:
            return []

        if progress_callback:
            await progress_callback(10.0, f"Generating profiles for {len(entities)} entities...")

        profiles = []
        total = len(entities)

        # Generate profiles concurrently (MiroFish uses ThreadPoolExecutor; we use asyncio)
        semaphore = asyncio.Semaphore(5)  # Limit concurrent LLM calls

        async def gen_profile(entity: EntityNode, idx: int) -> AgentProfile:
            async with semaphore:
                try:
                    if use_llm:
                        profile = await self._generate_profile_llm(
                            entity, simulation_category
                        )
                    else:
                        profile = self._generate_profile_rule_based(
                            entity, simulation_category
                        )
                except Exception:
                    # Graceful degradation (MiroFish pattern)
                    profile = self._generate_profile_rule_based(
                        entity, simulation_category
                    )

                if progress_callback:
                    pct = 10 + (idx + 1) / total * 85
                    await progress_callback(pct, f"Generated profile: {entity.name}")

                return profile

        tasks = [gen_profile(entity, i) for i, entity in enumerate(entities)]
        profiles = await asyncio.gather(*tasks)

        if progress_callback:
            await progress_callback(100.0, f"Generated {len(profiles)} profiles")

        return list(profiles)

    async def generate_profiles_standalone(
        self,
        simulation_category: str,
        agent_configs: List[Dict[str, Any]],
        company_context: Optional[Dict[str, Any]] = None,
    ) -> List[AgentProfile]:
        """
        Generate profiles without a knowledge graph (from simulation config).
        Produces rich personas for each agent in the config.
        """
        profiles = []

        for config in agent_configs:
            agent_type = config.get("type", "market")
            count = config.get("count", 1)
            name = config.get("name", agent_type.title())

            if count <= 3:
                # Generate individual profiles for small counts
                for i in range(count):
                    profile = await self._generate_standalone_profile(
                        agent_type=agent_type,
                        agent_name=f"{name} #{i + 1}" if count > 1 else name,
                        category=simulation_category,
                        context=company_context,
                    )
                    profiles.append(profile)
            else:
                # Generate archetype profiles for large groups (from MiroFish pattern)
                archetypes = ["aggressive", "conservative", "balanced"]
                for arch in archetypes:
                    arch_count = count // len(archetypes)
                    if arch == archetypes[-1]:
                        arch_count = count - (count // len(archetypes)) * (len(archetypes) - 1)

                    profile = await self._generate_standalone_profile(
                        agent_type=agent_type,
                        agent_name=f"{name} ({arch})",
                        category=simulation_category,
                        context=company_context,
                        archetype=arch,
                    )
                    profile.description += f" Represents {arch_count} agents with {arch} behavior."
                    profiles.append(profile)

        return profiles

    async def _generate_profile_llm(
        self,
        entity: EntityNode,
        category: str,
    ) -> AgentProfile:
        """
        Generate a rich profile from an entity using Claude.
        Adapted from MiroFish's _generate_profile_with_llm.
        """
        # Build context from entity relationships (MiroFish pattern)
        context_parts = [f"Name: {entity.name}", f"Type: {entity.entity_type}"]
        if entity.summary:
            context_parts.append(f"Description: {entity.summary}")
        if entity.attributes:
            attrs = ", ".join(f"{k}: {v}" for k, v in entity.attributes.items())
            context_parts.append(f"Attributes: {attrs}")
        if entity.related_nodes:
            rels = ", ".join(f"{r['name']} ({r.get('relation', 'related')})" for r in entity.related_nodes[:5])
            context_parts.append(f"Key relationships: {rels}")

        entity_context = "\n".join(context_parts)

        # Map entity type to Sylor agent type
        agent_type = self._map_entity_to_agent_type(entity.entity_type, category)

        system_prompt = f"""You are creating a detailed agent profile for a {category} simulation.
The agent represents a real entity from the user's scenario data.

Generate a realistic, specific persona with decision-making parameters.
Return JSON:
{{
  "description": "2-3 sentence description of this agent's role and behavior",
  "personality": "Key personality traits affecting decisions",
  "goals": ["goal1", "goal2", "goal3"],
  "background": "Brief background relevant to simulation",
  "decision_style": "aggressive|conservative|balanced|reactive",
  "sensitivity": 0.0-1.0,
  "activity_level": 0.0-1.0,
  "influence_weight": 0.0-1.0,
  "sentiment_bias": -1.0 to 1.0,
  "risk_tolerance": 0.0-1.0,
  "behavior_rules": ["rule1", "rule2"],
  "interaction_patterns": ["pattern1", "pattern2"],
  "memory": ["key memory or fact 1", "key memory 2"]
}}"""

        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": f"Entity context:\n{entity_context}\n\nAgent type: {agent_type}\nSimulation domain: {category}"}],
                system=system_prompt,
                temperature=0.5,
                max_tokens=1000,
            )

            return AgentProfile(
                agent_id=f"agent_{uuid.uuid4().hex[:8]}",
                name=entity.name,
                agent_type=agent_type,
                entity_name=entity.name,
                entity_uuid=entity.uuid,
                description=result.get("description", ""),
                personality=result.get("personality", ""),
                goals=result.get("goals", []),
                background=result.get("background", ""),
                decision_style=result.get("decision_style", "balanced"),
                sensitivity=float(result.get("sensitivity", 0.7)),
                activity_level=float(result.get("activity_level", 0.5)),
                influence_weight=float(result.get("influence_weight", 0.5)),
                sentiment_bias=float(result.get("sentiment_bias", 0.0)),
                risk_tolerance=float(result.get("risk_tolerance", 0.5)),
                behavior_rules=result.get("behavior_rules", []),
                interaction_patterns=result.get("interaction_patterns", []),
                memory=result.get("memory", []),
                source="graph_entity",
            )

        except Exception:
            return self._generate_profile_rule_based(entity, category)

    async def _generate_standalone_profile(
        self,
        agent_type: str,
        agent_name: str,
        category: str,
        context: Optional[Dict[str, Any]] = None,
        archetype: str = "balanced",
    ) -> AgentProfile:
        """Generate a profile without entity backing."""
        params = self.PERSONALITY_TEMPLATES.get(agent_type, {}).get(
            archetype, {"sensitivity": 0.6, "activity": 0.5, "risk_tolerance": 0.5}
        )

        context_str = ""
        if context:
            context_str = "\n".join(f"- {k}: {v}" for k, v in context.items() if v)

        system_prompt = f"""Generate a realistic agent persona for a {category} simulation.
Agent type: {agent_type}
Behavioral archetype: {archetype}
{f"Scenario context:{chr(10)}{context_str}" if context_str else ""}

Return JSON with: description, personality, goals (3), background, behavior_rules (2), memory (2)."""

        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": f"Create a {archetype} {agent_type} agent named '{agent_name}' for a {category} simulation."}],
                system=system_prompt,
                temperature=0.6,
                max_tokens=800,
            )

            return AgentProfile(
                agent_id=f"agent_{uuid.uuid4().hex[:8]}",
                name=agent_name,
                agent_type=agent_type,
                description=result.get("description", f"{archetype.title()} {agent_type}"),
                personality=result.get("personality", archetype),
                goals=result.get("goals", []),
                background=result.get("background", ""),
                decision_style=archetype,
                sensitivity=params.get("sensitivity", 0.6),
                activity_level=params.get("activity", 0.5),
                influence_weight=random.uniform(0.3, 0.8),
                risk_tolerance=params.get("risk_tolerance", 0.5),
                behavior_rules=result.get("behavior_rules", []),
                memory=result.get("memory", []),
                source="generated",
            )

        except Exception:
            # Rule-based fallback (MiroFish pattern)
            return AgentProfile(
                agent_id=f"agent_{uuid.uuid4().hex[:8]}",
                name=agent_name,
                agent_type=agent_type,
                description=f"{archetype.title()} {agent_type} agent",
                decision_style=archetype,
                sensitivity=params.get("sensitivity", 0.6),
                activity_level=params.get("activity", 0.5),
                risk_tolerance=params.get("risk_tolerance", 0.5),
                source="rule_based",
            )

    def _generate_profile_rule_based(
        self,
        entity: EntityNode,
        category: str,
    ) -> AgentProfile:
        """
        Rule-based fallback profile generation.
        Adapted from MiroFish's _generate_profile_rule_based.
        """
        agent_type = self._map_entity_to_agent_type(entity.entity_type, category)

        # Default params by type (MiroFish pattern)
        type_defaults = {
            "customer": {"sensitivity": 0.7, "activity": 0.5, "influence": 0.3, "risk": 0.5},
            "competitor": {"sensitivity": 0.8, "activity": 0.7, "influence": 0.7, "risk": 0.4},
            "investor": {"sensitivity": 0.6, "activity": 0.3, "influence": 0.8, "risk": 0.5},
            "regulator": {"sensitivity": 0.3, "activity": 0.2, "influence": 0.9, "risk": 0.8},
            "market": {"sensitivity": 0.5, "activity": 0.5, "influence": 0.5, "risk": 0.5},
            "trader": {"sensitivity": 0.8, "activity": 0.9, "influence": 0.4, "risk": 0.3},
            "market_maker": {"sensitivity": 0.6, "activity": 0.8, "influence": 0.6, "risk": 0.6},
            "molecule": {"sensitivity": 0.5, "activity": 0.5, "influence": 0.3, "risk": 0.5},
            "enzyme": {"sensitivity": 0.7, "activity": 0.7, "influence": 0.5, "risk": 0.5},
            "data_stream": {"sensitivity": 0.4, "activity": 0.6, "influence": 0.2, "risk": 0.5},
        }

        defaults = type_defaults.get(agent_type, {"sensitivity": 0.5, "activity": 0.5, "influence": 0.5, "risk": 0.5})

        return AgentProfile(
            agent_id=f"agent_{uuid.uuid4().hex[:8]}",
            name=entity.name,
            agent_type=agent_type,
            entity_name=entity.name,
            entity_uuid=entity.uuid,
            description=entity.summary or f"{entity.entity_type} entity",
            sensitivity=defaults["sensitivity"] + random.uniform(-0.1, 0.1),
            activity_level=defaults["activity"] + random.uniform(-0.1, 0.1),
            influence_weight=defaults["influence"] + random.uniform(-0.1, 0.1),
            risk_tolerance=defaults["risk"] + random.uniform(-0.1, 0.1),
            source="rule_based",
        )

    def _map_entity_to_agent_type(self, entity_type: str, category: str) -> str:
        """Map knowledge graph entity types to Sylor agent types."""
        type_lower = entity_type.lower()

        # Direct mappings
        mapping = {
            "company": "competitor",
            "person": "customer",
            "product": "market",
            "market": "market",
            "investor": "investor",
            "customer_segment": "customer",
            "technology": "data_stream",
            "asset": "trader",
            "portfolio": "investor",
            "sector": "market",
            "risk_factor": "market",
            "molecule": "molecule",
            "protein": "molecule",
            "enzyme": "enzyme",
            "drug": "molecule",
            "pathway": "data_stream",
            "gene": "data_stream",
            "data_source": "data_stream",
            "signal": "data_stream",
            "pattern": "data_stream",
            "event": "market",
            "regulation": "regulator",
            "policy": "regulator",
            "organization": "competitor",
            "institution": "regulator",
        }

        for key, val in mapping.items():
            if key in type_lower:
                return val

        # Domain-based defaults
        domain_defaults = {
            "startup": "market",
            "finance": "trader",
            "biology": "molecule",
            "trend": "data_stream",
        }

        return domain_defaults.get(category, "market")


# Singleton
profile_generator = AgentProfileGenerator()
