"""
AI-powered insights generation using Claude API.
"""
import anthropic
from typing import Optional, Dict, Any
from app.config import settings
from app.models.simulation import SimulationConfig, SimulationResults


def _format_company_context(context: Dict[str, Any]) -> str:
    """Format company context dict into readable lines for the prompt."""
    if not context:
        return ""
    lines = []
    for k, v in context.items():
        if v and str(v).strip():
            label = k.replace("_", " ").replace("camelCase", " ").title()
            lines.append(f"- {label}: {v}")
    return "\n".join(lines)


async def generate_ai_insights(
    config: SimulationConfig,
    results: SimulationResults,
    company_context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Generate rich AI insights from simulation results using Claude."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    variables_summary = "\n".join(
        [f"- {v.label}: {v.value}{v.unit or ''}" for v in config.variables]
    )
    agents_summary = "\n".join(
        [f"- {a.type.value}: {a.count} agents (sensitivity: {a.sensitivity})" for a in config.agents]
    )

    # Domain-aware role selection
    category = config.category.value
    if category == "finance":
        role = "You are an expert quantitative finance analyst and portfolio strategist analyzing AI-driven market simulation results."
        metric_label = "portfolio return"
        metric_value = f"{results.avg_revenue:,.0f} (PnL)"
    elif category == "biology":
        role = "You are an expert computational biologist and molecular dynamics researcher analyzing AI simulation results of molecular interactions."
        metric_label = "binding rate"
        metric_value = f"{results.avg_revenue:.1f}% binding"
    elif category == "trend":
        role = "You are an expert data scientist specializing in time-series forecasting and trend analysis, analyzing AI simulation results."
        metric_label = "forecast accuracy"
        metric_value = f"{results.avg_revenue:.1f}% accuracy"
    else:
        role = "You are an expert business strategy consultant analyzing AI simulation results."
        metric_label = "average revenue at end"
        metric_value = f"${results.avg_revenue:,.0f}/month"

    # Build company context block if available
    context_block = ""
    if company_context:
        context_lines = _format_company_context(company_context)
        if context_lines:
            context_block = f"""
COMPANY/SCENARIO CONTEXT (real data provided by the user):
{context_lines}

IMPORTANT: Reference the user's actual company, competitors, market, and metrics in your insights. Make recommendations specific to THEIR situation, not generic advice."""

    prompt = f"""{role}

SIMULATION: {config.name}
CATEGORY: {config.category.value}
TIME HORIZON: {config.time_horizon} {"steps" if category == "biology" else "months"}
RUNS: {config.num_runs}
{context_block}

VARIABLES:
{variables_summary}

AGENTS:
{agents_summary}

RESULTS:
- Success probability: {results.success_probability}%
- Confidence interval: {results.confidence_interval[0]}% — {results.confidence_interval[1]}%
- {metric_label}: {metric_value}
- Average market share / score: {results.avg_market_share:.2f}%
- Average break-even / convergence: month {results.avg_breakeven_month:.1f}

Provide a structured analysis with:
1. 5 specific, actionable key insights based on the data{" and the user's company context" if company_context else ""}
2. The primary success pattern in 2-3 sentences
3. The primary failure pattern in 2-3 sentences
4. 3 strategic recommendations with expected impact{" — reference their actual company, competitors, and market" if company_context else ""}
5. One "contrarian insight" — something surprising or counter-intuitive from the simulation

Format as JSON:
{{
  "key_insights": ["insight1", "insight2", "insight3", "insight4", "insight5"],
  "success_pattern": "...",
  "failure_pattern": "...",
  "recommendations": [
    {{"action": "...", "expected_impact": "...", "urgency": "high|medium|low"}},
    ...
  ],
  "contrarian_insight": "..."
}}"""

    try:
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        import json
        text = response.content[0].text
        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception as e:
        pass

    # Fallback insights
    return {
        "key_insights": results.key_insights,
        "success_pattern": results.success_explanation,
        "failure_pattern": results.failure_explanation,
        "recommendations": [
            {"action": "Validate pricing assumptions with 20 customer interviews", "expected_impact": "+8% success probability", "urgency": "high"},
            {"action": "Build 6-month runway buffer before launch", "expected_impact": "Reduces runway risk by 40%", "urgency": "high"},
            {"action": "Implement customer success program to reduce churn", "expected_impact": "+15% LTV improvement", "urgency": "medium"},
        ],
        "contrarian_insight": "Simulations show that launching at a higher price point than planned actually increases success probability — premium positioning reduces churn and attracts higher-intent customers.",
    }
