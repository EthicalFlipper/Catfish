"""
AI or Not API Integration Module
================================
Integrates with https://api.aiornot.com for AI-generated image detection.

This module provides a reusable function to analyze images using the AI or Not API,
which uses specialized ML models to detect AI-generated images with high accuracy.

Supported detections:
- AI vs Human classification
- Generator identification (Midjourney, DALL-E, Stable Diffusion, Flux, etc.)
- Deepfake detection
- NSFW content detection
- Image quality assessment
"""

import os
import base64
import requests
from typing import Optional
from dataclasses import dataclass
from pathlib import Path


# API Configuration
AIORNOT_API_URL = "https://api.aiornot.com/v1/reports/image"
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit


@dataclass
class AIOrNotResult:
    """Structured result from AI or Not API analysis"""
    verdict: str  # "ai" or "human"
    ai_confidence: float  # 0.0 to 1.0
    is_ai_generated: bool
    generator: Optional[str]  # e.g., "Flux", "Midjourney", "DALL-E", "Stable Diffusion"
    generator_confidence: Optional[float]
    deepfake_detected: bool
    deepfake_confidence: Optional[float]
    nsfw_detected: bool
    nsfw_confidence: Optional[float]
    quality_passed: bool
    # Image metadata
    width: Optional[int]
    height: Optional[int]
    image_format: Optional[str]
    size_bytes: Optional[int]
    # Raw response for debugging
    raw_response: dict

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization"""
        return {
            "verdict": self.verdict,
            "ai_confidence": self.ai_confidence,
            "is_ai_generated": self.is_ai_generated,
            "generator": self.generator,
            "generator_confidence": self.generator_confidence,
            "deepfake_detected": self.deepfake_detected,
            "deepfake_confidence": self.deepfake_confidence,
            "nsfw_detected": self.nsfw_detected,
            "nsfw_confidence": self.nsfw_confidence,
            "quality_passed": self.quality_passed,
            "meta": {
                "width": self.width,
                "height": self.height,
                "format": self.image_format,
                "size_bytes": self.size_bytes
            }
        }

    def get_summary(self) -> str:
        """Generate human-readable summary for UI display"""
        ai_pct = int(self.ai_confidence * 100)
        lines = [
            f"AI Detected: {'Yes' if self.is_ai_generated else 'No'} ({ai_pct}%)",
            f"Generator: {self.generator or 'Unknown'}",
            f"Deepfake: {'Yes' if self.deepfake_detected else 'No'}",
            f"NSFW: {'Yes' if self.nsfw_detected else 'No'}",
            f"High Quality: {'Yes' if self.quality_passed else 'No'}"
        ]
        return "\n".join(lines)


class AIOrNotAPIError(Exception):
    """Custom exception for AI or Not API errors"""
    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[dict] = None):
        self.message = message
        self.status_code = status_code
        self.response_body = response_body
        super().__init__(self.message)


def get_api_key() -> str:
    """
    Get the AI or Not API key from environment variable.
    
    Set via:
    - Environment variable: export AIORNOT_API_KEY=your-key-here
    - .env file: AIORNOT_API_KEY=your-key-here
    """
    api_key = os.getenv("AIORNOT_API_KEY", "")
    if not api_key:
        raise AIOrNotAPIError(
            "AIORNOT_API_KEY environment variable not set. "
            "Get your API key from https://aiornot.com and set it in your .env file."
        )
    return api_key


def analyze_image_ai(image_path: str) -> AIOrNotResult:
    """
    Analyze an image file for AI-generated content using AI or Not API.
    
    Args:
        image_path: Path to the image file (supports JPEG, PNG, WebP, GIF)
        
    Returns:
        AIOrNotResult with detection results
        
    Raises:
        AIOrNotAPIError: If API call fails or returns an error
        FileNotFoundError: If image file doesn't exist
        ValueError: If file is too large or invalid format
        
    Example:
        result = analyze_image_ai("profile_photo.jpg")
        print(result.get_summary())
        # AI Detected: Yes (94%)
        # Generator: Flux
        # Deepfake: No
        # NSFW: No
        # High Quality: Yes
    """
    # Validate file exists
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")
    
    # Check file size
    file_size = path.stat().st_size
    if file_size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Image file too large: {file_size / (1024*1024):.1f} MB. "
            f"Maximum allowed: {MAX_FILE_SIZE_BYTES / (1024*1024):.0f} MB"
        )
    
    # Read image data
    with open(image_path, "rb") as f:
        image_data = f.read()
    
    return analyze_image_bytes(image_data)


def analyze_image_bytes(image_data: bytes) -> AIOrNotResult:
    """
    Analyze image bytes for AI-generated content using AI or Not API.
    
    This is useful when you already have image data in memory (e.g., from upload).
    
    Args:
        image_data: Raw image bytes
        
    Returns:
        AIOrNotResult with detection results
        
    Raises:
        AIOrNotAPIError: If API call fails or returns an error
    """
    # Check file size
    if len(image_data) > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Image too large: {len(image_data) / (1024*1024):.1f} MB. "
            f"Maximum allowed: {MAX_FILE_SIZE_BYTES / (1024*1024):.0f} MB"
        )
    
    # Get API key
    api_key = get_api_key()
    
    # Determine image type from magic bytes for filename
    extension = "png"
    mime_type = "image/png"
    if image_data[:2] == b'\xff\xd8':
        extension = "jpg"
        mime_type = "image/jpeg"
    elif image_data[:4] == b'\x89PNG':
        extension = "png"
        mime_type = "image/png"
    elif image_data[:4] == b'RIFF':
        extension = "webp"
        mime_type = "image/webp"
    elif image_data[:6] in (b'GIF87a', b'GIF89a'):
        extension = "gif"
        mime_type = "image/gif"
    
    # ==========================================================
    # IMPORTANT: Use multipart/form-data for the AI or Not API
    # DO NOT manually set Content-Type header - requests does it
    # automatically with the correct boundary when using 'files'
    # ==========================================================
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        # DO NOT set Content-Type here - requests sets it automatically
    }
    
    # Prepare the file for multipart upload
    files = {
        "object": (f"image.{extension}", image_data, mime_type)
    }
    
    # Make API request with multipart/form-data
    try:
        response = requests.post(
            AIORNOT_API_URL,
            headers=headers,
            files=files,  # This automatically sets Content-Type: multipart/form-data with boundary
            timeout=60  # 60 second timeout for large images
        )
    except requests.exceptions.Timeout:
        raise AIOrNotAPIError("API request timed out after 60 seconds")
    except requests.exceptions.ConnectionError as e:
        raise AIOrNotAPIError(f"Failed to connect to AI or Not API: {str(e)}")
    except requests.exceptions.RequestException as e:
        raise AIOrNotAPIError(f"API request failed: {str(e)}")
    
    # Handle HTTP errors
    if response.status_code != 200:
        # Try to read response body for debugging
        error_body = None
        error_text = None
        try:
            error_text = response.text
            error_body = response.json()
        except:
            pass
        
        # Log for debugging
        print(f"[AIorNot] Error {response.status_code}: {error_text[:500] if error_text else 'No response body'}")
        
        error_messages = {
            400: "Bad request - invalid image format or data",
            401: "Unauthorized - invalid or missing API key",
            402: "Payment required - API quota exceeded",
            403: "Forbidden - API access denied",
            404: "Not found - API endpoint unavailable",
            413: "Image too large",
            429: "Rate limit exceeded - too many requests",
            500: "AI or Not API server error",
            502: "AI or Not API gateway error",
            503: "AI or Not API temporarily unavailable"
        }
        
        message = error_messages.get(
            response.status_code, 
            f"API returned status code {response.status_code}"
        )
        
        # Include response body in error if available
        if error_body and isinstance(error_body, dict):
            detail = error_body.get("detail") or error_body.get("message") or error_body.get("error")
            if detail:
                message = f"{message}: {detail}"
        
        raise AIOrNotAPIError(
            message=message,
            status_code=response.status_code,
            response_body=error_body
        )
    
    # Parse response
    try:
        data = response.json()
    except ValueError as e:
        # Log the raw response for debugging
        raw_text = response.text[:500] if response.text else "Empty response"
        print(f"[AIorNot] JSON Parse Error: {e}")
        print(f"[AIorNot] Raw response: {raw_text}")
        raise AIOrNotAPIError(f"Failed to parse API response as JSON: {raw_text[:100]}")
    
    return parse_api_response(data)


def parse_api_response(data: dict) -> AIOrNotResult:
    """
    Parse the AI or Not API response into a structured result.
    
    Handles unknown/new fields gracefully by ignoring them.
    """
    # Extract report data (API returns nested structure)
    report = data.get("report", data)
    
    # Extract verdict
    verdict_data = report.get("verdict", {})
    if isinstance(verdict_data, str):
        verdict = verdict_data.lower()
        ai_confidence = 1.0 if verdict == "ai" else 0.0
    else:
        verdict = verdict_data.get("ai", {}).get("is_detected", False)
        verdict = "ai" if verdict else "human"
        ai_confidence = verdict_data.get("ai", {}).get("confidence", 0.0)
    
    # Handle different API response formats
    # Format 1: report.ai structure
    ai_data = report.get("ai", {})
    if ai_data:
        verdict = "ai" if ai_data.get("is_detected", False) else "human"
        ai_confidence = ai_data.get("confidence", 0.0)
    
    # Extract generator info (handle multiple possible structures)
    generator = None
    generator_confidence = None
    
    # Try to find generator in various locations
    generator_data = report.get("generator", {})
    if generator_data:
        generator = generator_data.get("name") or generator_data.get("type")
        generator_confidence = generator_data.get("confidence")
    
    # Also check facets/generators for detailed breakdown
    facets = report.get("facets", {})
    generators = facets.get("generators", [])
    if generators and isinstance(generators, list):
        # Find the most confident generator
        best_gen = max(generators, key=lambda x: x.get("confidence", 0), default={})
        if best_gen:
            generator = generator or best_gen.get("name") or best_gen.get("generator")
            generator_confidence = generator_confidence or best_gen.get("confidence")
    
    # Extract deepfake detection
    deepfake_data = report.get("deepfake", {})
    deepfake_detected = deepfake_data.get("is_detected", False) if deepfake_data else False
    deepfake_confidence = deepfake_data.get("confidence") if deepfake_data else None
    
    # Extract NSFW detection
    nsfw_data = report.get("nsfw", {})
    nsfw_detected = nsfw_data.get("is_detected", False) if nsfw_data else False
    nsfw_confidence = nsfw_data.get("confidence") if nsfw_data else None
    
    # Extract quality check
    quality_data = report.get("quality", {})
    quality_passed = quality_data.get("passed", True) if quality_data else True
    
    # Extract image metadata
    meta = report.get("meta", {})
    width = meta.get("width")
    height = meta.get("height")
    image_format = meta.get("format")
    size_bytes = meta.get("size_bytes") or meta.get("size")
    
    # Determine if AI generated based on confidence threshold
    is_ai_generated = ai_confidence >= 0.5 or verdict == "ai"
    
    return AIOrNotResult(
        verdict=verdict,
        ai_confidence=ai_confidence,
        is_ai_generated=is_ai_generated,
        generator=generator,
        generator_confidence=generator_confidence,
        deepfake_detected=deepfake_detected,
        deepfake_confidence=deepfake_confidence,
        nsfw_detected=nsfw_detected,
        nsfw_confidence=nsfw_confidence,
        quality_passed=quality_passed,
        width=width,
        height=height,
        image_format=image_format,
        size_bytes=size_bytes,
        raw_response=data
    )


# ============================================================================
# Example Usage
# ============================================================================

if __name__ == "__main__":
    """
    Example usage of the AI or Not API integration.
    
    Before running:
    1. Get your API key from https://aiornot.com
    2. Set the environment variable:
       - Linux/Mac: export AIORNOT_API_KEY=your-key-here
       - Windows: set AIORNOT_API_KEY=your-key-here
       - Or add to .env file: AIORNOT_API_KEY=your-key-here
    """
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python aiornot.py <image_path>")
        print("Example: python aiornot.py profile_photo.jpg")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    try:
        print(f"Analyzing: {image_path}")
        print("-" * 40)
        
        result = analyze_image_ai(image_path)
        
        # Print human-readable summary
        print(result.get_summary())
        print("-" * 40)
        
        # Print detailed dict
        print("\nDetailed Results:")
        import json
        print(json.dumps(result.to_dict(), indent=2))
        
    except AIOrNotAPIError as e:
        print(f"API Error: {e.message}")
        if e.status_code:
            print(f"Status Code: {e.status_code}")
        sys.exit(1)
    except FileNotFoundError as e:
        print(f"File Error: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"Validation Error: {e}")
        sys.exit(1)
