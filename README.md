# 🤖 Lab Guide Agent — AI Browser Automation for Azure

Generate step-by-step Azure lab guides with **REAL screenshots** by automating the Azure Portal with Playwright + LLM intelligence.

## � How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                       TASK DESCRIPTION                          │
│  "Create a Linux VM named lab-vm in East US using Standard_B1s" │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   LLM PLANNER   │  GPT-4o / Azure OpenAI
                    │  Generates JSON  │  action plan
                    │  action sequence │
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │     PLAYWRIGHT EXECUTOR      │
              │                              │
              │  For each action:            │
              │  1. Find element (role/text) │
              │  2. Scroll into view         │
              │  3. Execute (click/type/nav) │
              │  4. Wait for Azure to settle │
              │  5. Get element.boundingBox()│
              │  6. Take full screenshot     │
              │                              │
              │  On failure:                 │
              │  → LLM self-correction loop  │
              │  → Retry with fixed action   │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     SHARP IMAGE PROCESSOR    │
              │                              │
              │  1. Detect sidebar (dynamic) │
              │  2. Crop sidebar from left   │
              │  3. Adjust bounding box      │
              │  4. Draw RED RECTANGLE       │
              │  5. Optimize PNG output      │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     LLM GUIDE BUILDER       │
              │                              │
              │  Assembles final Markdown    │
              │  with embedded screenshots   │
              │  + YAML front matter         │
              │  + Objectives/Prerequisites  │
              │  + Numbered steps            │
              │  + Validation section        │
              └─────────────────────────────┘
```

## 🚀 Quick Start

### 1. Install

```bash
npm install
npx playwright install chromium
```

### 2. Configure `.env`

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

# Browser
HEADLESS=false
SLOW_MO=100
```

### 3. First-time Azure Login

```bash
node src/index.js login
```

This opens a browser window — complete your Azure login + MFA. The session is saved to `auth.json` for subsequent runs.

### 4. Generate a Lab Guide

**CLI:**
```bash
# Full automation with browser
node src/index.js generate "Create a Linux VM in East US with Standard_B1s"

# Dry run (plan only, no browser)
node src/index.js generate --dry-run "Create an Azure Storage Account"
```

**Web UI:**
```bash
node src/index.js serve
# Open → http://localhost:8000
```

---

## 🗂️ Project Structure

```
lab-guide-agent/
├── package.json
├── .env.example
├── auth.json                     # Saved Azure login (gitignored)
├── src/
│   ├── index.js                  # CLI entry point
│   ├── server.js                 # Express API server
│   ├── config.js                 # Centralized configuration
│   ├── core/
│   │   ├── browser.js            # Playwright browser lifecycle
│   │   ├── auth.js               # Azure Portal login + session persistence
│   │   ├── navigator.js          # Action execution with retry + fallback
│   │   └── screenshot.js         # Capture, crop, highlight with Sharp
│   ├── agent/
│   │   └── orchestrator.js       # Main agent loop with self-correction
│   ├── services/
│   │   ├── llm.js                # LLM client (Azure OpenAI / OpenAI)
│   │   └── guide-builder.js      # Markdown assembly + fallback template
│   ├── utils/
│   │   ├── logger.js             # Structured Winston logger
│   │   ├── retry.js              # Exponential backoff utility
│   │   └── dom-helpers.js        # DOM queries, sidebar detection, stabilization
│   └── public/
│       └── index.html            # Web UI (modern dark theme)
└── output/                       # Generated guides + screenshots
    ├── screenshots/
    └── <guide-name>/
        ├── guide.md
        └── manifest.json
```

## 🎯 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | System health + auth status |
| `POST` | `/api/generate` | Start the agent `{ task, dryRun?, guideName? }` |
| `GET` | `/api/guides` | List all generated guides |
| `GET` | `/api/guides/:name` | Get a specific guide's Markdown |
| `POST` | `/api/close` | Close the browser instance |

## 🛡️ Error Handling Strategy

### Element Not Found
1. **Multi-strategy location**: `getByRole()` → `getByLabel()` → `getByText()` → CSS selector → `getByTitle()` → `getByPlaceholder()`
2. **Visibility check**: Only clicks visible, actionable elements
3. **Scroll**: Automatically scrolls element into view before interaction

### Dynamic UI
- `waitForLoadState('domcontentloaded')` after every navigation
- Spinner detection: monitors Azure Portal loading indicators
- Animation settle time (800ms) after each operation
- Element stability check before interaction

### Self-Correction Loop (AI Agent Behavior)
```
Action Fails → Capture page state → LLM analyzes failure
                                     ↓
                              Suggests fix:
                              • Corrected selector/role
                              • Missing prerequisite step
                              • Wait/scroll needed
                                     ↓
                              Retry with fix (up to 3x)
```

### Retry with Exponential Backoff
All browser actions retry 3× with exponential backoff (1s → 2s → 4s).

## 🔧 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `getByRole()` over CSS selectors | Azure Portal uses dynamic class names; ARIA roles are stable |
| `element.boundingBox()` for highlights | Pixel-accurate position from Playwright DOM, not guesswork |
| Dynamic sidebar detection | Sidebar width varies by resolution and portal state |
| SVG overlay for red rectangles | Sharp composites SVG — no pixel manipulation needed |
| `storageState` for auth | Persists cookies + localStorage — survives browser restarts |
| LLM self-correction | Makes the system an *agent* rather than a fragile script |

## 🚧 Production Scaling Improvements

1. **Parallel guide generation** — Worker queue (Bull/BullMQ) + multiple browser contexts
2. **Screenshot CDN** — Upload to Azure Blob Storage, use CDN URLs in guides
3. **Action plan caching** — Cache LLM plans for identical tasks (Redis)
4. **Visual regression testing** — Compare screenshots across re-runs for drift
5. **Streaming progress** — WebSocket or SSE for real-time step updates in the UI
6. **Template library** — Pre-built action plans for common Azure tasks (skip LLM planning)
7. **Multi-cloud** — Extend navigator for AWS Console, GCP Console

## 🔑 Azure OpenAI Setup

1. Go to [Azure Portal](https://portal.azure.com) → **Azure OpenAI** resource
2. **Keys and Endpoint** → copy Key 1 and Endpoint
3. **Azure OpenAI Studio** → Deployments → copy your deployment name (e.g., `gpt-4o`)
4. Set these in `.env`
