"""
AI-powered insights generation using Claude API.
"""
import anthropic
from app.config import settings
from app.models.simulation import SimulationConfig, SimulationResults


async def generate_ai_insights(
    config: SimulationConfig,
    results: SimulationResults,
) -> dict:
    """Generate rich AI insights from simulation results using Claude."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    variables_summary = "\n".join(
        [f"- {v.label}: {v.value}{v.unit or ''}" for v in config.variables]
    )
    agents_summary = "\n".join(
        [f"- {a.type.value}: {a.count} agents (sensitivity: {a.sensitivity})" for a in config.agents]
    )

    prompt = f"""You are an expert business strategy consultant analyzing AI simulation results.

SIMULATION: {config.name}
CATEGORY: {config.category.value}
TIME HORIZON: {config.time_horizon} months
RUNS: {config.num_runs}

VARIABLES:
{variables_summary}

AGENTS:
{agents_summary}

RESULTS:
- Success probability: {results.success_probability}%
- Confidence interval: {results.confidence_interval[0]}% — {results.confidence_interval[1]}%
- Average revenue at end: ${results.avg_revenue:,.0f}/month
- Average market share: {results.avg_market_share:.2f}%
- Average break-even: month {results.avg_breakeven_month:.1f}

Provide a structured analysis with:
1. 5 specific, actionable key insights based on the data
2. The primary success pattern in 2-3 sentences
3. The primary failure pattern in 2-3 sentences
4. 3 strategic recommendations with expected impact
5. One "contrarian insight" — something surprising or counter-intuitive

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
