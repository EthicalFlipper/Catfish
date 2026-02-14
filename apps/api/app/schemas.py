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


# Text analysis
class TextAnalysisRequest(BaseModel):
    """Request for text analysis"""
    text: str
    user_notes: Optional[str] = None


class TextAnalysisResponse(BaseModel):
    """Response from text analysis"""
    ai_score: int  # 0-100, likelihood text is AI-generated
    risk_score: int  # 0-100, likelihood of scam/danger
    category: str  # "safe" | "suspicious" | "scam_likely"
    flags: List[str]
    explanation: str
    recommended_action: str
    suggested_reply: str
