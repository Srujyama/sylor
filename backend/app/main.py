"""
Sylor FastAPI Backend
Multi-Domain AI Simulation Platform

Powered by MiroFish-inspired multi-agent intelligence:
- Knowledge graph construction from documents (GraphRAG)
- LLM-powered agent profile generation
- ReACT-pattern report generation
- Interactive agent chat
- Monte Carlo simulation engine
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time

from app.config import settings
from app.routers import (
    simulations, templates, upload, context, projects, graphs, reports,
    users, export, shares, analytics, public, demo, insights, composites,
)
from app.middleware.rate_limit import RateLimitMiddleware

app = FastAPI(
    title="Sylor API",
    description="Multi-Domain AI Simulation Platform with Knowledge Graph Intelligence",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Rate limiting (must be added before CORS so it runs after CORS in the
# middleware stack — Starlette middleware order is LIFO)
app.add_middleware(RateLimitMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Original Routers ─────────────────────────────────────────────────────────
app.include_router(simulations.router)
app.include_router(templates.router)
app.include_router(upload.router)
app.include_router(context.router)
app.include_router(users.router)      # User profile & preferences
app.include_router(export.router)     # Data export
app.include_router(shares.router)     # Share links + public frozen snapshots
app.include_router(analytics.router)  # Per-user analytics summary
app.include_router(public.router)     # Public anonymized platform stats
app.include_router(demo.router)       # Zero-signup public demo + claim
app.include_router(insights.router)   # Narrative dashboard digest
app.include_router(composites.router) # Cross-domain composite simulations (DAG of sub-sims)

# ── New MiroFish-Inspired Routers ────────────────────────────────────────────
app.include_router(projects.router)   # Unified project orchestration
app.include_router(graphs.router)     # Knowledge graph queries
app.include_router(reports.router)    # ReACT report generation & chat


@app.get("/")
async def root():
    return {
        "service": "Sylor API",
        "version": "3.0.0",
        "status": "healthy",
        "docs": "/docs",
        "features": {
            "simulations": "/api/simulations — Monte Carlo simulation engine",
            "projects": "/api/projects — Full pipeline: documents → graph → profiles → simulation → report",
            "graphs": "/api/graphs — Knowledge graph queries",
            "reports": "/api/reports — AI-powered report generation & chat",
            "templates": "/api/templates — Pre-built simulation templates",
            "context": "/api/context/analyze — AI-powered context analysis",
            "upload": "/api/upload/parse — File upload & parsing",
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time(), "version": "3.0.0"}


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
