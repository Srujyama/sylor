"""
AI-powered context analysis endpoint.
Takes a user's company/scenario context and uses Claude to generate
realistic simulation variables, agent configs, and assumptions.

LLM access goes through the shared ``llm_client`` singleton (Wave E unified
all routers onto it). The client owns the Anthropic API surface, retry logic,
and a 4-strategy JSON repair pipeline, so this module no longer carries its
own raw ``anthropic.AsyncAnthropic`` client or bespoke JSON repair.
"""
import json
import logging
from fastapi import APIRouter, HTTPException, Depends
from app.config import settings
from app.middleware.auth import get_current_user
from app.models.simulation import CompanyContext, ContextAnalysisResponse, PromptRequest, PromptAnalysisResponse
from app.services.llm_client import llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/context", tags=["context"])

_GENERATOR_SYSTEM = (
    "You are a simulation configuration generator. "
    "You MUST respond with ONLY a single valid JSON object — "
    "no markdown, no code fences, no comments, no explanation before or after. "
    "The JSON must be syntactically valid and COMPLETE — never truncate. "
    "Keep all 'reasoning' field values under 15 words to stay within token limits."
)


def _build_prompt(category: str, context: dict) -> str:
    """Build a domain-specific Claude prompt from the user's context."""

    context_lines = "\n".join(f"- {k}: {v}" for k, v in context.items() if v)

    if category in ("startup", "pricing", "policy", "marketing", "product", "custom"):
        return f"""You are a senior strategy consultant and simulation modeler. A user wants to run a Monte Carlo business simulation. They've provided real details about their company/scenario below.

CATEGORY: {category}
USER CONTEXT:
{context_lines}

Based on this REAL company context, generate a complete simulation configuration. Every number you produce must be grounded in what the user told you — use their actual revenue, burn rate, team size, market, competitors, etc. to calibrate realistic ranges. Do NOT use generic defaults.

Return a JSON object with this exact structure:
{{
  "variables": [
    {{
      "name": "snake_case_var_name",
      "label": "Human Readable Label",
      "value": <realistic starting value based on their data>,
      "min": <plausible minimum>,
      "max": <plausible maximum>,
      "unit": "$" | "%" | "users" | "months" | etc,
      "reasoning": "Why this value, based on what they told us"
    }}
  ],
  "agents": [
    {{
      "type": "customer|competitor|investor|regulator|market",
      "label": "Agent Label",
      "count": <number>,
      "sensitivity": <0.0-1.0>,
      "reasoning": "Why this config"
    }}
  ],
  "assumptions": ["assumption 1", "assumption 2", ...],
  "success_criteria": "What constitutes success for THIS specific scenario",
  "time_horizon": <months as integer>,
  "num_runs": <recommended number of Monte Carlo runs>
}}

RULES:
1. Generate 15-25 variables. Include financials (revenue, burn, margins), growth metrics (CAC, LTV, churn, conversion), market dynamics (TAM penetration, competitor share), operational metrics (team productivity, feature velocity), and scenario-specific ones.
2. Every value must trace back to their context. If they said MRR is $50K, the revenue variable should start around $50K, not some default.
3. Ranges should be realistic — don't set a min of $0 and max of $1B. Use their actual scale ±50-200%.
4. Include 3-6 agents with counts that make sense for their market (e.g., if they named 3 competitors, use count=3).
5. Assumptions should list what you inferred or estimated when the user didn't provide exact data.
6. Success criteria should be specific to their situation, not generic.
7. Time horizon should match their stage (pre-revenue=18-24mo, growth=12mo, etc.).
8. Recommend 1000-5000 runs based on variable count."""

    elif category == "finance":
        return f"""You are a senior quantitative analyst and portfolio strategist. A user wants to run a Monte Carlo financial simulation. They've provided real details about their investment scenario below.

CATEGORY: finance
USER CONTEXT:
{context_lines}

Based on this REAL investment context, generate a complete simulation configuration. Calibrate all values to their actual capital, risk profile, and target assets.

Return a JSON object with this exact structure:
{{
  "variables": [
    {{
      "name": "snake_case_var_name",
      "label": "Human Readable Label",
      "value": <realistic starting value>,
      "min": <plausible minimum>,
      "max": <plausible maximum>,
      "unit": "$" | "%" | "days" | "bps" | etc,
      "reasoning": "Why this value"
    }}
  ],
  "agents": [
    {{
      "type": "trader|market_maker|data_stream|investor",
      "label": "Agent Label",
      "count": <number>,
      "sensitivity": <0.0-1.0>,
      "reasoning": "Why this config"
    }}
  ],
  "assumptions": ["assumption 1", ...],
  "success_criteria": "What constitutes success for THIS portfolio/trade",
  "time_horizon": <months>,
  "num_runs": <recommended runs>
}}

RULES:
1. Generate 15-25 variables: portfolio value, position sizes, volatility (per-asset if possible), correlation assumptions, Sharpe target, max drawdown tolerance, VaR threshold, sector allocation, expected drift, rebalance cost, bid-ask spread, slippage, margin requirements, leverage ratio, etc.
2. If they named specific assets/tickers, include per-asset variables.
3. Use their actual capital and risk profile to set ranges.
4. Include trader agents (momentum + mean-reversion), market makers, and data stream agents.
5. Time horizon should match their investment horizon."""

    elif category == "biology":
        return f"""You are a senior computational biologist and molecular dynamics expert. A user wants to run a Monte Carlo molecular simulation. They've provided real details about their research scenario below.

CATEGORY: biology
USER CONTEXT:
{context_lines}

Based on this REAL research context, generate a complete simulation configuration. Calibrate to their actual molecules, conditions, and research goals.

Return a JSON object with this exact structure:
{{
  "variables": [
    {{
      "name": "snake_case_var_name",
      "label": "Human Readable Label",
      "value": <realistic starting value>,
      "min": <plausible minimum>,
      "max": <plausible maximum>,
      "unit": "K" | "pH" | "nM" | "µM" | "kJ/mol" | etc,
      "reasoning": "Why this value"
    }}
  ],
  "agents": [
    {{
      "type": "molecule|enzyme|data_stream",
      "label": "Agent Label",
      "count": <number>,
      "sensitivity": <0.0-1.0>,
      "reasoning": "Why this config"
    }}
  ],
  "assumptions": ["assumption 1", ...],
  "success_criteria": "What constitutes success for THIS experiment",
  "time_horizon": <simulation periods>,
  "num_runs": <recommended runs>
}}

RULES:
1. Generate 15-25 variables: temperature, pH, ionic strength, concentration, binding affinity (Kd/Ki), activation energy, diffusion coefficient, solvent viscosity, conformational energy barriers, reaction rates (kcat, Km), inhibitor concentration, allosteric effects, etc.
2. Calibrate to their specific molecule/protein if named.
3. Include molecule agents, enzyme agents, and environmental data streams.
4. Ranges should reflect physically plausible conditions."""

    elif category == "trend":
        return f"""You are a senior data scientist specializing in time-series analysis and forecasting. A user wants to run a Monte Carlo trend simulation. They've provided real details about their data scenario below.

CATEGORY: trend
USER CONTEXT:
{context_lines}

Based on this REAL data context, generate a complete simulation configuration.

Return a JSON object with this exact structure:
{{
  "variables": [
    {{
      "name": "snake_case_var_name",
      "label": "Human Readable Label",
      "value": <realistic starting value>,
      "min": <plausible minimum>,
      "max": <plausible maximum>,
      "unit": "%" | "periods" | etc,
      "reasoning": "Why this value"
    }}
  ],
  "agents": [
    {{
      "type": "data_stream|market|customer",
      "label": "Agent Label",
      "count": <number>,
      "sensitivity": <0.0-1.0>,
      "reasoning": "Why this config"
    }}
  ],
  "assumptions": ["assumption 1", ...],
  "success_criteria": "What constitutes a successful forecast",
  "time_horizon": <periods>,
  "num_runs": <recommended runs>
}}

RULES:
1. Generate 15-25 variables: trend strength, seasonality amplitude, noise level, autocorrelation, change point probability, external shock magnitude, baseline level, growth rate, decay factor, confidence threshold, anomaly sensitivity, forecast horizon, smoothing factor, regime change probability, etc.
2. Calibrate to their data domain and frequency.
3. Include data stream agents and market force agents."""

    return ""


@router.post("/analyze", response_model=ContextAnalysisResponse)
async def analyze_context(body: CompanyContext, user: dict = Depends(get_current_user)):
    """Analyze user's company/scenario context using Claude and generate simulation parameters."""

    if not settings.anthropic_api_key:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    prompt = _build_prompt(body.category.value, body.context)
    if not prompt:
        raise HTTPException(status_code=400, detail=f"Unsupported category: {body.category}")

    try:
        # Stream-collect (avoids read-timeout on slow connections) through the
        # shared client, then parse with its robust JSON repair pipeline.
        text = await llm_client.stream_collect(
            messages=[{"role": "user", "content": prompt}],
            system=_GENERATOR_SYSTEM,
            temperature=0.3,
            max_tokens=8000,  # Enough for 25 variables with full reasoning
        )
        data = llm_client.extract_json(text)

        return ContextAnalysisResponse(
            variables=data.get("variables", []),
            agents=data.get("agents", []),
            assumptions=data.get("assumptions", []),
            success_criteria=data.get("success_criteria", ""),
            time_horizon=int(data.get("time_horizon", 12)),
            num_runs=int(data.get("num_runs", 1000)),
        )

    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        logger.warning("Context analysis LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")


@router.post("/analyze-prompt", response_model=PromptAnalysisResponse)
async def analyze_prompt(body: PromptRequest, user: dict = Depends(get_current_user)):
    """
    Generate a full simulation from a free-text user prompt.
    Claude auto-detects the best category, generates a name/description,
    and produces the complete simulation config in one shot.
    """

    if not settings.anthropic_api_key:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    prompt = f"""You are a senior simulation strategist. A user wants to create a Monte Carlo simulation from a single prompt. Your job is to:
1. Detect the best simulation category from: startup, pricing, policy, marketing, product, finance, biology, trend, custom
2. Generate a short simulation name (under 60 chars) and a one-sentence description
3. Generate a complete simulation configuration with variables, agents, and assumptions

USER PROMPT:
"{body.prompt}"

Return a JSON object with this exact structure:
{{
  "category": "<one of: startup, pricing, policy, marketing, product, finance, biology, trend, custom>",
  "name": "<short simulation name>",
  "description": "<one-sentence description of what this simulates>",
  "variables": [
    {{
      "name": "snake_case_var_name",
      "label": "Human Readable Label",
      "value": <realistic starting value>,
      "min": <plausible minimum>,
      "max": <plausible maximum>,
      "unit": "$" | "%" | "users" | "months" | etc,
      "reasoning": "Why this value (under 15 words)"
    }}
  ],
  "agents": [
    {{
      "type": "customer|competitor|investor|regulator|market|trader|molecule|data_stream",
      "label": "Agent Label",
      "count": <number>,
      "sensitivity": <0.0-1.0>,
      "reasoning": "Why this config (under 15 words)"
    }}
  ],
  "assumptions": ["assumption 1", "assumption 2", ...],
  "success_criteria": "What constitutes success for this scenario",
  "time_horizon": <months or periods as integer>,
  "num_runs": <recommended Monte Carlo runs, 1000-5000>
}}

RULES:
1. Generate 15-25 variables that are specific to the scenario described.
2. All values must be grounded in the user's prompt — infer realistic numbers from context clues (industry, scale, stage).
3. Ranges should be realistic (±50-200% of the starting value, not zero-to-infinity).
4. Include 3-6 agents whose types match the detected category.
5. Assumptions should list what you inferred when the user didn't provide exact data.
6. Success criteria must be specific to this scenario.
7. The name should be descriptive but concise — not generic."""

    try:
        text = await llm_client.stream_collect(
            messages=[{"role": "user", "content": prompt}],
            system=_GENERATOR_SYSTEM,
            temperature=0.3,
            max_tokens=8000,
        )
        data = llm_client.extract_json(text)

        return PromptAnalysisResponse(
            category=data.get("category", "custom"),
            name=data.get("name", "Untitled Simulation"),
            description=data.get("description", ""),
            variables=data.get("variables", []),
            agents=data.get("agents", []),
            assumptions=data.get("assumptions", []),
            success_criteria=data.get("success_criteria", ""),
            time_horizon=int(data.get("time_horizon", 12)),
            num_runs=int(data.get("num_runs", 1000)),
        )

    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        logger.warning("Prompt analysis LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")
