"""
Pydantic schemas for API request/response models
"""
from pydantic import BaseModel
from typing import Optional, List


# Health check
class HealthResponse(BaseModel):
    ok: bool


# Audio analysis (placeholder)
class AudioAnalysisRequest(BaseModel):
    """Request for audio analysis - to be implemented"""
    audio_url: Optional[str] = None
    # audio_data will be handled via multipart form


class AudioAnalysisResponse(BaseModel):
    """Response from audio analysis"""
    transcript: str
    analysis: str
    risk_score: float  # 0-1, higher = more suspicious
    flags: List[str]


# Image analysis (placeholder)
class ImageAnalysisRequest(BaseModel):
    """Request for image analysis - to be implemented"""
    image_url: Optional[str] = None


class ImageAnalysisResponse(BaseModel):
    """Response from image analysis"""
    analysis: str
    risk_score: float
    flags: List[str]
    reverse_search_results: Optional[List[str]] = None


# Text analysis (placeholder)
class TextAnalysisRequest(BaseModel):
    """Request for text analysis"""
    text: str
    context: Optional[str] = None  # e.g., "tinder chat", "hinge profile"


class TextAnalysisResponse(BaseModel):
    """Response from text analysis"""
    analysis: str
    risk_score: float
    flags: List[str]
    suggestions: List[str]
