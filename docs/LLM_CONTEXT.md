# Catfish (DateGuard) — LLM Context

## What We're Building
A Chrome extension (MV3) + FastAPI backend that helps users detect catfishing on dating apps.

**No dating-app API integrations.** Users manually provide:
1. **Audio** - Record tab audio (voice notes) for transcription + analysis
2. **Image** - Upload profile photos for reverse image search + analysis  
3. **Text** - Paste conversation snippets for red flag detection

## Repo Structure
```
catfish/
├── apps/
│   ├── extension/     # Chrome MV3 extension (React + TS + Vite)
│   │   ├── src/ui/    # Side panel React app with 3 tabs
│   │   └── src/background/  # Service worker
│   └── api/           # FastAPI backend
│       └── app/       # main.py, schemas.py, settings.py
└── docs/
```

## Current State (MVP Step 1)
- [x] Extension UI loads with 3 tabs (Audio/Image/Text)
- [x] FastAPI runs with `GET /health` → `{"ok": true}`
- [x] CORS enabled for localhost + chrome-extension://*
- [ ] Tab audio recording (tabCapture + offscreen)
- [ ] Whisper transcription
- [ ] GPT analysis endpoints

## Tech Stack
- **Extension**: React 18, TypeScript, Vite, Chrome MV3
- **API**: FastAPI, Pydantic, Python 3.11+
- **Future**: OpenAI Whisper, GPT-4o-mini

## Key Files
- `apps/extension/manifest.json` - Extension config
- `apps/extension/src/ui/App.tsx` - Main UI component
- `apps/extension/src/background/index.ts` - Service worker
- `apps/api/app/main.py` - FastAPI app entry
- `apps/api/app/schemas.py` - Request/response models
