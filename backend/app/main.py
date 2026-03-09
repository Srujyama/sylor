"""
Sylor FastAPI Backend
Multi-Domain AI Simulation Platform
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time

from app.config import settings
from app.routers import simulations, templates, upload, context

app = FastAPI(
    title="Sylor API",
    description="Multi-Domain AI Simulation Platform API",
    version="2.0.0",
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
app.include_router(upload.router)
app.include_router(context.router)


@app.get("/")
async def root():
    return {
        "service": "Sylor API",
        "version": "2.0.0",
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
