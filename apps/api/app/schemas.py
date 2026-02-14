"""
Pydantic schemas for API request/response models
"""
from pydantic import BaseModel
from typing import Optional, List


# Health check
class HealthResponse(BaseModel):
    ok: bool


# Audio analysis
class AudioAnalysisResponse(BaseModel):
    """Response from audio analysis"""
    risk_score: int  # 0-100
    category: str  # "safe" | "suspicious" | "scam_likely"
    flags: List[str]
    explanation: str
    recommended_action: str
    suggested_reply: str
    ai_voice_score: int  # 0-100, likelihood voice is AI-generated
    ai_voice_rationale: str
    transcript: str


# Image analysis
class ImageAnalysisResponse(BaseModel):
    """Response from image analysis"""
    catfish_score: int  # 0-100, likelihood image is stolen/fake
    ai_generated_score: int  # 0-100, likelihood image is AI-generated
    flags: List[str]
    explanation: str
    recommended_action: str
    reverse_search_steps: List[str]


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
