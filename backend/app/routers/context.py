"""
AI-powered context analysis endpoint.
Takes a user's company/scenario context and uses Claude to generate
realistic simulation variables, agent configs, and assumptions.
"""
import json
import re
import anthropic
from fastapi import APIRouter, HTTPException
from app.config import settings
from app.models.simulation import CompanyContext, ContextAnalysisResponse

router = APIRouter(prefix="/api/context", tags=["context"])


def _repair_truncated_json(text: str) -> str:
    """
    Attempt to repair a truncated JSON string by:
    1. Closing any open string literal
    2. Closing open arrays/objects in the right order
    3. Stripping the last incomplete key-value pair before closing
    """
    s = text.rstrip()

    # Track structure using a stack
    stack = []        # 'o' = object, 'a' = array
    in_string = False
    escape_next = False

    for ch in s:
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            stack.append('o')
        elif ch == '[':
            stack.append('a')
        elif ch in ']}':
            if stack:
                stack.pop()

    # If we're mid-string, close it
    if in_string:
        s += '"'

    # Remove trailing incomplete item (e.g. `, "key": ` or `, {` )
    s = re.sub(r',\s*"[^"]*"?\s*:\s*[^,\}\]]*$', '', s)
    s = re.sub(r',\s*\{[^}]*$', '', s)
    s = re.sub(r',\s*"[^"]*$', '', s)

    # Strip trailing comma
    s = re.sub(r',\s*$', '', s)

    # Close open structures in reverse order
    for kind in reversed(stack):
        s += ']' if kind == 'a' else '}'

    return s


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from Claude's response.
    Handles: markdown code fences, trailing commas, JS comments,
    control characters, and truncated responses.
    """
    # 1. Strip markdown code fences
    fenced = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    if fenced:
        text = fenced.group(1).strip()

    # 2. Isolate the JSON object (everything from first { to last })
    start = text.find("{")
    if start < 0:
        raise ValueError("No JSON object found in response")
    end = text.rfind("}") + 1
    if end <= start:
        raise ValueError("No complete JSON object found in response")
    raw = text[start:end]

    # 3. Standard cleanups
    # a) Remove // line comments (only outside strings — simple heuristic)
    raw = re.sub(r'(?<!["\w])//[^\n]*', '', raw)
    # b) Remove trailing commas before } or ]
    raw = re.sub(r',(\s*[}\]])', r'\1', raw)
    # c) Replace bare control characters (real newlines/tabs inside strings)
    #    Only replace inside string literals
    def fix_control_chars(m):
        s = m.group(0)
        s = s.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
        return s
    raw = re.sub(r'"(?:[^"\\]|\\.)*"', fix_control_chars, raw, flags=re.DOTALL)

    # 4. Fast path
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 5. Truncation recovery — the response was cut off at max_tokens
    repaired = _repair_truncated_json(raw)
    repaired = re.sub(r',(\s*[}\]])', r'\1', repaired)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not parse JSON from AI response: {e}") from e


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
async def analyze_context(body: CompanyContext):
    """Analyze user's company/scenario context using Claude and generate simulation parameters."""

    if not settings.anthropic_api_key:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    prompt = _build_prompt(body.category.value, body.context)
    if not prompt:
        raise HTTPException(status_code=400, detail=f"Unsupported category: {body.category}")

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    try:
        # Use streaming to collect the full response — avoids read-timeout on slow connections
        # and lets us start parsing as soon as the last token arrives.
        text_chunks: list[str] = []
        async with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=8000,  # Enough for 25 variables with full reasoning
            system=(
                "You are a simulation configuration generator. "
                "You MUST respond with ONLY a single valid JSON object — "
                "no markdown, no code fences, no comments, no explanation before or after. "
                "The JSON must be syntactically valid and COMPLETE — never truncate. "
                "Keep all 'reasoning' field values under 15 words to stay within token limits."
            ),
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for chunk in stream.text_stream:
                text_chunks.append(chunk)

        text = "".join(text_chunks)
        data = _extract_json(text)

        return ContextAnalysisResponse(
            variables=data.get("variables", []),
            agents=data.get("agents", []),
            assumptions=data.get("assumptions", []),
            success_criteria=data.get("success_criteria", ""),
            time_horizon=int(data.get("time_horizon", 12)),
            num_runs=int(data.get("num_runs", 1000)),
        )

    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI response: {str(e)}")
