# Spektra Lab Studio — Complete Project Context Document

> **Purpose:** This document captures the full state of the Spektra Lab Studio project as of April 8, 2026. Use it to restore context in a fresh Claude conversation.

---

## 1. What Is This Project?

**Spektra Lab Studio** is a semi-automated, AI-powered desktop tool for generating Azure lab guides in **CloudLabs format** (the standard used by Spektra Systems / CloudLabsAI). 

**The core idea:** A user performs lab steps manually in the Azure Portal while the app captures screenshots, records click interactions via CDP (Chrome DevTools Protocol), and uses GPT-4o (Azure OpenAI or OpenAI) to generate professional, publication-ready lab guide documents.

**Project location:** `c:\Users\s manoj gowda\Desktop\Cloud Projects\Spektra Lab Studio`

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | >=18.0.0 |
| Desktop | Electron | 33.3.1 |
| Browser Automation | Playwright | 1.52.0 |
| Image Processing | Sharp | 0.33.5 |
| Server | Express | 4.21.0 |
| LLM | OpenAI SDK | 4.85.0 |
| Git | simple-git | 3.33.0 |
| Logging | Winston | 3.17.0 |
| CLI | Commander | 13.1.0 |
| UI | HTML/CSS/JS (dark theme, Spektra purple `#7c3aed`) | — |

**Package name:** `lab-guide-agent` v3.0.0, ES Module (`"type": "module"`)

---

## 3. Three App Modes

### Mode 1: **New** (Manual Record Mode)
User manually navigates Azure Portal, clicks "Capture" at each important step, edits descriptions, then clicks "Generate" to produce a CloudLabs-format guide.

### Mode 2: **AI** (AI Auto-Record Mode)
GPT-4o Vision automatically detects significant interactions, generates step descriptions, and the user reviews/approves each step. Uses `src/services/vision.js`.

### Mode 3: **Test** (Test Existing Guide Mode)
Import an existing lab guide from GitHub (via masterdoc.json) or local folder, edit it in-browser while testing against a live Azure environment, then commit changes back via Git + PR.

---

## 4. Architecture

### Entry Points
- **Desktop:** `npm run desktop` → `electron desktop.js` (primary mode)
- **CLI:** `npm run record` → `node src/index.js record` (interactive terminal)
- **Web UI:** `npm run serve` → `node src/index.js serve` (Express on port 9005)
- **Server only:** `npm run server` → `node src/server.js`

### File Structure

```
Spektra Lab Studio/
├── desktop.js                          # Electron main process (~946 lines)
├── package.json                        # Dependencies & scripts
├── auth.json                           # Browser session persistence (auto-generated)
├── testlab-settings.json               # GitHub token, URLs
├── .env                                # API keys, config (not committed)
├── README.md                           # Project documentation
│
├── src/
│   ├── index.js                        # CLI entry point (Commander)
│   ├── config.js                       # All configuration (env vars + defaults)
│   ├── server.js                       # Express API server (30+ routes)
│   │
│   ├── agent/
│   │   └── orchestrator.js             # Session lifecycle (start/capture/generate)
│   │
│   ├── core/
│   │   ├── browser.js                  # Playwright browser launch & auth
│   │   ├── recorder.js                 # CDP event listener, click tracking
│   │   └── screenshot.js               # Sharp image pipeline (crop, annotate, save)
│   │
│   ├── services/
│   │   ├── llm.js                      # Azure OpenAI/OpenAI guide generation
│   │   ├── vision.js                   # GPT-4o Vision auto-analysis
│   │   ├── guide-builder.js            # Guide assembly, versioning
│   │   ├── git-service.js              # Clone, branch, commit, push, PR
│   │   └── masterdoc-parser.js         # Parse CloudLabs masterdoc.json
│   │
│   ├── desktop/
│   │   ├── app.html                    # Main UI (~2900 lines, full SPA)
│   │   ├── editor.html                 # Screenshot annotation editor (canvas)
│   │   ├── preload.cjs                 # Electron IPC bridge
│   │   └── editor-preload.cjs          # Editor window IPC bridge
│   │
│   ├── public/
│   │   └── index.html                  # Web UI (for serve mode)
│   │
│   └── utils/
│       ├── logger.js                   # Winston structured logging
│       └── dom-helpers.js              # Azure sidebar detection
│
├── output/                             # Generated guides
│   ├── how-to-create-vm-in-azure/
│   │   ├── guide.md
│   │   ├── manifest.json
│   │   └── screenshots/
│   └── ... (5 guides total)
│
├── repos/                              # Cloned GitHub repos (for Test mode)
│   ├── CloudLabsAI-Azure--Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry/
│   ├── smanojgowda--CloudLabs_Automation/
│   ├── smanojgowda--Cloudlabs-Lab-Guide-Generator/
│   └── Aryan-MP--Interns2026/
│
└── user-data/                          # Chromium user data directory
```

---

## 5. Component Deep Dive

### 5.1 desktop.js (Electron Main Process)

- **Window:** `BrowserWindow` 1600x1000, split-view layout
- **Left panel:** `WebContentsView` for Azure Portal (NOT `<webview>` — this enables Bastion RDP popup support via `window.opener`)
- **Right panel:** Recorder panel loaded from `src/desktop/app.html`
- **Bastion support:** Frameless child window for Bastion RDP/SSH sessions
- **Active view tracking:** `activeView` variable ('portal' or 'bastion') determines which view to screenshot

**30 IPC handlers including:**
- `capture-screenshot` — Capture current portal/bastion as PNG
- `inject-click-tracker` / `get-click-data` — CDP click tracking
- `open-editor` — Screenshot editor in child window
- `save-guide-to-dir` — Auto-versioned save
- `export-pdf` — PDF export via offscreen BrowserWindow
- `testlab-save-token` / `testlab-get-token` — GitHub token persistence
- `ai-inject-auto-detect` / `ai-start-auto-record` / `ai-stop-auto-record` — AI mode controls

### 5.2 src/desktop/app.html (Main UI)

A sophisticated single-page app with:
- **Browser panel** (left): Multi-tab support (new-tab, closeable, Bastion tabs in green), navigation bar (back, forward, refresh, URL bar)
- **Recorder panel** (right, 380px): Multiple tab panels, step list with drag-and-drop reordering, undo/redo, keyboard shortcuts
- **Preview panel:** Full markdown preview with syntax highlighting
- **Source view:** Raw markdown editor
- **Version diff panel:** Side-by-side diff view
- **Export panel:** Export options
- **Landing screen:** Full-screen overlay with radial gradient and Spektra branding

### 5.3 src/desktop/editor.html (Screenshot Editor)

Canvas-based annotation editor in a child Electron window:
- **Box tool:** Draw red rectangles around UI elements
- **Blur tool:** Blur sensitive areas (intensity 4-40, default 16)
- **Step tool:** Place numbered step circles (size 14-80, default 28)
- **Crop tool:** Crop the screenshot
- Color picker, stroke width (1-16), save/cancel

### 5.4 src/agent/orchestrator.js (Session Orchestrator)

Manages session lifecycle:
- `startSession(opts)` — Start recording (Desktop or CLI mode)
- `recordStep()` — Capture a step
- `stopAndGenerate()` — Stop recording → send to LLM → build guide
- `addCapturedStep()` — Add pre-captured step from desktop mode
- `removeStep()` / `editStep()` — Step manipulation
- `cancelSession()` — Cancel without generating
- `getSessionStatus()` — Return current state

### 5.5 src/core/recorder.js (CDP Recorder)

- Uses **Chrome DevTools Protocol** via Playwright's `newCDPSession()`
- Enables `DOM`, `Runtime`, `Overlay` CDP domains
- Injects persistent click tracker via `page.addInitScript()` (survives navigations)
- Tracks clicks on: `button, a, [role="button"], [role="menuitem"], input, select, .fxs-blade-title-titleText, .azc-toolbarButton, .ms-Button`
- Captures per click: bounding box, tag, text, aria-label, role, id, placeholder, CSS selector
- **600ms debounce** to avoid duplicate captures
- Module-level state: `recordedSteps[]`, `stepCounter`, `recording`, `cdpSession`, `annotationNumber`

### 5.6 src/core/screenshot.js (Screenshot Pipeline)

1. Full-page screenshot via Playwright `page.screenshot()`
2. Dynamic sidebar detection via `detectSidebar()` from dom-helpers
3. Crop to remove Azure Portal sidebar (width varies per page)
4. HiDPI scale correction (computes `scaleX`/`scaleY` between image and viewport)
5. Annotation overlay: SVG with numbered red rectangles/circles, composited via Sharp
6. Save processed PNG to disk

Exports: `captureAndProcess()`, `captureClean()`, `annotateBuffer()`

### 5.7 src/core/browser.js (Playwright Browser)

- Chromium, headless: false
- Flags: `--disable-blink-features=AutomationControlled`, `--no-sandbox`
- Viewport: 1920x1080
- User-Agent: Chrome 131 on Windows 10
- Auth persistence: loads `auth.json` storage state if exists
- Only used in CLI mode (Desktop mode uses Electron's WebContentsView)

### 5.8 src/services/llm.js (LLM Guide Generation)

- **Dual-provider:** `AzureOpenAI` or `OpenAI` (configurable via `config.llm.provider`)
- **Lazy-initialized singleton** client
- **System prompt (`GUIDE_SYSTEM`):** ~200+ lines, extremely detailed:
  - Expert technical writer for CloudLabs format
  - Rewrites casual/shorthand descriptions into polished professional instructions
  - **Abbreviation expansion table:** 30+ mappings (vm→Virtual machine, rg→Resource group, nsg→Network security group, vnet→Virtual network, aks→Azure Kubernetes Service, etc.)
  - Fixes spelling silently
  - Assigns numbered annotations `**(1)**, **(2)**` matching screenshot highlights
  - Output: Exercise → Tasks → Numbered steps with ![screenshots] → Review summary
  - 5 worked examples showing input→output transformations
- Also exposes `proposeGuideEdit()` for AI-powered guide editing via chat

### 5.9 src/services/vision.js (GPT-4o Vision)

- **`analyzeStep(opts)`** — Sends screenshot as base64 + interaction context to GPT-4o
  - Returns: `{ description, summary, uiElements[], confidence, isSignificantAction, suggestedTaskGroup }`
- **`batchAnalyze(steps)`** — Sequentially analyzes multiple steps
- Vision system prompt: analyze Azure Portal screenshots, professional descriptions, numbered annotations, expand abbreviations, bold elements, flag insignificant actions
- Temperature: 0.3, max tokens: 1024

### 5.10 src/services/guide-builder.js

- Assembles final guide: guide.md + manifest.json + copies screenshots
- Auto-versions previous guides before overwriting (guide.v1.md, guide.v2.md, etc.)

### 5.11 src/services/masterdoc-parser.js

- `parseMasterdoc(url)` — Fetches masterdoc.json from GitHub, sorts by Order, extracts paths
- `fetchMasterdocFiles(files)` — Downloads markdown content for each file
- `parseGitHubUrl(url)` — Extracts owner, repo, cloneUrl
- `extractBranch(url)` — Extracts branch from raw URL

### 5.12 src/services/git-service.js

- `cloneOrPull()` — Clone (shallow, depth=1) or pull repo
- `createBranch()` — Create working branch
- `commitAndPush()` — Commit all + push
- `getStatus()` / `getDiffSummary()` — Git status/diff
- `createPullRequest()` — GitHub REST API PR creation
- Repo naming: `<owner>--<repo>` under `repos/` folder

---

## 6. API Routes (Express Server)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check + LLM info |
| `GET` | `/api/session` | Current session status |
| `POST` | `/api/session/start` | Start recording session |
| `POST` | `/api/session/capture` | Capture a step (CLI) |
| `PUT` | `/api/session/step/:num` | Update step description |
| `DELETE` | `/api/session/step/:num` | Delete a step |
| `POST` | `/api/session/generate` | Generate guide from steps |
| `POST` | `/api/session/cancel` | Cancel session |
| `POST` | `/api/desktop/capture` | Capture step (desktop, base64) |
| `POST` | `/api/desktop/edit-screenshot` | Overwrite step screenshot |
| `GET` | `/api/guides` | List all generated guides |
| `GET` | `/api/guides/:name` | Get specific guide markdown |
| `POST` | `/api/chat/edit` | AI-powered guide editing |
| `POST` | `/api/testlab/setup` | Clone repo + parse masterdoc |
| `POST` | `/api/testlab/save-file` | Save markdown to local repo |
| `POST` | `/api/testlab/save-screenshot` | Save screenshot to repo path |
| `POST` | `/api/testlab/branch` | Create a working branch |
| `GET` | `/api/testlab/status` | Git status |
| `POST` | `/api/testlab/commit` | Commit & push |
| `POST` | `/api/testlab/pull-request` | Create GitHub PR |
| `GET` | `/api/testlab/diff` | Git diff summary |
| `POST` | `/api/testlab/read-file` | Read file from repo |
| `POST` | `/api/ai/analyze` | GPT-4o Vision analysis |
| `POST` | `/api/ai/capture` | AI auto-record capture |
| `GET` | `*` | SPA fallback |

---

## 7. Configuration

### .env file
```env
OPENAI_PROVIDER=azure|openai
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2025-04-01-preview
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
HEADLESS=false
SLOW_MO=100
VIEWPORT_WIDTH=1920
VIEWPORT_HEIGHT=1080
PORT=9005
SCREENSHOT_QUALITY=100
LOG_LEVEL=info
```

### auth.json
Browser session cookies/storage state (auto-generated after Azure login, reused across sessions)

### testlab-settings.json
```json
{
  "githubToken": "<GitHub PAT>",
  "githubUrl": "<default repo URL>",
  "masterdocUrl": "<masterdoc.json URL>",
  "envUrl": "https://portal.azure.com/#home"
}
```

### src/config.js defaults
- LLM provider: `azure`
- Deployment: `gpt-4o`
- API version: `2025-04-01-preview`
- Browser headless: `false`
- Viewport: `1920x1080`
- Screenshot quality: `100`
- Annotation color: red (`{r:255, g:0, b:0, alpha:1}`)
- Annotation stroke: `4px`
- Annotation padding: `6px`
- Server port: `8000`
- Navigation timeout: `60s`
- Default timeout: `30s`

---

## 8. CloudLabs Guide Format Standard

This is the exact output format the tool generates:

```markdown
# Exercise N: Title

## Estimated Duration: XX Minutes

## Lab Overview
[2-3 paragraph description]

## Lab Objectives
In this lab, you will complete the following tasks:
- Task 1: Title
- Task 2: Title

### Task 1: Title
In this task, you will [1-2 sentence description].

1. In the Azure portal, search for **AI Search (1)** and select **AI Search (2)** Resource.

   ![](../images/screenshot.png)

1. Enter the following details:

   - Resource Group: Select **Foundry** **(1)**
   - Name: Enter **value** **(2)**
   - Region: Select **East US 2** **(3)**
   - Click on **Review + Create** **(4)**

     ![](../images/screenshot.png)

### Task 2: Title
...

## Review
In this exercise, you performed the following:
- [bullet summary]

### You have successfully completed this exercise. Kindly click **Next >>** to proceed further
```

### Format Rules
1. **Bold** ALL UI element names
2. Annotation numbers `**(1)**, **(2)**` placed AFTER the bold element
3. Screenshots indented 3-4 spaces below step
4. Empty line between step text and screenshot
5. Notes use `> **Note:**` blockquote syntax
6. Steps use `1.` for all (markdown auto-numbers)
7. Sub-items use `   -` (dash with indent)
8. Image paths: `![](../images/filename.png)` (relative)
9. Each task starts with "In this task, you will..."
10. Professional imperative tone: "Click on...", "Navigate to...", "Enter..."
11. Abbreviations ALWAYS expanded
12. EVERY action gets a numbered annotation

---

## 9. Recording Workflow (How It Works End-to-End)

### Desktop Recording Flow
1. User launches Electron app (`npm run desktop`)
2. App loads `app.html` with landing screen → tabs: Setup, Record, Preview, Export
3. User enters lab title, description, Azure Portal URL
4. User clicks "Start" → browser loads portal, recorder activates, CDP tracking injects
5. User performs lab steps manually in Azure Portal
6. At each key step, user clicks "Capture":
   - Takes screenshot via Electron `capturePage()`
   - Detects & crops Azure sidebar
   - Retrieves last-clicked elements via CDP
   - Auto-annotates clicked element with red circle + number
   - Saves PNG to `output/screenshots/`
   - Records step metadata (description, bounding boxes, page URL/title)
7. User optionally clicks screenshot thumbnail → opens editor.html:
   - Annotate (draw boxes, blur regions, crop, add step circles)
   - Returns edited PNG to main process
8. User edits step descriptions manually in UI
9. User can drag-and-drop to reorder steps, undo/redo actions
10. User clicks "Generate" → orchestrator calls:
    - LLM: generates professional CloudLabs markdown from all steps
    - guide-builder: writes guide.md, manifest.json, copies screenshots
    - Auto-versions previous guide if exists
11. Guide appears in Preview tab; user can export, regenerate, or edit via AI chat

### AI Auto-Record Flow
1. User switches to AI mode tab
2. Clicks "Start Auto-Record"
3. CDP tracks all interactions automatically
4. At each significant click, GPT-4o Vision analyzes the screenshot + context
5. Returns structured step data (description, UI elements, confidence, significance flag)
6. User reviews/approves each auto-detected step
7. Guide generation same as manual mode

### Test Lab Flow
1. User enters GitHub repo URL + masterdoc.json URL
2. App clones repo (or pulls if exists), parses masterdoc
3. Displays lab exercises/files in a navigable tree
4. User can read, edit, and preview existing guide markdown
5. User creates a branch, makes edits
6. Can commit, push, and create a PR — all from within the app

---

## 10. Output Structure

```
output/
  <guide-name>/
    guide.md              # CloudLabs-format markdown
    manifest.json         # Metadata (title, steps, annotations)
    screenshots/          # Step screenshots
      step-01.png
      step-02.png
    versions/             # Auto-created previous versions
      guide.v1.md
      guide.v2.md
```

### manifest.json schema
```json
{
  "schemaVersion": 2,
  "labTitle": "...",
  "labDescription": "...",
  "generatedAt": "ISO timestamp",
  "stepsCount": N,
  "steps": [
    {
      "stepNumber": 1,
      "description": "user's description",
      "screenshot": "step-01.png",
      "pageUrl": "https://portal.azure.com/...",
      "pageTitle": "Page Title - Microsoft Azure",
      "annotations": [
        {
          "number": 1,
          "action": "click",
          "target": {
            "cssSelector": "...",
            "text": "...",
            "ariaLabel": "...",
            "role": "...",
            "tagName": "..."
          },
          "boundingBox": { "x": 274, "y": 7, "width": 390, "height": 26 },
          "pageUrl": "..."
        }
      ]
    }
  ]
}
```

---

## 11. Key Design Decisions

1. **WebContentsView over `<webview>`** — Supports native Bastion RDP popups with `window.opener`
2. **Semi-automated recording** — User controls accuracy; AI handles professional writing
3. **Canvas-based editor** — Direct pixel manipulation for annotations
4. **CDP event listening** — Low-overhead interaction tracking without DOM interference
5. **Dynamic sidebar detection** — Azure sidebar width varies; auto-cropped from screenshots
6. **SVG overlay for annotations** — Clean, scalable; Sharp composites before saving
7. **Fallback markdown template** — When LLM fails, uses templated format
8. **Session versioning** — Auto-backups previous guides before overwriting
9. **Dual LLM provider** — Azure OpenAI or OpenAI, configurable via env

---

## 12. Current State of Generated Guides

5 test guides have been generated so far (all Azure VM related):
1. `how-to-create-vm-in-azure/` (3 steps, generated 2026-03-24)
2. `how-to-open-vm-creation-feature-in-azure/`
3. `how-to-open-vm-creation-in-azure/`
4. `how-to-open-vm-in-azure/`
5. `open-a-existing-virtual-machine-in-azure/`

---

## 13. Cloned Repos (Test Lab)

| Local Folder | Repository |
|---|---|
| `CloudLabsAI-Azure--Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry/` | CloudLabsAI-Azure/Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry |
| `smanojgowda--CloudLabs_Automation/` | smanojgowda/CloudLabs_Automation (Chrome extension) |
| `smanojgowda--Cloudlabs-Lab-Guide-Generator/` | smanojgowda/Cloudlabs-Lab-Guide-Generator (older version of this project) |
| `Aryan-MP--Interns2026/` | Aryan-MP/Interns2026 (intern assignments) |

The user is currently viewing `Challenge-masterdoc.json` from the Azure AI Foundry RAG lab repo.

---

## 14. Masterdoc Format (CloudLabs)

```json
[
  {
    "Name": "Lab : Build a custom knowledge retrieval (RAG) app with the Azure AI Foundry SDK",
    "Language": "English",
    "BaseURL": "https://github.com/CloudLabsAI-Azure/Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry",
    "Files": [
      { "RawFilePath": "https://docs-api.cloudlabs.ai/.../Challenge lab - page1.md", "Order": 1 },
      { "RawFilePath": "https://docs-api.cloudlabs.ai/.../Challenge lab - Getting started.md", "Order": 2 },
      { "RawFilePath": "https://docs-api.cloudlabs.ai/.../Challenge-Based Hackathon.md", "Order": 3 }
    ]
  }
]
```

---

## 15. What Has Been Built (Completed Features)

- [x] Electron desktop app with split-view (Azure Portal + Recorder panel)
- [x] CDP-based click tracking with element metadata extraction
- [x] Screenshot capture pipeline (full-page → sidebar crop → HiDPI scaling → annotation overlay)
- [x] Canvas-based screenshot editor (box, blur, step circles, crop)
- [x] LLM guide generation with detailed CloudLabs format system prompt
- [x] GPT-4o Vision auto-analysis service
- [x] Guide versioning (auto-backup before overwrite)
- [x] Express API server with 30+ routes
- [x] CLI recording mode
- [x] Web UI recording mode
- [x] Auth session persistence (auth.json)
- [x] Git integration (clone, branch, commit, push, PR)
- [x] Masterdoc parser for CloudLabs structure
- [x] Test Lab mode (import, edit, preview existing guides)
- [x] Multi-tab browser support with Bastion popup handling
- [x] Drag-and-drop step reordering
- [x] Undo/redo with keyboard shortcuts
- [x] Version diff viewer
- [x] PDF export
- [x] AI-powered guide editing via chat
- [x] Dark theme with Spektra purple branding
- [x] Landing screen with branding

---

## 16. Related Projects in Workspace

- **smanojgowda/CloudLabs_Automation** — Chrome extension for CloudLabs portal automation (background.js, content.js, sidepanel)
- **smanojgowda/Cloudlabs-Lab-Guide-Generator** — Older version of this same project (also has desktop.js, package.json, src/)

---

## 17. How to Run

```bash
# Install dependencies
npm install

# Configure .env with Azure OpenAI or OpenAI keys

# Run desktop app (primary mode)
npm run desktop

# Run CLI recording
npm run record

# Run web UI
npm run serve
```

---

*End of project context document. This covers all architecture, code, features, configuration, and current state.*
