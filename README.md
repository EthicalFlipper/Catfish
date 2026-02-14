<<<<<<< HEAD
# Catfish (DateGuard)

A Chrome extension + API for detecting catfishing on dating apps. Users record tab audio, upload images, and paste text for AI-powered analysis.

## Quick Start

### 1. Start the API

```bash
cd apps/api

# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn app.main:app --reload --port 8000
```

Verify: http://localhost:8000/health → `{"ok": true}`

### 2. Build the Extension

```bash
cd apps/extension

# Install dependencies
npm install

# Build for production
npm run build

# Or watch mode for development
npm run dev
```

### 3. Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `apps/extension/dist` folder
5. Click the Catfish icon in the toolbar to open the side panel

### 4. Add Icons (Optional)

Place PNG icons in `apps/extension/public/icons/`:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

Then rebuild: `npm run build`

## Project Structure

```
catfish/
├── apps/
│   ├── extension/          # Chrome MV3 extension
│   │   ├── manifest.json   # Extension config
│   │   ├── src/
│   │   │   ├── ui/         # React side panel UI
│   │   │   └── background/ # Service worker
│   │   └── dist/           # Built extension (load this in Chrome)
│   └── api/                # FastAPI backend
│       ├── app/
│       │   ├── main.py     # FastAPI app
│       │   ├── schemas.py  # Pydantic models
│       │   └── settings.py # Config
│       └── requirements.txt
└── docs/
    └── LLM_CONTEXT.md      # AI context doc
```

## Current Status

**MVP Step 1 (Complete):**
- [x] Extension UI with 3 tabs (Audio, Image, Text)
- [x] FastAPI with health endpoint
- [x] CORS configured for extension

**Next Steps:**
- [ ] Tab audio recording (tabCapture + offscreen API)
- [ ] Whisper transcription endpoint
- [ ] GPT analysis endpoints
- [ ] Image upload + analysis
- [ ] Text analysis

## Development

**Extension (watch mode):**
```bash
cd apps/extension && npm run dev
```

**API (auto-reload):**
```bash
cd apps/api && uvicorn app.main:app --reload
```

## Tech Stack

- **Extension**: React 18, TypeScript, Vite, Chrome MV3
- **API**: FastAPI, Pydantic, Python 3.11+
- **Future**: OpenAI Whisper, GPT-4o-mini
=======
# CatFish

Prevents AI Catfishing on Dating Apps
>>>>>>> f20009ac8d60d9436f984b4d15a2553a9c15bff1
