# Catfish — LLM Context (Dating-App Specific MVP)

## What we are building
Catfish is a Chrome MV3 extension that is **dating-app specific**, starting with **Tinder Web**.
It provides tools for:
- **Text**: Analyze chat threads for romance scams/bot behavior + generate safe reply
- **Image**: Capture profile screenshots and analyze for catfishing/AI-generated photos
- **Audio**: Record tab audio (voice notes) and analyze for scams + AI-generated voice

## Key differentiators (MVP)

### 1. "Analyze This Thread" (Tinder-native)
On Tinder Web chat pages, Catfish injects a button: **"🐱 Analyze thread"**.
When clicked (user-initiated):
- Extract the **last N messages** from the currently open chat thread
- Include basic context (match name if visible; current URL)
- Send extracted text into the extension UI (Text tab) automatically
- Run analysis and show results + copy-paste safe reply

### 2. "Capture Profile" (Tinder-native)
On Tinder Web pages, Catfish injects a button: **"📸 Capture profile"**.
When clicked (user-initiated):
- Uses `chrome.tabs.captureVisibleTab` to screenshot the current view
- Stores screenshot in extension storage
- Opens side panel → Image tab with preview
- Analyze for catfish indicators (stolen/fake photos) and AI-generation

**No scraping media URLs. Only captureVisibleTab.**

### 3. "Record Tab Audio" (Voice Note Analysis)
In the Audio tab, user can record audio playing in the current tab.
Architecture (MV3-safe):
- Click "Record Tab Audio" → background gets stream ID via `chrome.tabCapture.getMediaStreamId()`
- Offscreen document receives stream ID and records via `MediaRecorder`
- Click "Stop" → audio Blob returned to background
- Audio sent to `/analyze/audio` endpoint
- Backend: ffmpeg converts to WAV → Whisper transcribes → GPT analyzes transcript

**No scraping audio URLs. Only tabCapture output recording.**

## Repo structure
```
/apps/extension
  - React TS side panel UI with tabs: Audio / Image / Text
  - MV3 service worker for orchestration  
  - Content scripts per site adapter (Tinder)
  - Offscreen document for tab audio recording
/apps/api
  - FastAPI backend with:
    - GET /health
    - POST /analyze/text
    - POST /analyze/image (multipart)
    - POST /analyze/audio (multipart, requires ffmpeg)
```

## Data contracts

### Thread import
```json
{
  "type": "THREAD_IMPORT",
  "site": "tinder",
  "thread_text": "You: ...\nMatch: ...",
  "match_name": "optional",
  "page_url": "..."
}
```

### Image capture
```json
{
  "type": "CAPTURE_VISIBLE_TAB",
  "site": "tinder",
  "page_url": "..."
}
```
Background captures and stores:
```json
{
  "dataUrl": "data:image/png;base64,...",
  "site": "tinder",
  "page_url": "...",
  "captured_at": 1234567890
}
```

### Audio recording
Messages between UI/background/offscreen:
```
UI -> background: START_TAB_RECORDING
background -> offscreen: OFFSCREEN_START_RECORDING { streamId }
UI -> background: STOP_TAB_RECORDING
background -> offscreen: OFFSCREEN_STOP_RECORDING
offscreen -> background: { audioData: "data:audio/webm;base64,..." }
```

API response:
```json
{
  "risk_score": 0-100,
  "category": "safe" | "suspicious" | "scam_likely",
  "flags": [],
  "explanation": "...",
  "recommended_action": "...",
  "suggested_reply": "...",
  "ai_voice_score": 0-100,
  "ai_voice_rationale": "...",
  "transcript": "..."
}
```

## Non-goals
- No background scraping/collection
- No OAuth / app APIs
- No scraping image/audio URLs (only captureVisibleTab + tabCapture)

## Scam focus flags
move_off_platform, crypto_investment, love_bombing, urgency_emergency, secrecy_isolation,
refuses_video_call, overseas_military_oilrig, wire_transfer_gift_cards,
inconsistent_identity, scripted_language, ai_generated_photo, stolen_photo,
ai_generated_voice, scripted_speech_patterns
