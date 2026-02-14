"""
Catfish API - FastAPI Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .settings import settings

app = FastAPI(
    title="Catfish API",
    description="DateGuard analysis backend",
    version="0.1.0",
)

# CORS configuration for extension and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "chrome-extension://*",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "app": "Catfish API",
        "version": "0.1.0",
        "status": "running",
    }
