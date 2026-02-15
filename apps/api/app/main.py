"""
Catfish API - FastAPI Backend
"""
import json
import base64
import tempfile
import subprocess
import os
import logging
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from typing import Optional

from .settings import settings
from .schemas import TextAnalysisRequest, TextAnalysisResponse, ImageAnalysisResponse, AudioAnalysisResponse, AIOrNotResult
from .aiornot import analyze_image_bytes, AIOrNotAPIError, AIOrNotResult as AIOrNotDataClass

# Configure logging
logger = logging.getLogger(__name__)

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


# System prompt for text analysis
TEXT_ANALYSIS_PROMPT = """You are a dating safety analyst helping users identify potential catfishing, romance scams, and AI-generated messages in dating app conversations.

Analyze the provided conversation text and return a JSON object with EXACTLY these keys:
{
  "ai_score": <number 0-100, likelihood the message was written by AI/ChatGPT>,
  "risk_score": <number 0-100, likelihood this is a scam or dangerous>,
  "category": <"safe" | "suspicious" | "scam_likely">,
  "flags": <array of specific red flag strings found>,
  "explanation": <string explaining your analysis covering BOTH AI detection and scam risk>,
  "recommended_action": <string with actionable advice>,
  "suggested_reply": <string with a safe response the user could send>
}

AI-GENERATED TEXT indicators (for ai_score):
- Overly polished, formal, or generic language
- Unnaturally perfect grammar and structure
- Lack of personal quirks, typos, or casual speech
- Repetitive sentence patterns or phrasing
- Generic compliments without specific details
- Messages that feel templated or cookie-cutter
- Unusual consistency in tone throughout
- Overuse of filler phrases like "I completely understand" or "That's so interesting"

SCAM/DANGER indicators (for risk_score):
- Requests for money, gift cards, or financial help
- Refusing to video chat or meet in person
- Moving too fast (professing love quickly)
- Inconsistent stories or details
- Pressure tactics or urgency
- Requests to move off the dating platform quickly
- Poor grammar inconsistent with claimed background
- Too-good-to-be-true profiles or stories
- Asking for personal/financial information
- Military romance scam patterns

Category guidelines (based on risk_score):
- "safe": risk_score 0-30, normal conversation
- "suspicious": risk_score 31-70, some red flags present
- "scam_likely": risk_score 71-100, strong scam indicators

Return ONLY the JSON object, no markdown formatting, no explanation outside the JSON."""


def get_mock_response() -> dict:
    """Return mock response when API key is missing"""
    return {
        "ai_score": 0,
        "risk_score": 0,
        "category": "safe",
        "flags": [],
        "explanation": "Analysis unavailable: OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file to enable real analysis.",
        "recommended_action": "Configure the API key to get actual analysis results.",
        "suggested_reply": "Unable to generate - API key missing."
    }


def parse_llm_response(content: str) -> dict:
    """Parse LLM response, stripping markdown if present"""
    text = content.strip()
    # Remove markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json or ```)
        lines = lines[1:]
        # Remove last line (```)
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    return json.loads(text)


async def call_openai_for_analysis(text: str, user_notes: str | None) -> dict:
    """Call OpenAI API for text analysis with retry logic"""
    client = OpenAI(api_key=settings.openai_api_key)
    
    user_message = f"Conversation to analyze:\n\n{text}"
    if user_notes:
        user_message += f"\n\nUser's additional notes/concerns:\n{user_notes}"
    
    # First attempt
    response = client.chat.completions.create(
        model=settings.gpt_model,
        messages=[
            {"role": "system", "content": TEXT_ANALYSIS_PROMPT},
            {"role": "user", "content": user_message}
        ],
        temperature=0.3,
    )
    
    content = response.choices[0].message.content or ""
    
    try:
        return parse_llm_response(content)
    except json.JSONDecodeError:
        # Retry with repair prompt
        repair_response = client.chat.completions.create(
            model=settings.gpt_model,
            messages=[
                {"role": "system", "content": TEXT_ANALYSIS_PROMPT},
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": content},
                {"role": "user", "content": "Return only valid JSON, no markdown."}
            ],
            temperature=0.1,
        )
        repair_content = repair_response.choices[0].message.content or ""
        return parse_llm_response(repair_content)


@app.post("/analyze/text", response_model=TextAnalysisResponse)
async def analyze_text(request: TextAnalysisRequest):
    """Analyze conversation text for catfishing/scam indicators"""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    # Return mock if no API key
    if not settings.openai_api_key:
        return get_mock_response()
    
    try:
        result = await call_openai_for_analysis(request.text, request.user_notes)
        
        # Validate required fields
        required_fields = ["ai_score", "risk_score", "category", "flags", "explanation", "recommended_action", "suggested_reply"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing field: {field}")
        
        # Ensure category is valid
        if result["category"] not in ["safe", "suspicious", "scam_likely"]:
            result["category"] = "suspicious"
        
        # Ensure scores are in range
        result["ai_score"] = max(0, min(100, int(result["ai_score"])))
        result["risk_score"] = max(0, min(100, int(result["risk_score"])))
        
        return result
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


# =============================================================================
# COMPREHENSIVE AI IMAGE DETECTION SYSTEM
# =============================================================================
# This system uses a weighted evidence model to detect AI-generated images
# with high sensitivity while maintaining low false-positive rates.
# =============================================================================

IMAGE_ANALYSIS_PROMPT = """You are a FORENSIC IMAGE ANALYST specializing in detecting AI-generated images (Midjourney, Stable Diffusion, DALL-E, etc.) and stolen/catfish photos.

YOUR TASK: Analyze this image using a WEIGHTED EVIDENCE MODEL. You must be STRICT and SENSITIVE to AI artifacts while avoiding false positives on real photos.

## CRITICAL INSTRUCTION
You MUST examine the image forensically. Do NOT default to low scores. If you detect even subtle AI artifacts, you MUST report them and score accordingly. Under-detection is a serious failure.

## WEIGHTED ARTIFACT CATEGORIES

### A. TEXTURE & SURFACE ARTIFACTS [Weight: HIGH - 25 points max]
Examine carefully for:
- HYPER-SMOOTH SKIN: AI creates unnaturally smooth, poreless skin (even in "realistic" images). Real skin has pores, fine lines, subtle imperfections.
- PLASTIC/WAXY TEXTURE: Skin looks like it's made of plastic or wax, lacking subsurface scattering variation
- INCONSISTENT SKIN DETAIL: Some areas ultra-smooth, others suddenly detailed
- UNNATURAL FABRIC: Clothing patterns that blend or morph incorrectly, fabric texture too uniform
- HAIR TEXTURE ARTIFACTS: Individual strands that merge, hair that looks painted, unnatural shine patterns

Score this category 0-25:
- 0-5: Natural textures consistent with real photography
- 6-12: Some smoothing but could be post-processing
- 13-18: Noticeable artificial smoothness
- 19-25: Clearly synthetic texture (waxy, plastic, AI-typical)

### B. STRUCTURAL DISTORTIONS [Weight: CRITICAL - 30 points max]
These are the STRONGEST indicators. Look for:
- FINGER/HAND ANOMALIES: Wrong number of fingers, merged fingers, impossible joint angles, hands that dissolve into blur
- EYE IRREGULARITIES: Mismatched pupil shapes, unrealistic iris detail (too perfect or too random), asymmetric reflections, wrong catchlight positions
- FACIAL ASYMMETRY ARTIFACTS: Not natural asymmetry, but AI-style warping - one side of face slightly different style
- EARRING/JEWELRY MISMATCH: Earrings that don't match, jewelry that morphs into skin, accessories that defy physics
- TEETH ANOMALIES: Wrong number of teeth, teeth that blend together, gums that look painted
- BACKGROUND GEOMETRY WARPING: Straight lines that bend near the subject, architecture that doesn't make sense
- CLOTHING STRUCTURE: Collars that don't connect, buttons misaligned, clothing that merges with body

Score this category 0-30:
- 0-5: No structural anomalies detected
- 6-12: Minor issues (could be motion blur or low resolution)
- 13-20: Noticeable structural problems (likely AI)
- 21-30: Clear structural impossibilities (definitely AI)

### C. LIGHTING & PHYSICS [Weight: MEDIUM - 20 points max]
- INCONSISTENT LIGHT DIRECTION: Multiple conflicting light sources that don't match a real environment
- IMPOSSIBLE SHADOWS: Shadows going wrong directions, missing shadows, shadows with wrong softness
- HALO/GLOW ARTIFACTS: Unnatural bright edges around subjects (common in diffusion models)
- DEPTH-OF-FIELD ANOMALIES: Blur that doesn't follow proper optical physics, areas in focus that shouldn't be
- REFLECTION INCONSISTENCIES: Reflections in eyes/glasses that show impossible scenes

Score this category 0-20:
- 0-5: Consistent natural lighting
- 6-10: Minor inconsistencies (could be mixed lighting)
- 11-15: Noticeable lighting problems
- 16-20: Physically impossible lighting

### D. STYLE & GENERATION SIGNATURES [Weight: MEDIUM - 15 points max]
- MIDJOURNEY SIGNATURES: Hyper-detailed skin gradients, painterly quality, over-saturated colors, dramatic lighting
- STABLE DIFFUSION PATTERNS: Specific blur patterns, characteristic noise in dark areas
- DALL-E CHARACTERISTICS: Certain color palettes, specific rendering of eyes
- OVER-DETAILED IRISES: Irises with too much detail, unrealistic patterns
- "TOO PERFECT" AESTHETIC: Everything looks too aesthetically composed, like a render

Score this category 0-15:
- 0-3: No generation signatures detected
- 4-8: Subtle stylistic similarities
- 9-12: Notable AI-style characteristics
- 13-15: Strong generation model signature

### E. METADATA & TECHNICAL SIGNALS [Weight: LOW - 10 points max]
(Note: You cannot see metadata, but you CAN see compression artifacts)
- UNNATURAL COMPRESSION: AI images often have uniform noise patterns unlike camera sensor noise
- RESOLUTION ANOMALIES: Upscaled AI images have characteristic smoothness
- EDGE QUALITY: AI images often have subtle edge artifacts

Score this category 0-10:
- 0-3: Natural image characteristics
- 4-6: Some unusual technical aspects
- 7-10: Technical artifacts suggesting AI generation

## CALIBRATION RULES

### Non-Linear Escalation
If you detect signals in 3+ categories with medium or higher severity:
→ ADD 15 BONUS POINTS to ai_generated_score
→ Set "escalation_applied": true

If you detect a DEFINITIVE structural impossibility (wrong finger count, etc.):
→ MINIMUM ai_generated_score of 70

### False Positive Protection
REDUCE score by 5-10 points if you detect:
- Natural sensor noise patterns (grain that varies realistically)
- Authentic lens distortion (barrel/pincushion distortion consistent with wide-angle)
- Real JPEG compression artifacts (blocky, not smooth)
- Professional lighting that's consistent (studio setups are real)
- Instagram/Lightroom filters (these are edits, not AI generation)

DO NOT penalize:
- Professional DSLR portraits
- Studio photography with perfect lighting
- Retouched/smoothed skin (Facetune, Lightroom) - reduce this penalty
- Intentionally artistic photography

## CONFIDENCE BANDS

Based on final ai_generated_score:
- 0-20%: "likely_real" - No significant AI indicators
- 21-40%: "low_suspicion" - Minor concerns, probably real
- 41-60%: "uncertain" - Mixed signals, cannot determine
- 61-80%: "likely_ai" - Strong AI indicators present
- 81-100%: "strong_ai_indicators" - Definitive AI artifacts

## OUTPUT FORMAT

Return a JSON object with EXACTLY these keys:
{
  "catfish_score": <number 0-100>,
  "ai_generated_score": <number 0-100, calculated from weighted categories>,
  "confidence_band": <"likely_real" | "low_suspicion" | "uncertain" | "likely_ai" | "strong_ai_indicators">,
  "top_signals": [
    {
      "category": <"texture" | "structure" | "lighting" | "style" | "technical">,
      "signal": <string identifier like "hyper_smooth_skin" or "finger_anomaly">,
      "description": <detailed description of what you found>,
      "weight": <0.0-1.0 contribution to score>,
      "severity": <"low" | "medium" | "high">
    }
  ],
  "flags": <array of warning flag strings>,
  "explanation": <overall analysis summary>,
  "ai_detection_rationale": <detailed explanation of why you assigned this AI score, including category breakdowns>,
  "recommended_action": <actionable advice>,
  "reverse_search_steps": [
    "Save or screenshot this image",
    "Go to images.google.com and click the camera icon",
    "Upload the image to search for matches",
    "Check if this image appears elsewhere with different identities",
    "Try TinEye.com for additional reverse image search"
  ],
  "signal_count": <number of AI signals detected>,
  "escalation_applied": <true if non-linear escalation was triggered, false otherwise>,
  "category_scores": {
    "texture": <0-25>,
    "structure": <0-30>,
    "lighting": <0-20>,
    "style": <0-15>,
    "technical": <0-10>
  }
}

IMPORTANT REMINDERS:
1. Be STRICT - AI images are getting better, you must catch subtle artifacts
2. A clearly AI-generated image should NEVER score below 60%
3. Do NOT default to low scores out of caution - evidence-based scoring only
4. Report ALL artifacts you find, even subtle ones
5. Your top_signals should list the 3-5 most significant findings

Return ONLY the JSON object, no markdown formatting."""


def get_image_mock_response() -> dict:
    """Return mock response when vision API is unavailable"""
    return {
        "catfish_score": 0,
        "ai_generated_score": 0,
        "confidence_band": "uncertain",
        "top_signals": [],
        "flags": ["vision_unavailable"],
        "explanation": "Image analysis unavailable: OpenAI API key not configured or vision model not accessible. Please add OPENAI_API_KEY to your .env file.",
        "ai_detection_rationale": "Cannot analyze - API key missing.",
        "recommended_action": "Configure the API key for real analysis. In the meantime, manually reverse image search this photo using Google Images or TinEye.",
        "reverse_search_steps": [
            "Save or screenshot the image",
            "Go to images.google.com and click the camera icon",
            "Upload the image or drag it into the search box",
            "Review results to see if this photo appears elsewhere with different names",
            "Try TinEye.com as an additional reverse image search"
        ],
        "signal_count": 0,
        "escalation_applied": False,
        "aiornot": {
            "available": False,
            "verdict": None,
            "ai_confidence": None,
            "generator": None,
            "generator_confidence": None,
            "deepfake_detected": None,
            "nsfw_detected": None,
            "quality_passed": None,
            "error": "API keys not configured"
        }
    }


def get_confidence_band(score: int) -> str:
    """Convert AI score to confidence band"""
    if score <= 20:
        return "likely_real"
    elif score <= 40:
        return "low_suspicion"
    elif score <= 60:
        return "uncertain"
    elif score <= 80:
        return "likely_ai"
    else:
        return "strong_ai_indicators"


def calibrate_ai_score(result: dict) -> dict:
    """
    Apply calibration logic to ensure consistent scoring.
    This adds non-linear escalation and validates confidence bands.
    """
    ai_score = result.get("ai_generated_score", 0)
    top_signals = result.get("top_signals", [])
    category_scores = result.get("category_scores", {})
    
    # Count signals by severity
    high_severity_count = sum(1 for s in top_signals if s.get("severity") == "high")
    medium_severity_count = sum(1 for s in top_signals if s.get("severity") == "medium")
    
    # Count categories with significant scores
    categories_with_signals = sum(1 for cat, score in category_scores.items() 
                                   if score >= 5)  # At least 5 points in category
    
    escalation_applied = False
    
    # Non-linear escalation rule 1: Multiple categories affected
    if categories_with_signals >= 3:
        original_score = ai_score
        ai_score = min(100, ai_score + 15)
        if ai_score > original_score:
            escalation_applied = True
    
    # Non-linear escalation rule 2: Multiple high severity signals
    if high_severity_count >= 2:
        original_score = ai_score
        ai_score = max(ai_score, 70)  # Floor at 70 for multiple high severity
        if ai_score > original_score:
            escalation_applied = True
    
    # Non-linear escalation rule 3: Structure category is very high (definitive)
    if category_scores.get("structure", 0) >= 20:
        original_score = ai_score
        ai_score = max(ai_score, 75)  # Structural problems are very telling
        if ai_score > original_score:
            escalation_applied = True
    
    # Update the result
    result["ai_generated_score"] = min(100, max(0, ai_score))
    result["escalation_applied"] = escalation_applied or result.get("escalation_applied", False)
    result["confidence_band"] = get_confidence_band(result["ai_generated_score"])
    result["signal_count"] = len(top_signals)
    
    return result


async def call_openai_for_image_analysis(image_data: bytes) -> dict:
    """
    Call OpenAI Vision API for comprehensive AI image detection.
    Uses gpt-4o for better visual analysis capabilities.
    """
    client = OpenAI(api_key=settings.openai_api_key)
    
    # Convert image to base64
    base64_image = base64.b64encode(image_data).decode('utf-8')
    
    # Determine image type from magic bytes
    image_type = "png"
    if image_data[:2] == b'\xff\xd8':
        image_type = "jpeg"
    elif image_data[:4] == b'\x89PNG':
        image_type = "png"
    elif image_data[:4] == b'RIFF':
        image_type = "webp"
    
    response = client.chat.completions.create(
        model="gpt-4o",  # Use full gpt-4o for better forensic analysis
        messages=[
            {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text", 
                        "text": """Analyze this dating profile image for AI-generation artifacts.

CRITICAL: Examine closely for:
1. Skin texture - Is it unnaturally smooth? Waxy? Plastic-looking?
2. Hands/fingers - Are there any anomalies?
3. Eyes - Mismatched pupils? Unrealistic iris detail?
4. Background - Any warping or impossible geometry?
5. Lighting - Multiple conflicting light sources?
6. Hair - Does it look painted or merge unnaturally?
7. Accessories - Earrings that don't match? Jewelry defying physics?

Be STRICT in your assessment. Modern AI images are sophisticated - look for subtle artifacts.
A clearly AI-generated image should score 60%+ on ai_generated_score."""
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/{image_type};base64,{base64_image}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        temperature=0.2,  # Lower temperature for more consistent forensic analysis
        max_tokens=2000,  # More tokens for detailed analysis
    )
    
    content = response.choices[0].message.content or ""
    
    try:
        result = parse_llm_response(content)
        return result
    except json.JSONDecodeError:
        # Retry with repair prompt, including the image again
        repair_response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this image for AI-generation:"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/{image_type};base64,{base64_image}",
                                "detail": "high"
                            }
                        }
                    ]
                },
                {"role": "assistant", "content": content},
                {"role": "user", "content": "Your response was not valid JSON. Return ONLY the JSON object, no markdown code blocks."}
            ],
            temperature=0.1,
        )
        repair_content = repair_response.choices[0].message.content or ""
        return parse_llm_response(repair_content)


async def call_aiornot_api(image_data: bytes) -> dict:
    """
    Call AI or Not API for specialized ML-based AI detection.
    Returns structured result or error information.
    """
    if not settings.aiornot_api_key:
        return {
            "available": False,
            "error": "AIORNOT_API_KEY not configured"
        }
    
    # Temporarily set the API key in environment for the module
    original_key = os.environ.get("AIORNOT_API_KEY")
    os.environ["AIORNOT_API_KEY"] = settings.aiornot_api_key
    
    try:
        result = analyze_image_bytes(image_data)
        return {
            "available": True,
            "verdict": result.verdict,
            "ai_confidence": result.ai_confidence,
            "generator": result.generator,
            "generator_confidence": result.generator_confidence,
            "deepfake_detected": result.deepfake_detected,
            "nsfw_detected": result.nsfw_detected,
            "quality_passed": result.quality_passed,
            "error": None
        }
    except AIOrNotAPIError as e:
        logger.warning(f"AI or Not API error: {e.message}")
        return {
            "available": False,
            "error": e.message
        }
    except Exception as e:
        logger.warning(f"AI or Not API unexpected error: {str(e)}")
        return {
            "available": False,
            "error": str(e)
        }
    finally:
        # Restore original environment
        if original_key:
            os.environ["AIORNOT_API_KEY"] = original_key
        elif "AIORNOT_API_KEY" in os.environ:
            del os.environ["AIORNOT_API_KEY"]


def combine_ai_scores(gpt_score: int, aiornot_result: dict) -> tuple[int, bool]:
    """
    Combine GPT-4 Vision score with AI or Not API results.
    
    Strategy:
    - If AI or Not API is available and confident, weight it heavily (it's specialized)
    - If both agree, use the higher score
    - If they disagree significantly, investigate further
    
    Returns:
        tuple of (combined_score, was_boosted)
    """
    if not aiornot_result.get("available"):
        return gpt_score, False
    
    aiornot_confidence = aiornot_result.get("ai_confidence", 0)
    aiornot_score = int(aiornot_confidence * 100)
    aiornot_verdict = aiornot_result.get("verdict", "human")
    
    # If AI or Not says it's AI with high confidence, trust it
    if aiornot_verdict == "ai" and aiornot_confidence >= 0.7:
        # AI or Not is specialized - weight it 60%, GPT 40%
        combined = int(aiornot_score * 0.6 + gpt_score * 0.4)
        # Ensure minimum based on AI or Not confidence
        combined = max(combined, int(aiornot_confidence * 80))
        return combined, combined > gpt_score
    
    # If AI or Not says it's human with high confidence
    if aiornot_verdict == "human" and aiornot_confidence <= 0.3:
        # Be more conservative, but don't ignore GPT completely
        combined = int(aiornot_score * 0.4 + gpt_score * 0.6)
        return combined, False
    
    # For uncertain cases, average the scores
    combined = int((aiornot_score + gpt_score) / 2)
    
    # If they strongly disagree, lean toward the higher score (safety first)
    if abs(aiornot_score - gpt_score) > 40:
        combined = max(aiornot_score, gpt_score) - 10  # Slight penalty for disagreement
    
    return max(0, min(100, combined)), combined > gpt_score


@app.post("/analyze/image", response_model=ImageAnalysisResponse)
async def analyze_image(image: UploadFile = File(...)):
    """
    Analyze profile image for catfishing and AI-generation indicators.
    
    Uses a dual-detection approach:
    1. GPT-4 Vision with weighted evidence model (texture, structure, lighting, style, technical)
    2. AI or Not API for specialized ML-based detection (when available)
    
    The scores are combined for maximum accuracy.
    """
    
    # Read image data
    image_data = await image.read()
    if not image_data:
        raise HTTPException(status_code=400, detail="Empty image file")
    
    # Check file size (max 10MB)
    if len(image_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    
    # Return mock if no OpenAI API key
    if not settings.openai_api_key:
        return get_image_mock_response()
    
    try:
        # Run both analyses in parallel for speed
        # 1. GPT-4 Vision analysis
        gpt_result = await call_openai_for_image_analysis(image_data)
        
        # 2. AI or Not API analysis (specialized ML detection)
        aiornot_result = await call_aiornot_api(image_data)
        
        # Validate required fields from GPT
        required_fields = ["catfish_score", "ai_generated_score", "flags", "explanation", "recommended_action", "reverse_search_steps"]
        for field in required_fields:
            if field not in gpt_result:
                raise ValueError(f"Missing field: {field}")
        
        # Ensure GPT scores are in range
        gpt_result["catfish_score"] = max(0, min(100, int(gpt_result["catfish_score"])))
        gpt_result["ai_generated_score"] = max(0, min(100, int(gpt_result["ai_generated_score"])))
        
        # Apply calibration logic to GPT score
        gpt_result = calibrate_ai_score(gpt_result)
        
        # Combine GPT and AI or Not scores
        original_gpt_score = gpt_result["ai_generated_score"]
        combined_score, was_boosted = combine_ai_scores(original_gpt_score, aiornot_result)
        gpt_result["ai_generated_score"] = combined_score
        
        # Update confidence band based on combined score
        gpt_result["confidence_band"] = get_confidence_band(combined_score)
        
        # Track if AI or Not boosted the score
        if was_boosted:
            gpt_result["escalation_applied"] = True
        
        # Add AI or Not specific signals to top_signals if it detected AI
        if aiornot_result.get("available") and aiornot_result.get("verdict") == "ai":
            aiornot_signal = {
                "category": "ml_detection",
                "signal": "aiornot_ai_detected",
                "description": f"AI or Not API detected AI-generated image with {int(aiornot_result.get('ai_confidence', 0) * 100)}% confidence" + 
                              (f" (Generator: {aiornot_result.get('generator')})" if aiornot_result.get('generator') else ""),
                "weight": aiornot_result.get("ai_confidence", 0),
                "severity": "high" if aiornot_result.get("ai_confidence", 0) >= 0.7 else "medium"
            }
            if "top_signals" not in gpt_result:
                gpt_result["top_signals"] = []
            gpt_result["top_signals"].insert(0, aiornot_signal)
        
        # Add deepfake flag if detected
        if aiornot_result.get("deepfake_detected"):
            if "flags" not in gpt_result:
                gpt_result["flags"] = []
            gpt_result["flags"].append("deepfake_detected")
        
        # Add NSFW flag if detected
        if aiornot_result.get("nsfw_detected"):
            if "flags" not in gpt_result:
                gpt_result["flags"] = []
            gpt_result["flags"].append("nsfw_content")
        
        # Ensure new fields have defaults if missing
        if "top_signals" not in gpt_result:
            gpt_result["top_signals"] = []
        if "ai_detection_rationale" not in gpt_result:
            gpt_result["ai_detection_rationale"] = gpt_result.get("explanation", "")
        if "confidence_band" not in gpt_result:
            gpt_result["confidence_band"] = get_confidence_band(gpt_result["ai_generated_score"])
        if "signal_count" not in gpt_result:
            gpt_result["signal_count"] = len(gpt_result.get("top_signals", []))
        if "escalation_applied" not in gpt_result:
            gpt_result["escalation_applied"] = False
            
        # Ensure top_signals have proper structure
        validated_signals = []
        for signal in gpt_result.get("top_signals", []):
            if isinstance(signal, dict):
                validated_signals.append({
                    "category": signal.get("category", "unknown"),
                    "signal": signal.get("signal", "unknown"),
                    "description": signal.get("description", ""),
                    "weight": float(signal.get("weight", 0.0)),
                    "severity": signal.get("severity", "low")
                })
        gpt_result["top_signals"] = validated_signals
        
        # Add AI or Not result to response
        gpt_result["aiornot"] = {
            "available": aiornot_result.get("available", False),
            "verdict": aiornot_result.get("verdict"),
            "ai_confidence": aiornot_result.get("ai_confidence"),
            "generator": aiornot_result.get("generator"),
            "generator_confidence": aiornot_result.get("generator_confidence"),
            "deepfake_detected": aiornot_result.get("deepfake_detected"),
            "nsfw_detected": aiornot_result.get("nsfw_detected"),
            "quality_passed": aiornot_result.get("quality_passed"),
            "error": aiornot_result.get("error")
        }
        
        # Update rationale to include AI or Not info
        if aiornot_result.get("available"):
            aiornot_summary = f"\n\nAI or Not API: {aiornot_result.get('verdict', 'unknown').upper()} " \
                            f"({int(aiornot_result.get('ai_confidence', 0) * 100)}% confidence)"
            if aiornot_result.get("generator"):
                aiornot_summary += f", Generator: {aiornot_result.get('generator')}"
            gpt_result["ai_detection_rationale"] = gpt_result.get("ai_detection_rationale", "") + aiornot_summary
        
        # Remove category_scores from response (internal use only)
        gpt_result.pop("category_scores", None)
        
        return gpt_result
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {str(e)}")


# System prompt for audio analysis
AUDIO_ANALYSIS_PROMPT = """You are a dating safety analyst specializing in detecting romance scams through voice analysis.

You will receive a transcript of a voice message from a dating app. Analyze it for scam indicators and AI voice characteristics.

Return a JSON object with EXACTLY these keys:
{
  "risk_score": <number 0-100, likelihood this is part of a scam>,
  "category": <"safe" | "suspicious" | "scam_likely">,
  "flags": <array of specific warning signs found>,
  "explanation": <string explaining your analysis>,
  "recommended_action": <string with actionable advice>,
  "suggested_reply": <string with a safe response to send>,
  "ai_voice_score": <number 0-100, likelihood the voice is AI-generated based on transcript cues>,
  "ai_voice_rationale": <string explaining AI voice assessment>
}

SCAM INDICATORS to look for:
- Requests for money, gifts, or financial help
- Urgency or pressure tactics
- Professing strong feelings too quickly (love bombing)
- Vague or inconsistent personal details
- Requests to move communication off the dating app
- Mentions of being overseas, military, oil rig worker
- Stories about emergencies requiring money
- Crypto investment opportunities
- Avoiding video calls or in-person meetings
- Scripted or rehearsed-sounding speech patterns

AI VOICE INDICATORS (based on transcript analysis):
- Unnaturally perfect grammar and pronunciation indicators
- Robotic or monotone speech patterns described
- Lack of natural speech fillers (um, uh, like)
- Too-consistent pacing without natural pauses
- Generic or templated responses
- Note: Be careful not to over-claim - base assessment on transcript cues only

Category guidelines:
- "safe": risk_score 0-30, normal conversation
- "suspicious": risk_score 31-70, some warning signs
- "scam_likely": risk_score 71-100, strong scam indicators

Return ONLY the JSON object, no markdown formatting."""


def get_audio_mock_response() -> dict:
    """Return mock response when API key is missing"""
    return {
        "risk_score": 0,
        "category": "safe",
        "flags": ["api_unavailable"],
        "explanation": "Audio analysis unavailable: OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.",
        "recommended_action": "Configure the API key for real analysis.",
        "suggested_reply": "Unable to generate - API key missing.",
        "ai_voice_score": 0,
        "ai_voice_rationale": "Cannot assess AI voice without API key.",
        "transcript": "Transcription unavailable without API key."
    }


def convert_audio_to_wav(input_path: str, output_path: str) -> bool:
    """Convert audio file to 16kHz mono WAV using ffmpeg"""
    try:
        result = subprocess.run([
            'ffmpeg', '-y', '-i', input_path,
            '-ar', '16000', '-ac', '1', '-f', 'wav', output_path
        ], capture_output=True, text=True, timeout=30)
        return result.returncode == 0
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg not found. Please install ffmpeg to enable audio analysis."
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Audio conversion timed out")


async def transcribe_audio(audio_path: str) -> str:
    """Transcribe audio using OpenAI Whisper API"""
    client = OpenAI(api_key=settings.openai_api_key)
    
    with open(audio_path, 'rb') as audio_file:
        transcript = client.audio.transcriptions.create(
            model=settings.whisper_model,
            file=audio_file,
            response_format="text"
        )
    
    return transcript


async def analyze_audio_transcript(transcript: str, context_text: str | None) -> dict:
    """Analyze audio transcript using GPT"""
    client = OpenAI(api_key=settings.openai_api_key)
    
    user_message = f"Voice message transcript:\n\n{transcript}"
    if context_text:
        user_message += f"\n\nContext (previous text conversation):\n{context_text[:1000]}"
    
    response = client.chat.completions.create(
        model=settings.gpt_model,
        messages=[
            {"role": "system", "content": AUDIO_ANALYSIS_PROMPT},
            {"role": "user", "content": user_message}
        ],
        temperature=0.3,
    )
    
    content = response.choices[0].message.content or ""
    
    try:
        return parse_llm_response(content)
    except json.JSONDecodeError:
        # Retry with repair prompt
        repair_response = client.chat.completions.create(
            model=settings.gpt_model,
            messages=[
                {"role": "system", "content": AUDIO_ANALYSIS_PROMPT},
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": content},
                {"role": "user", "content": "Return only valid JSON, no markdown."}
            ],
            temperature=0.1,
        )
        repair_content = repair_response.choices[0].message.content or ""
        return parse_llm_response(repair_content)


@app.post("/analyze/audio", response_model=AudioAnalysisResponse)
async def analyze_audio(
    file: UploadFile = File(...),
    context_text: Optional[str] = Form(None),
    site: Optional[str] = Form(None),
    page_url: Optional[str] = Form(None),
):
    """Analyze voice message for scam indicators"""
    
    # Read audio data
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    
    # Check file size (max 25MB)
    if len(audio_data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio too large (max 25MB)")
    
    # Return mock if no API key
    if not settings.openai_api_key:
        return get_audio_mock_response()
    
    try:
        # Save audio to temp file
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_input:
            tmp_input.write(audio_data)
            input_path = tmp_input.name
        
        # Convert to WAV for Whisper
        output_path = input_path.replace('.webm', '.wav')
        
        try:
            convert_audio_to_wav(input_path, output_path)
            
            # Transcribe
            transcript = await transcribe_audio(output_path)
            
            if not transcript or not transcript.strip():
                return {
                    "risk_score": 0,
                    "category": "safe",
                    "flags": ["no_speech_detected"],
                    "explanation": "No speech was detected in the audio recording.",
                    "recommended_action": "Try recording again with clearer audio.",
                    "suggested_reply": "Could you send that voice note again? I had trouble hearing it.",
                    "ai_voice_score": 0,
                    "ai_voice_rationale": "Cannot assess - no speech detected.",
                    "transcript": ""
                }
            
            # Analyze transcript
            result = await analyze_audio_transcript(transcript, context_text)
            
            # Add transcript to result
            result["transcript"] = transcript
            
            # Validate and normalize fields
            required_fields = ["risk_score", "category", "flags", "explanation", "recommended_action", "suggested_reply", "ai_voice_score", "ai_voice_rationale"]
            for field in required_fields:
                if field not in result:
                    raise ValueError(f"Missing field: {field}")
            
            # Ensure category is valid
            if result["category"] not in ["safe", "suspicious", "scam_likely"]:
                result["category"] = "suspicious"
            
            # Ensure scores are in range
            result["risk_score"] = max(0, min(100, int(result["risk_score"])))
            result["ai_voice_score"] = max(0, min(100, int(result["ai_voice_score"])))
            
            return result
            
        finally:
            # Clean up temp files
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
                
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {str(e)}")


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
