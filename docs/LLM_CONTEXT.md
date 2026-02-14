# Catfish — LLM Context (Dating-App Specific MVP)

## What we are building
Catfish is a Chrome MV3 extension that is **dating-app specific**, starting with **Tinder Web**.
It provides tools for:
- Text: analyze chat threads for romance scams/bot behavior + generate safe reply.
- Audio/Image later. (Not in this step.)

## Key differentiator (MVP)
### “Analyze This Thread” (Tinder-native)
On Tinder Web chat pages, Catfish injects a button: **“Analyze this thread”**.
When clicked (user-initiated):
- Extract the **last N messages** from the currently open chat thread
- Include basic context (match name if visible; current URL)
- Send extracted text into the extension UI (Text tab) automatically
- Run analysis and show results + copy-paste safe reply

No Tinder/Hinge/Bumble API integration. No scraping hidden network endpoints. Only DOM extraction of what the user is already viewing.

## Repo
/apps/extension
  - React TS side panel UI with tabs: Audio / Image / Text
  - MV3 service worker for orchestration
  - Content scripts per site adapter (start with Tinder)
  - (later) offscreen doc for tab audio recording
/apps/api
  - FastAPI backend with:
    - GET /health
    - POST /analyze/text (already implemented)

## Data contract (thread import)
Content script sends a message to extension with:
{
  "type": "THREAD_IMPORT",
  "site": "tinder",
  "thread_text": "You: ...\nMatch: ...",
  "match_name": "optional",
  "page_url": "..."
}

UI behavior:
- Auto-fill TextTab input with thread_text (and match_name header if present)
- Optionally auto-trigger analysis once per import event

## Non-goals (for this step)
- No audio recording (tabCapture/offscreen)
- No image analysis
- No background scraping/collection
- No OAuth / app APIs
- Avoid brittle solutions; prefer semantic/accessible selectors and fallbacks

## Scam focus flags (used by /analyze/text)
move_off_platform, crypto_investment, love_bombing, urgency_emergency, secrecy_isolation,
refuses_video_call, overseas_military_oilrig, wire_transfer_gift_cards,
inconsistent_identity, scripted_language