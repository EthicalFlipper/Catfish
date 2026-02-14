# Catfish (DateGuard)

A Chrome extension + API for detecting catfishing on dating apps. Analyze text, images, and voice notes from Tinder and other dating platforms.

## Features

- **Text Analysis**: Analyze chat threads for romance scams and AI-generated messages
- **Image Analysis**: Capture profile screenshots and detect catfishing/AI-generated photos
- **Audio Analysis**: Record tab audio (voice notes) and analyze for scams + AI voices

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

# Copy env file and add your OpenAI key
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-your-key

# Run the server
uvicorn app.main:app --reload --port 8000
```

Verify: http://localhost:8000/health → `{"ok": true}`

**Required for Audio Analysis:** Install ffmpeg
- Windows: `choco install ffmpeg`
- Mac: `brew install ffmpeg`
- Linux: `apt install ffmpeg`

### 2. Build the Extension

```bash
cd apps/extension

# Install dependencies
npm install

# Build for production
npm run build
```

### 3. Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `apps/extension/dist` folder
5. Click the Catfish icon in the toolbar to open the side panel

## How to Test Audio Recording

1. Reload the extension at `chrome://extensions/`
2. Open any site playing audio (YouTube works great for testing)
3. Click the Catfish extension icon to open the side panel
4. Go to the **Audio** tab
5. Click **"Record Tab Audio"**
6. Play the audio in the tab
7. Click **"Stop Recording"**
8. Wait for transcription and analysis

Then test on Tinder with actual voice notes!

## Project Structure

```
catfish/
├── apps/
│   ├── extension/          # Chrome MV3 extension
│   │   ├── manifest.json   # Extension config
│   │   ├── src/
│   │   │   ├── ui/         # React side panel UI
│   │   │   ├── background/ # Service worker
│   │   │   ├── content/    # Tinder content script
│   │   │   └── offscreen/  # Offscreen audio recorder
│   │   └── dist/           # Built extension (load this in Chrome)
│   └── api/                # FastAPI backend
│       ├── app/
│       │   ├── main.py     # FastAPI app + endpoints
│       │   ├── schemas.py  # Pydantic models
│       │   └── settings.py # Config
│       └── requirements.txt
└── docs/
    └── LLM_CONTEXT.md      # AI context doc
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/analyze/text` | POST | Analyze chat text for scams |
| `/analyze/image` | POST | Analyze profile images |
| `/analyze/audio` | POST | Transcribe + analyze voice notes |

## Tech Stack

- **Extension**: React 18, TypeScript, Vite, Chrome MV3
- **API**: FastAPI, Pydantic, Python 3.11+
- **AI**: OpenAI Whisper (transcription), GPT-4o-mini (analysis)
