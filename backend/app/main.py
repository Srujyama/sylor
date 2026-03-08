"""
SimWorld FastAPI Backend
Multi-Agent AI Simulation Platform
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time

from app.config import settings
from app.routers import simulations, templates

app = FastAPI(
    title="SimWorld API",
    description="Multi-Agent AI Simulation Platform API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(simulations.router)
app.include_router(templates.router)


@app.get("/")
async def root():
    return {
        "service": "SimWorld API",
        "version": "1.0.0",
        "status": "healthy",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
