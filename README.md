# Lab Guide Generator — Semi-Automated Azure Lab Guide Creation

Generate step-by-step Azure lab guides in **CloudLabs format** with real screenshots. You perform the lab steps while the tool captures screenshots, then AI writes the formatted guide.

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP APP                          │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │     Azure Portal         │  │     Recorder Panel           │  │
│  │     (WebContentsView)    │  │                              │  │
│  │                          │  │  1. Set lab title & URL      │  │
│  │  User navigates and      │  │  2. Click "Capture" per step │  │
│  │  performs lab steps       │  │  3. Edit screenshots         │  │
│  │  manually                │  │  4. Add step descriptions    │  │
│  │                          │  │  5. Click "Generate"         │  │
│  └──────────────────────────┘  └──────────────┬───────────────┘  │
│                                               │                  │
└───────────────────────────────────────────────┼──────────────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │   Azure OpenAI LLM  │
                                     │                      │
                                     │  Receives steps +    │
                                     │  screenshots and     │
                                     │  generates CloudLabs │
                                     │  format Markdown     │
                                     └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │     Output          │
                                     │                      │
                                     │  output/<guide>/     │
                                     │  ├── guide.md        │
                                     │  ├── manifest.json   │
                                     │  └── screenshots/    │
                                     └─────────────────────┘
```

## Quick Start

### 1. Install :

```bash
npm install
npx playwright install chromium
```

### 2. Configure `.env` :

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Azure OpenAI (recommended)
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2025-04-01-preview

# Or use OpenAI directly
OPENAI_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### 3. Run the Desktop App :

```bash
npm run desktop
```

### 4. Record a Lab Guide :

1. Enter lab title and Azure Portal URL in the recorder panel
2. Click **Start** to begin recording
3. Navigate the Azure Portal and perform your lab steps
4. At each key step, click **Capture** to take a screenshot
5. Click the screenshot thumbnail to open the **editor** — draw annotations (red rectangles), crop, etc.
6. Add a description for each step
7. Click **Generate** when done — the LLM produces a CloudLabs-format guide

### Alternative: CLI Mode

```bash
# Interactive CLI recording
npm run record

# Web UI on localhost:9005
npm run serve
```

---

## Project Structure

```
lab-guide-agent/
├── desktop.js                    # Electron main process
├── package.json
├── .env.example
├── src/
│   ├── index.js                  # CLI entry point (serve / record)
│   ├── server.js                 # Express API server
│   ├── config.js                 # Centralized configuration
│   ├── core/
│   │   ├── browser.js            # Playwright browser lifecycle (CLI mode)
│   │   ├── recorder.js           # Recording state + step management
│   │   └── screenshot.js         # Capture, crop, annotate with Sharp
│   ├── agent/
│   │   └── orchestrator.js       # Session lifecycle orchestrator
│   ├── services/
│   │   ├── llm.js                # Azure OpenAI / OpenAI client
│   │   └── guide-builder.js      # Output assembly (markdown + screenshots)
│   ├── utils/
│   │   ├── logger.js             # Structured Winston logger
│   │   └── dom-helpers.js        # Sidebar detection for screenshot cropping
│   ├── desktop/
│   │   ├── app.html              # Desktop app UI (tabs, recorder, preview)
│   │   ├── preload.cjs           # Electron IPC bridge
│   │   ├── editor.html           # Screenshot annotation editor (canvas)
│   │   └── editor-preload.cjs    # Editor window IPC bridge
│   └── public/
│       └── index.html            # Web UI for CLI serve mode
└── output/                       # Generated guides
    └── <guide-name>/
        ├── guide.md
        ├── manifest.json
        └── screenshots/
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | System health + LLM info |
| `GET` | `/api/session` | Current session status |
| `POST` | `/api/session/start` | Start recording session |
| `POST` | `/api/session/capture` | Capture a step (CLI mode) |
| `POST` | `/api/desktop/capture` | Capture a step (desktop mode) |
| `POST` | `/api/desktop/edit-screenshot` | Update screenshot after editing |
| `PUT` | `/api/session/step/:num` | Update step description |
| `DELETE` | `/api/session/step/:num` | Delete a step |
| `POST` | `/api/session/generate` | Generate guide from recorded steps |
| `GET` | `/api/guides` | List all generated guides |
| `GET` | `/api/guides/:name` | Get a specific guide's Markdown |
| `POST` | `/api/close` | Close browser instance |

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Semi-automated recording | User controls navigation accuracy; AI handles writing |
| WebContentsView for portal | Supports Bastion popups with native `window.opener` |
| Canvas-based screenshot editor | Draw annotations, crop directly before saving |
| Dynamic sidebar detection | Azure sidebar width varies; auto-cropped from screenshots |
| SVG overlay for annotations | Sharp composites SVG — clean numbered red circles/rectangles |
| CloudLabs format output | Standard format with tasks, numbered steps, bold annotations |

## Azure OpenAI Setup

1. Go to [Azure Portal](https://portal.azure.com) → **Azure OpenAI** resource
2. **Keys and Endpoint** → copy Key 1 and Endpoint
3. **Azure OpenAI Studio** → Deployments → copy your deployment name
4. Set these in `.env`
