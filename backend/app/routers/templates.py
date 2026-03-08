from fastapi import APIRouter
from typing import List

router = APIRouter(prefix="/api/templates", tags=["templates"])

TEMPLATES = [
    {
        "id": "startup-launch",
        "name": "Startup Launch",
        "category": "startup",
        "description": "Model your go-to-market strategy with customer acquisition, burn rate, and market penetration scenarios.",
        "icon": "🚀",
        "difficulty": "beginner",
        "tags": ["startup", "saas", "growth"],
        "config": {
            "num_runs": 1000,
            "time_horizon": 24,
            "variables": [
                {"name": "budget", "label": "Monthly Budget", "type": "currency", "value": 50000, "min": 5000, "max": 1000000, "unit": "$"},
                {"name": "price_per_unit", "label": "Price per Month", "type": "currency", "value": 99, "min": 9, "max": 999, "unit": "$"},
                {"name": "market_size", "label": "TAM (users)", "type": "number", "value": 1000000, "min": 10000, "max": 100000000, "unit": ""},
                {"name": "conversion_rate", "label": "Conversion Rate", "type": "percentage", "value": 3, "min": 0.1, "max": 20, "unit": "%"},
                {"name": "churn_rate", "label": "Monthly Churn", "type": "percentage", "value": 5, "min": 0.5, "max": 30, "unit": "%"},
                {"name": "team_size", "label": "Team Size", "type": "number", "value": 5, "min": 1, "max": 50, "unit": " people"},
            ],
            "agents": [
                {"type": "customer", "name": "Target Users", "count": 500, "sensitivity": 0.7},
                {"type": "competitor", "name": "Market Competitors", "count": 3, "sensitivity": 0.8},
                {"type": "investor", "name": "Angel Investors", "count": 10, "sensitivity": 0.6},
                {"type": "market", "name": "Market Forces", "count": 1, "sensitivity": 0.5},
            ],
        },
    },
    {
        "id": "pricing-strategy",
        "name": "Pricing Strategy",
        "category": "pricing",
        "description": "Find optimal price points by simulating elasticity, competitor reactions, and revenue impact.",
        "icon": "💰",
        "difficulty": "beginner",
        "tags": ["pricing", "revenue", "elasticity"],
        "config": {
            "num_runs": 2000,
            "time_horizon": 12,
            "variables": [
                {"name": "current_price", "label": "Current Price", "type": "currency", "value": 49, "min": 1, "max": 999, "unit": "$"},
                {"name": "test_price", "label": "New Price", "type": "currency", "value": 79, "min": 1, "max": 999, "unit": "$"},
                {"name": "price_per_unit", "label": "Price (sim var)", "type": "currency", "value": 79, "min": 1, "max": 999, "unit": "$"},
                {"name": "market_size", "label": "Customer Base", "type": "number", "value": 5000, "min": 100, "max": 1000000, "unit": ""},
                {"name": "conversion_rate", "label": "Conversion Rate", "type": "percentage", "value": 5, "min": 0.1, "max": 30, "unit": "%"},
                {"name": "churn_rate", "label": "Price-Induced Churn", "type": "percentage", "value": 8, "min": 0.5, "max": 40, "unit": "%"},
            ],
            "agents": [
                {"type": "customer", "name": "Price-Sensitive Customers", "count": 1000, "sensitivity": 0.85},
                {"type": "competitor", "name": "Market Competitors", "count": 5, "sensitivity": 0.9},
            ],
        },
    },
    {
        "id": "market-entry",
        "name": "Market Entry",
        "category": "custom",
        "description": "Assess new market opportunities against incumbents, regulatory barriers, and switching costs.",
        "icon": "🌍",
        "difficulty": "advanced",
        "tags": ["expansion", "market entry", "competition"],
        "config": {
            "num_runs": 3000,
            "time_horizon": 36,
            "variables": [
                {"name": "budget", "label": "Entry Budget", "type": "currency", "value": 500000, "min": 50000, "max": 10000000, "unit": "$"},
                {"name": "price_per_unit", "label": "Entry Price", "type": "currency", "value": 299, "min": 49, "max": 2999, "unit": "$"},
                {"name": "market_size", "label": "Target Market Size", "type": "number", "value": 10000000, "min": 100000, "max": 1000000000, "unit": ""},
                {"name": "conversion_rate", "label": "Win Rate", "type": "percentage", "value": 2, "min": 0.1, "max": 15, "unit": "%"},
                {"name": "churn_rate", "label": "Churn Rate", "type": "percentage", "value": 3, "min": 0.1, "max": 20, "unit": "%"},
            ],
            "agents": [
                {"type": "customer", "name": "Enterprise Buyers", "count": 3000, "sensitivity": 0.5},
                {"type": "competitor", "name": "Incumbents", "count": 10, "sensitivity": 0.95},
                {"type": "regulator", "name": "Industry Regulators", "count": 2, "sensitivity": 0.3},
                {"type": "investor", "name": "VCs", "count": 12, "sensitivity": 0.7},
                {"type": "market", "name": "Market Forces", "count": 1, "sensitivity": 0.6},
            ],
        },
    },
]


@router.get("", response_model=List[dict])
async def list_templates(category: str = None):
    if category:
        return [t for t in TEMPLATES if t["category"] == category]
    return TEMPLATES


@router.get("/{template_id}")
async def get_template(template_id: str):
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Template not found")
