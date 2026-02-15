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
class ArtifactSignal(BaseModel):
    """Individual AI artifact signal detected"""
    category: str  # e.g., "texture", "structure", "lighting", "metadata"
    signal: str  # e.g., "hyper_smooth_skin", "finger_anomaly"
    description: str  # Human-readable description
    weight: float  # Contribution to final score (0.0-1.0)
    severity: str  # "low", "medium", "high"


class ImageAnalysisResponse(BaseModel):
    """Response from image analysis"""
    catfish_score: int  # 0-100, likelihood image is stolen/fake
    ai_generated_score: int  # 0-100, likelihood image is AI-generated
    confidence_band: str  # "likely_real", "low_suspicion", "uncertain", "likely_ai", "strong_ai_indicators"
    top_signals: List[ArtifactSignal]  # Top contributing factors
    flags: List[str]
    explanation: str
    ai_detection_rationale: str  # Detailed explanation of AI score
    recommended_action: str
    reverse_search_steps: List[str]
    # Calibration metadata
    signal_count: int  # Number of AI signals detected
    escalation_applied: bool  # Whether non-linear escalation was triggered


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
