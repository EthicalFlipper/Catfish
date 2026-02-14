"""
Catfish API - FastAPI Backend
"""
import json
import base64
import tempfile
import subprocess
import os
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from typing import Optional

from .settings import settings
from .schemas import TextAnalysisRequest, TextAnalysisResponse, ImageAnalysisResponse, AudioAnalysisResponse

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


# System prompt for image analysis
IMAGE_ANALYSIS_PROMPT = """You are a dating safety analyst specializing in detecting fake, stolen, or AI-generated profile photos used in romance scams and catfishing.

Analyze the provided image and return a JSON object with EXACTLY these keys:
{
  "catfish_score": <number 0-100, likelihood this is a stolen/fake photo used for catfishing>,
  "ai_generated_score": <number 0-100, likelihood this image was AI-generated>,
  "flags": <array of specific warning signs found>,
  "explanation": <string explaining your analysis>,
  "recommended_action": <string with actionable advice>,
  "reverse_search_steps": <array of strings with step-by-step instructions for manual reverse image search>
}

CATFISH/STOLEN PHOTO indicators (for catfish_score):
- Professional model-quality photos (too perfect lighting, poses)
- Stock photo appearance
- Watermarks or editing artifacts suggesting stolen image
- Inconsistent backgrounds or poorly edited composites
- Military uniform photos (common in romance scams)
- Luxury lifestyle props that seem staged
- Celebrity or influencer appearance
- Photos that look like they're from a different era/quality
- Cropped or low-resolution images hiding details

AI-GENERATED indicators (for ai_generated_score):
- Unnatural skin texture (too smooth, waxy)
- Asymmetrical or distorted facial features
- Weird earrings, glasses, or accessories
- Background inconsistencies or artifacts
- Unusual hair patterns or textures
- Hands or fingers that look wrong
- Text or numbers that are garbled
- Eyes that don't match or have strange reflections
- Clothing patterns that don't make sense

Always include these reverse_search_steps:
1. Save/screenshot the image
2. Go to images.google.com and click the camera icon
3. Upload the image or paste URL
4. Check if the same photo appears on other sites with different names
5. Try TinEye.com for additional reverse image search

Return ONLY the JSON object, no markdown formatting."""


def get_image_mock_response() -> dict:
    """Return mock response when vision API is unavailable"""
    return {
        "catfish_score": 0,
        "ai_generated_score": 0,
        "flags": ["vision_unavailable"],
        "explanation": "Image analysis unavailable: OpenAI API key not configured or vision model not accessible. Please add OPENAI_API_KEY to your .env file.",
        "recommended_action": "Configure the API key for real analysis. In the meantime, manually reverse image search this photo using Google Images or TinEye.",
        "reverse_search_steps": [
            "Save or screenshot the image",
            "Go to images.google.com and click the camera icon",
            "Upload the image or drag it into the search box",
            "Review results to see if this photo appears elsewhere with different names",
            "Try TinEye.com as an additional reverse image search"
        ]
    }


async def call_openai_for_image_analysis(image_data: bytes) -> dict:
    """Call OpenAI Vision API for image analysis"""
    client = OpenAI(api_key=settings.openai_api_key)
    
    # Convert image to base64
    base64_image = base64.b64encode(image_data).decode('utf-8')
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",  # Vision-capable model
        messages=[
            {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze this dating profile image for catfishing and AI-generation indicators:"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        temperature=0.3,
        max_tokens=1000,
    )
    
    content = response.choices[0].message.content or ""
    
    try:
        return parse_llm_response(content)
    except json.JSONDecodeError:
        # Retry with repair prompt
        repair_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
                {"role": "user", "content": "Return only valid JSON, no markdown. Previous response was invalid."},
            ],
            temperature=0.1,
        )
        repair_content = repair_response.choices[0].message.content or ""
        return parse_llm_response(repair_content)


@app.post("/analyze/image", response_model=ImageAnalysisResponse)
async def analyze_image(image: UploadFile = File(...)):
    """Analyze profile image for catfishing/AI-generation indicators"""
    
    # Read image data
    image_data = await image.read()
    if not image_data:
        raise HTTPException(status_code=400, detail="Empty image file")
    
    # Check file size (max 10MB)
    if len(image_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    
    # Return mock if no API key
    if not settings.openai_api_key:
        return get_image_mock_response()
    
    try:
        result = await call_openai_for_image_analysis(image_data)
        
        # Validate required fields
        required_fields = ["catfish_score", "ai_generated_score", "flags", "explanation", "recommended_action", "reverse_search_steps"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing field: {field}")
        
        # Ensure scores are in range
        result["catfish_score"] = max(0, min(100, int(result["catfish_score"])))
        result["ai_generated_score"] = max(0, min(100, int(result["ai_generated_score"])))
        
        return result
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
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
