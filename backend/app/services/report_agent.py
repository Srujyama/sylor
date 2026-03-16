"""
ReACT Report Generation Agent for Sylor.
Adapted from MiroFish's report_agent.py (2571 lines) with major improvements:
- Async-first with streaming support
- Anthropic Claude native API
- Domain-specific report templates for Sylor's simulation categories
- Tool system uses knowledge graph + simulation results (not just Zep)
- Structured progress tracking with SSE support
- Cleaner ReACT loop with better conflict resolution
"""
import asyncio
import json
import re
import uuid
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime

from app.services.llm_client import LLMClient, llm_client
from app.services.knowledge_graph import KnowledgeGraphBuilder, graph_builder


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class ReportSection:
    """A section of the generated report."""
    index: int
    title: str
    content: str = ""
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    status: str = "pending"  # pending, generating, completed, failed


@dataclass
class ReportProgress:
    """Real-time progress tracking for report generation."""
    report_id: str
    status: str = "pending"  # pending, planning, generating, completed, failed
    current_section: int = 0
    total_sections: int = 0
    percent: float = 0.0
    message: str = ""
    sections_completed: List[int] = field(default_factory=list)


@dataclass
class Report:
    """Full generated report."""
    report_id: str
    simulation_id: str
    title: str = ""
    summary: str = ""
    sections: List[ReportSection] = field(default_factory=list)
    full_markdown: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "pending"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "report_id": self.report_id,
            "simulation_id": self.simulation_id,
            "title": self.title,
            "summary": self.summary,
            "sections": [{"index": s.index, "title": s.title, "content": s.content, "status": s.status} for s in self.sections],
            "full_markdown": self.full_markdown,
            "created_at": self.created_at,
            "status": self.status,
            "metadata": self.metadata,
        }


# ── Tool Definitions ─────────────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "search_knowledge",
        "description": "Search the knowledge graph for entities and relationships relevant to a query. Use for fact-finding and relationship discovery.",
        "parameters": {"query": "Search query string", "limit": "Max results (default 10)"},
    },
    {
        "name": "get_statistics",
        "description": "Get statistical summary of the knowledge graph: entity counts by type, relationship counts, key metrics.",
        "parameters": {},
    },
    {
        "name": "analyze_results",
        "description": "Deep-dive analysis of specific simulation results. Returns statistical breakdowns, percentile data, and pattern analysis.",
        "parameters": {"aspect": "What aspect to analyze: 'success_factors', 'risk_breakdown', 'timeline_analysis', 'agent_behavior', 'outcome_distribution'"},
    },
    {
        "name": "compare_scenarios",
        "description": "Compare different outcome scenarios from the simulation. Returns contrasts between success/failure cases.",
        "parameters": {"scenario_type": "'best_vs_worst', 'by_agent_type', 'by_time_period'"},
    },
]

VALID_TOOL_NAMES = {t["name"] for t in TOOL_DEFINITIONS}


# ── ReACT Report Agent ───────────────────────────────────────────────────────

class ReportAgent:
    """
    ReACT-pattern report generation agent.
    Adapted from MiroFish's ReportAgent with Sylor-specific improvements.

    ReACT Loop (from MiroFish):
    1. Thought: Agent reasons about what information is needed
    2. Action: Agent calls a tool to retrieve information
    3. Observation: Tool result is fed back
    4. Repeat until sufficient info gathered (min 2, max 4 tool calls)
    5. Final Answer: Agent writes the section content
    """

    MIN_TOOL_CALLS = 2  # MiroFish uses 3; we use 2 since our tools return richer data
    MAX_TOOL_CALLS = 4  # MiroFish uses 5
    MAX_ITERATIONS = 6
    CONFLICT_MAX_RETRIES = 2  # From MiroFish's conflict handler

    def __init__(
        self,
        client: Optional[LLMClient] = None,
        graph_id: Optional[str] = None,
    ):
        self.llm = client or llm_client
        self.graph_id = graph_id

    # ── Report Store ─────────────────────────────────────────────────────────

    _reports: Dict[str, Report] = {}
    _progress: Dict[str, ReportProgress] = {}

    # ── Planning Phase ───────────────────────────────────────────────────────

    async def plan_outline(
        self,
        simulation_data: Dict[str, Any],
        category: str,
    ) -> List[Dict[str, str]]:
        """
        Plan the report outline.
        Adapted from MiroFish's plan_outline with domain-specific templates.
        """
        # Get graph context if available (MiroFish pattern)
        graph_context = ""
        if self.graph_id:
            stats = graph_builder.get_graph_statistics(self.graph_id)
            if stats:
                graph_context = f"\nKnowledge Graph: {stats.get('total_nodes', 0)} entities, {stats.get('total_edges', 0)} relationships"
                entity_types = stats.get("entity_types", {})
                if entity_types:
                    graph_context += f"\nEntity types: {', '.join(f'{k} ({v})' for k, v in entity_types.items())}"

        success_prob = simulation_data.get("success_probability", 0)
        category_label = category.replace("_", " ").title()

        system_prompt = """You are a simulation analysis report architect. Design a clear, focused report outline.

RULES:
- 3-5 sections total (not more)
- No sub-sections
- Each section should answer a specific strategic question
- The outline must be data-driven, not generic
- Tailor sections to the simulation domain and results

Return JSON:
{
  "title": "Report title",
  "summary": "1-2 sentence executive summary",
  "sections": [
    {"title": "Section Title", "focus": "What this section should analyze and answer"}
  ]
}"""

        user_msg = f"""Simulation Domain: {category_label}
Success Probability: {success_prob}%
Key Results: {json.dumps({k: v for k, v in simulation_data.items() if k not in ('timeline_aggregated', 'outcome_distribution')}, default=str)[:2000]}
{graph_context}

Design the report outline."""

        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": user_msg}],
                system=system_prompt,
                temperature=0.3,
                max_tokens=1000,
            )

            sections = result.get("sections", [])
            if len(sections) < 2:
                raise ValueError("Too few sections")

            return {
                "title": result.get("title", f"{category_label} Simulation Analysis"),
                "summary": result.get("summary", ""),
                "sections": sections[:5],
            }

        except Exception:
            # Fallback outline (MiroFish pattern)
            return {
                "title": f"{category_label} Simulation Analysis Report",
                "summary": f"Analysis of {category_label.lower()} simulation with {success_prob}% success probability.",
                "sections": [
                    {"title": "Executive Summary & Key Findings", "focus": "Overall success probability, confidence intervals, and critical metrics"},
                    {"title": "Risk Analysis & Mitigation", "focus": "Top risk factors, their probabilities, and recommended mitigations"},
                    {"title": "Strategic Recommendations", "focus": "Actionable recommendations based on simulation outcomes"},
                ],
            }

    # ── ReACT Section Generation ─────────────────────────────────────────────

    async def _generate_section_react(
        self,
        section: ReportSection,
        simulation_data: Dict[str, Any],
        category: str,
        previous_sections: List[ReportSection],
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> str:
        """
        Generate a single section using the ReACT pattern.
        Adapted from MiroFish's _generate_section_react with cleaner conflict handling.
        """
        # Build tools description
        tools_desc = "\n".join([
            f"- {t['name']}: {t['description']}" for t in TOOL_DEFINITIONS
        ])

        # Build previous sections context (MiroFish pattern: truncate to 4000 chars each)
        prev_context = ""
        if previous_sections:
            for ps in previous_sections:
                if ps.content:
                    truncated = ps.content[:4000]
                    prev_context += f"\n--- Previous: {ps.title} ---\n{truncated}\n"

        system_prompt = f"""You are an expert simulation analyst writing a detailed report section.

SECTION: {section.title}
FOCUS: {section.content}
DOMAIN: {category}

AVAILABLE TOOLS:
{tools_desc}

RULES:
1. Use tools to gather data BEFORE writing. Call at least {self.MIN_TOOL_CALLS} tools.
2. To call a tool, output ONLY: <tool_call>{{"name": "tool_name", "parameters": {{"param": "value"}}}}</tool_call>
3. To write the final section, output ONLY: Final Answer: [your markdown content]
4. NEVER combine a tool call and Final Answer in the same response.
5. Reference specific numbers and data from tool results.
6. Avoid repeating content from previous sections.

{f"PREVIOUS SECTIONS (avoid repeating):{prev_context}" if prev_context else ""}"""

        messages = [
            {"role": "user", "content": f"Write the '{section.title}' section. Simulation results:\n{json.dumps({k: v for k, v in simulation_data.items() if k not in ('timeline_aggregated',)}, default=str)[:3000]}"},
        ]

        tool_call_count = 0
        used_tools = set()
        conflict_retries = 0

        for iteration in range(self.MAX_ITERATIONS):
            response = await self.llm.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.5,
                max_tokens=2000,
            )

            if response is None or not response.text:
                # None response handling (MiroFish pattern)
                if tool_call_count >= self.MIN_TOOL_CALLS:
                    return f"*Section generation incomplete.*"
                messages.append({"role": "assistant", "content": "I need to gather more data."})
                messages.append({"role": "user", "content": "Please call a tool to gather information."})
                continue

            text = response.text

            # Parse for tool calls and final answer
            has_tool_call = "<tool_call>" in text
            has_final = "Final Answer:" in text

            # Conflict resolution (from MiroFish)
            if has_tool_call and has_final:
                conflict_retries += 1
                if conflict_retries <= self.CONFLICT_MAX_RETRIES:
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": "ERROR: You included both a tool call AND Final Answer. Choose ONE: either call a tool OR write your Final Answer."})
                    continue
                else:
                    # On 3rd conflict, take just the tool call (MiroFish pattern)
                    text = text[:text.index("Final Answer:")]
                    has_final = False

            # Handle tool call
            if has_tool_call:
                if tool_call_count >= self.MAX_TOOL_CALLS:
                    # Tool limit reached (MiroFish pattern)
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": f"You've reached the maximum of {self.MAX_TOOL_CALLS} tool calls. Please write your Final Answer now."})
                    continue

                # Parse and execute tool call
                tool_call = self._parse_tool_call(text)
                if tool_call:
                    tool_name = tool_call.get("name", "")
                    tool_params = tool_call.get("parameters", {})

                    result = await self._execute_tool(tool_name, tool_params, simulation_data)
                    tool_call_count += 1
                    used_tools.add(tool_name)

                    section.tool_calls.append({
                        "tool": tool_name,
                        "params": tool_params,
                        "result_preview": str(result)[:200],
                    })

                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": f"Observation:\n{result}"})

                    # Suggest unused tools (MiroFish pattern)
                    unused = VALID_TOOL_NAMES - used_tools
                    if unused and tool_call_count < self.MAX_TOOL_CALLS:
                        messages[-1]["content"] += f"\n\nTip: You haven't used these tools yet: {', '.join(unused)}"

                    continue

            # Handle final answer
            if has_final:
                if tool_call_count < self.MIN_TOOL_CALLS:
                    # Insufficient tools (MiroFish pattern)
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": f"You must call at least {self.MIN_TOOL_CALLS} tools before writing your Final Answer. You've only called {tool_call_count}. Please call another tool."})
                    continue

                # Extract final answer content
                answer = text.split("Final Answer:", 1)[1].strip()
                return self._post_process_section(answer)

            # No tool call or final answer detected
            if tool_call_count >= self.MIN_TOOL_CALLS:
                # Accept as final answer (MiroFish graceful degradation)
                return self._post_process_section(text)

            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": "Please either call a tool using <tool_call> tags or write your Final Answer."})

        # Max iterations exhausted (MiroFish pattern: force final)
        messages.append({"role": "user", "content": "Write your Final Answer NOW based on all information gathered."})
        response = await self.llm.chat(
            messages=messages,
            system=system_prompt,
            temperature=0.5,
            max_tokens=2000,
        )

        if response and response.text:
            text = response.text
            if "Final Answer:" in text:
                text = text.split("Final Answer:", 1)[1].strip()
            return self._post_process_section(text)

        return "*Section could not be generated.*"

    # ── Tool Execution ───────────────────────────────────────────────────────

    async def _execute_tool(
        self,
        tool_name: str,
        params: Dict[str, Any],
        simulation_data: Dict[str, Any],
    ) -> str:
        """
        Execute a tool and return results.
        Adapted from MiroFish's _execute_tool with Sylor-specific tools.
        """
        try:
            if tool_name == "search_knowledge":
                query = params.get("query", "")
                limit = int(params.get("limit", 10))
                if self.graph_id:
                    entities = await graph_builder.search_graph(self.graph_id, query, limit)
                    if entities:
                        return json.dumps([e.to_dict() for e in entities], indent=1, default=str)
                    return "No matching entities found."
                return "No knowledge graph available for this simulation."

            elif tool_name == "get_statistics":
                if self.graph_id:
                    stats = graph_builder.get_graph_statistics(self.graph_id)
                    return json.dumps(stats, indent=1, default=str)

                # Return simulation stats instead
                return json.dumps({
                    "success_probability": simulation_data.get("success_probability"),
                    "confidence_interval": simulation_data.get("confidence_interval"),
                    "avg_revenue": simulation_data.get("avg_revenue"),
                    "avg_market_share": simulation_data.get("avg_market_share"),
                    "risk_factors_count": len(simulation_data.get("risk_factors", [])),
                }, indent=1, default=str)

            elif tool_name == "analyze_results":
                aspect = params.get("aspect", "success_factors")
                return self._analyze_aspect(simulation_data, aspect)

            elif tool_name == "compare_scenarios":
                scenario_type = params.get("scenario_type", "best_vs_worst")
                return self._compare_scenarios(simulation_data, scenario_type)

            else:
                return f"Unknown tool: {tool_name}"

        except Exception as e:
            return f"Tool error: {str(e)}"

    def _analyze_aspect(self, data: Dict, aspect: str) -> str:
        """Analyze a specific aspect of simulation results."""
        if aspect == "success_factors":
            insights = data.get("key_insights", [])
            success = data.get("success_explanation", "")
            return json.dumps({
                "success_probability": data.get("success_probability"),
                "confidence_interval": data.get("confidence_interval"),
                "key_insights": insights,
                "success_pattern": success,
            }, indent=1, default=str)

        elif aspect == "risk_breakdown":
            risks = data.get("risk_factors", [])
            return json.dumps({
                "risk_factors": risks,
                "total_risks": len(risks),
                "critical_risks": [r for r in risks if isinstance(r, dict) and r.get("severity") in ("high", "critical")],
            }, indent=1, default=str)

        elif aspect == "timeline_analysis":
            timeline = data.get("timeline_aggregated", [])
            return json.dumps({
                "timeline_points": len(timeline),
                "first_period": timeline[0] if timeline else None,
                "last_period": timeline[-1] if timeline else None,
                "midpoint": timeline[len(timeline) // 2] if timeline else None,
                "growth_trend": "increasing" if timeline and len(timeline) > 1 and timeline[-1].get("avg_revenue", 0) > timeline[0].get("avg_revenue", 0) else "flat_or_declining",
            }, indent=1, default=str)

        elif aspect == "agent_behavior":
            return json.dumps({
                "competitor_reactions": data.get("competitor_reactions", []),
                "failure_pattern": data.get("failure_explanation", ""),
            }, indent=1, default=str)

        elif aspect == "outcome_distribution":
            dist = data.get("outcome_distribution", [])
            return json.dumps({
                "distribution": dist,
                "total_buckets": len(dist),
            }, indent=1, default=str)

        return json.dumps({"error": f"Unknown aspect: {aspect}"})

    def _compare_scenarios(self, data: Dict, scenario_type: str) -> str:
        """Compare different scenarios from simulation results."""
        if scenario_type == "best_vs_worst":
            return json.dumps({
                "success_explanation": data.get("success_explanation", ""),
                "failure_explanation": data.get("failure_explanation", ""),
                "success_probability": data.get("success_probability"),
                "avg_revenue": data.get("avg_revenue"),
            }, indent=1, default=str)

        elif scenario_type == "by_agent_type":
            return json.dumps({
                "competitor_reactions": data.get("competitor_reactions", []),
                "risk_factors": [r for r in data.get("risk_factors", []) if isinstance(r, dict)],
            }, indent=1, default=str)

        elif scenario_type == "by_time_period":
            timeline = data.get("timeline_aggregated", [])
            if len(timeline) >= 3:
                third = len(timeline) // 3
                return json.dumps({
                    "early_period": timeline[:third],
                    "middle_period": timeline[third:2 * third],
                    "late_period": timeline[2 * third:],
                }, indent=1, default=str)

        return json.dumps({"info": "Insufficient data for comparison"})

    # ── Tool Parsing ─────────────────────────────────────────────────────────

    def _parse_tool_call(self, text: str) -> Optional[Dict[str, Any]]:
        """
        Parse tool call from LLM response.
        Adapted from MiroFish's two-priority parser (XML + bare JSON).
        """
        # Priority 1: XML format
        match = re.search(r'<tool_call>(.*?)</tool_call>', text, re.DOTALL)
        if match:
            try:
                call = json.loads(match.group(1).strip())
                # Normalize keys (MiroFish pattern)
                if "tool" in call and "name" not in call:
                    call["name"] = call.pop("tool")
                if "params" in call and "parameters" not in call:
                    call["parameters"] = call.pop("params")
                if call.get("name") in VALID_TOOL_NAMES:
                    return call
            except json.JSONDecodeError:
                pass

        # Priority 2: Bare JSON fallback (MiroFish pattern)
        json_matches = re.findall(r'\{[^{}]+\}', text)
        for jm in reversed(json_matches):  # Try last match first
            try:
                call = json.loads(jm)
                if "name" in call and call["name"] in VALID_TOOL_NAMES:
                    return call
            except json.JSONDecodeError:
                continue

        return None

    # ── Post-Processing ──────────────────────────────────────────────────────

    def _post_process_section(self, content: str) -> str:
        """
        Clean up section content.
        Adapted from MiroFish's _clean_section_content + _post_process_report.
        """
        # Remove tool call artifacts
        content = re.sub(r'<tool_call>.*?</tool_call>', '', content, flags=re.DOTALL)

        # Convert ###+ headings to bold (MiroFish pattern: preserve only ## for sections)
        content = re.sub(r'^###+ (.+)$', r'**\1**', content, flags=re.MULTILINE)

        # Remove duplicate blank lines
        content = re.sub(r'\n{3,}', '\n\n', content)

        return content.strip()

    # ── Full Report Generation ───────────────────────────────────────────────

    async def generate_report(
        self,
        simulation_id: str,
        simulation_data: Dict[str, Any],
        category: str,
        graph_id: Optional[str] = None,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> Report:
        """
        Generate a full report from simulation results.
        Follows MiroFish's pipeline: plan -> iterate sections -> assemble.
        """
        self.graph_id = graph_id
        report_id = f"report_{uuid.uuid4().hex[:12]}"

        report = Report(
            report_id=report_id,
            simulation_id=simulation_id,
        )
        self._reports[report_id] = report

        progress = ReportProgress(report_id=report_id, status="planning")
        self._progress[report_id] = progress

        try:
            # Phase 1: Planning (from MiroFish)
            if progress_callback:
                await progress_callback(5.0, "Planning report structure...")

            outline = await self.plan_outline(simulation_data, category)
            report.title = outline["title"]
            report.summary = outline["summary"]

            for i, sec_def in enumerate(outline["sections"]):
                report.sections.append(ReportSection(
                    index=i,
                    title=sec_def["title"],
                    content=sec_def.get("focus", ""),
                ))

            progress.total_sections = len(report.sections)
            progress.status = "generating"

            if progress_callback:
                await progress_callback(15.0, f"Generating {len(report.sections)} sections...")

            # Phase 2: Generate each section with ReACT
            completed_sections = []
            for i, section in enumerate(report.sections):
                progress.current_section = i + 1
                section.status = "generating"

                if progress_callback:
                    pct = 15 + (i / len(report.sections)) * 75
                    await progress_callback(pct, f"Writing: {section.title}")

                content = await self._generate_section_react(
                    section=section,
                    simulation_data=simulation_data,
                    category=category,
                    previous_sections=completed_sections,
                    progress_callback=progress_callback,
                )

                section.content = content
                section.status = "completed"
                completed_sections.append(section)
                progress.sections_completed.append(i)

            # Phase 3: Assemble (from MiroFish)
            if progress_callback:
                await progress_callback(92.0, "Assembling final report...")

            report.full_markdown = self._assemble_report(report)
            report.status = "completed"
            progress.status = "completed"
            progress.percent = 100.0

            if progress_callback:
                await progress_callback(100.0, "Report complete!")

            return report

        except Exception as e:
            report.status = "failed"
            report.metadata["error"] = str(e)
            progress.status = "failed"
            progress.message = str(e)
            raise

    def _assemble_report(self, report: Report) -> str:
        """
        Assemble the full markdown report.
        From MiroFish's assemble_full_report with post-processing.
        """
        parts = [f"# {report.title}\n"]

        if report.summary:
            parts.append(f"*{report.summary}*\n")

        for section in report.sections:
            if section.content:
                parts.append(f"\n## {section.title}\n")
                parts.append(section.content)

        markdown = "\n".join(parts)

        # Post-process (MiroFish pattern)
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)

        return markdown.strip()

    # ── Chat with Report ─────────────────────────────────────────────────────

    async def chat(
        self,
        report_id: str,
        message: str,
        simulation_data: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Chat about a generated report.
        Adapted from MiroFish's simplified ReACT chat (2 iterations, 2 tools).
        """
        report = self._reports.get(report_id)
        if not report:
            return "Report not found."

        # Load report content (MiroFish pattern: cap at 15000 chars)
        report_content = report.full_markdown[:15000]

        system_prompt = f"""You are an analyst discussing this simulation report with the user.

REPORT CONTENT:
{report_content}

Answer from the report first. Only use tools if the report doesn't contain the answer.
If you need a tool, use: <tool_call>{{"name": "tool_name", "parameters": {{}}}}</tool_call>
Otherwise, answer directly."""

        messages = [{"role": "user", "content": message}]

        # Simplified ReACT loop (from MiroFish chat: max 2 iterations)
        for _ in range(2):
            response = await self.llm.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.5,
                max_tokens=1500,
            )

            text = response.text
            if "<tool_call>" in text:
                tool_call = self._parse_tool_call(text)
                if tool_call and simulation_data:
                    result = await self._execute_tool(
                        tool_call["name"],
                        tool_call.get("parameters", {}),
                        simulation_data,
                    )
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": f"Tool result:\n{result}"})
                    continue

            # Clean tool call artifacts from response
            text = re.sub(r'<tool_call>.*?</tool_call>', '', text, flags=re.DOTALL).strip()
            return text

        return response.text if response else "Could not generate a response."

    # ── Report Store Methods ─────────────────────────────────────────────────

    @classmethod
    def get_report(cls, report_id: str) -> Optional[Report]:
        return cls._reports.get(report_id)

    @classmethod
    def get_progress(cls, report_id: str) -> Optional[ReportProgress]:
        return cls._progress.get(report_id)

    @classmethod
    def list_reports(cls, simulation_id: Optional[str] = None) -> List[Dict[str, Any]]:
        reports = cls._reports.values()
        if simulation_id:
            reports = [r for r in reports if r.simulation_id == simulation_id]
        return [r.to_dict() for r in reports]

    @classmethod
    def get_report_by_simulation(cls, simulation_id: str) -> Optional[Report]:
        for r in cls._reports.values():
            if r.simulation_id == simulation_id:
                return r
        return None

    @classmethod
    def delete_report(cls, report_id: str) -> bool:
        if report_id in cls._reports:
            del cls._reports[report_id]
            cls._progress.pop(report_id, None)
            return True
        return False


# Singleton
report_agent = ReportAgent()
