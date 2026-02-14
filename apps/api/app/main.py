"""
Catfish API - FastAPI Backend
"""
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

from .settings import settings
from .schemas import TextAnalysisRequest, TextAnalysisResponse

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
