# Spektra Lab Studio — Comprehensive Project Report

> **Report Date:** April 14, 2026  
> **Project Version:** 3.0.0  
> **Author:** Auto-generated project analysis  

---

## Executive Summary

**Spektra Lab Studio** is a semi-automated, AI-powered desktop application for generating Azure lab guides in **CloudLabs format** — the standard used by Spektra Systems / CloudLabsAI for hands-on lab documentation. The tool combines Electron, Playwright, Sharp image processing, and GPT-4o (via Azure OpenAI or OpenAI) to capture, annotate, and transform manual Azure Portal interactions into professional, publication-ready lab guide documents.

The project is in an **active development state** with a mature architecture, 8 generated test guides, 31 total screenshots, 4 cloned reference repositories, and full end-to-end functionality across 3 operational modes (Manual Record, AI Auto-Record, and Test Lab).

---

## 1. Project Identity

| Attribute | Value |
|-----------|-------|
| **Name** | Spektra Lab Studio |
| **Package Name** | `lab-guide-agent` |
| **Version** | 3.0.0 |
| **Module System** | ES Modules (`"type": "module"`) |
| **Node.js Requirement** | >= 18.0.0 |
| **Project Location** | `c:\Users\s manoj gowda\Desktop\Cloud Projects\Spektra Lab Studio` |
| **Primary Author** | smanojgowda |
| **Domain** | Azure Lab Guide Automation (CloudLabs/Spektra Systems) |

---

## 2. Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Node.js | >=18.0.0 | Server-side JavaScript runtime |
| **Desktop Framework** | Electron | 33.3.1 | Cross-platform desktop app shell |
| **Browser Automation** | Playwright | 1.52.0 | Chromium control, CDP integration |
| **Image Processing** | Sharp | 0.33.5 | Screenshot cropping, annotation, SVG overlay |
| **Web Server** | Express | 4.21.0 | REST API backend (30+ routes) |
| **LLM Integration** | OpenAI SDK | 4.85.0 | GPT-4o guide generation & vision analysis |
| **Git Operations** | simple-git | 3.33.0 | Clone, branch, commit, push, PR creation |
| **Logging** | Winston | 3.17.0 | Structured logging |
| **CLI Framework** | Commander | 13.1.0 | Interactive command-line interface |
| **UI** | HTML/CSS/JS | — | Dark theme, Spektra purple (`#7c3aed`) branding |

---

## 3. Architecture Overview

### 3.1 System Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON DESKTOP APP                            │
│                                                                          │
│  ┌─────────────────────────────┐  ┌────────────────────────────────────┐ │
│  │   Azure Portal              │  │   Recorder Panel (app.html)        │ │
│  │   (WebContentsView)         │  │                                    │ │
│  │                             │  │  ┌─ Landing Screen               │ │
│  │   • User navigates Azure    │  │  ├─ Setup Tab (title, URL)       │ │
│  │   • CDP tracks clicks       │  │  ├─ Record Tab (capture, steps)  │ │
│  │   • Bastion RDP popups      │  │  ├─ AI Tab (auto-record)         │ │
│  │   • Multi-tab browsing      │  │  ├─ Test Tab (GitHub import)     │ │
│  │                             │  │  ├─ Preview Tab (markdown)       │ │
│  └──────────────┬──────────────┘  │  └─ Export Tab (PDF, files)      │ │
│                 │                  └─────────────────┬──────────────────┘ │
│                 │     IPC Bridge (preload.cjs)       │                   │
└─────────────────┼───────────────────────────────────┼───────────────────┘
                  │                                   │
    ┌─────────────▼─────────────┐       ┌─────────────▼─────────────┐
    │   Core Layer              │       │   Services Layer           │
    │                           │       │                            │
    │  • browser.js (Playwright)│       │  • llm.js (GPT-4o)        │
    │  • recorder.js (CDP)      │       │  • vision.js (GPT-4o V)   │
    │  • screenshot.js (Sharp)  │       │  • guide-builder.js       │
    │                           │       │  • git-service.js          │
    └───────────────────────────┘       │  • masterdoc-parser.js     │
                                        └──────────────┬─────────────┘
                                                       │
                                        ┌──────────────▼─────────────┐
                                        │   Output                    │
                                        │                             │
                                        │  output/<guide-name>/       │
                                        │  ├── guide.md               │
                                        │  ├── manifest.json          │
                                        │  ├── screenshots/           │
                                        │  └── versions/              │
                                        └─────────────────────────────┘
```

### 3.2 Layered Architecture

| Layer | Files | Responsibility |
|-------|-------|---------------|
| **Entry Points** | `desktop.js`, `src/index.js`, `src/server.js` | App startup, IPC handlers, REST API |
| **Agent** | `src/agent/orchestrator.js` | Session lifecycle management (start/capture/generate) |
| **Core** | `src/core/browser.js`, `recorder.js`, `screenshot.js` | Browser automation, CDP recording, image processing |
| **Services** | `src/services/llm.js`, `vision.js`, `guide-builder.js`, `git-service.js`, `masterdoc-parser.js` | AI generation, Git operations, output assembly |
| **Desktop UI** | `src/desktop/app.html`, `editor.html`, `preload.cjs`, `editor-preload.cjs`, `snipping.html` | Electron renderer processes, screenshot editor |
| **Utilities** | `src/utils/logger.js`, `dom-helpers.js` | Structured logging, Azure sidebar detection |
| **Configuration** | `src/config.js`, `.env`, `auth.json`, `testlab-settings.json` | Environment variables, auth persistence, settings |

---

## 4. Operational Modes

### Mode 1: Manual Record (Primary)
- User manually navigates the Azure Portal in the embedded browser
- Clicks **Capture** at each important step
- CDP tracks last-clicked elements for auto-annotation
- User edits screenshots with built-in canvas editor (boxes, blur, step circles, crop)
- User adds step descriptions
- GPT-4o generates professional CloudLabs-format guide from all steps

### Mode 2: AI Auto-Record
- GPT-4o Vision automatically detects significant interactions
- Generates structured step descriptions, UI element lists, and confidence scores
- User reviews and approves each auto-detected step
- Reduces manual effort from description writing

### Mode 3: Test Lab (Edit Existing Guides)
- Import existing lab guides from GitHub via masterdoc.json URL
- Clone repository, navigate lab exercises/files
- Edit and preview markdown in-browser
- Create branches, commit, push, and open Pull Requests — all from within the app

---

## 5. Feature Inventory

### Core Recording Features
| Feature | Status | Description |
|---------|--------|-------------|
| CDP Click Tracking | ✅ Complete | Chrome DevTools Protocol-based element metadata extraction |
| Screenshot Pipeline | ✅ Complete | Full-page capture → sidebar crop → HiDPI scaling → annotation overlay |
| Canvas Editor | ✅ Complete | Draw red boxes, blur regions, place numbered step circles, crop |
| LLM Guide Generation | ✅ Complete | Azure OpenAI / OpenAI GPT-4o with detailed system prompt |
| GPT-4o Vision Analysis | ✅ Complete | Auto-detect and describe UI interactions |
| Session Versioning | ✅ Complete | Auto-backup previous guides before overwriting |
| Step Management | ✅ Complete | Add, edit, delete, drag-and-drop reorder, undo/redo |
| Auth Persistence | ✅ Complete | Azure login session saved/reused across app restarts |

### Desktop App Features
| Feature | Status | Description |
|---------|--------|-------------|
| Split-View Layout | ✅ Complete | Azure Portal (left) + Recorder Panel (right) |
| Multi-Tab Browsing | ✅ Complete | New tab, close tab, Bastion tabs (green) |
| Bastion RDP/SSH Support | ✅ Complete | Frameless child window via WebContentsView |
| Markdown Preview | ✅ Complete | Full guide preview with syntax highlighting |
| Source View Editor | ✅ Complete | Raw markdown editing |
| Version Diff Viewer | ✅ Complete | Side-by-side comparison of guide versions |
| PDF Export | ✅ Complete | Offscreen BrowserWindow PDF rendering |
| Landing Screen & Branding | ✅ Complete | Radial gradient, Spektra purple theme |
| Keyboard Shortcuts | ✅ Complete | Ctrl+Z/Y undo/redo, standard shortcuts |

### Git / Test Lab Features
| Feature | Status | Description |
|---------|--------|-------------|
| Repository Cloning | ✅ Complete | Shallow clone (depth=1), auto-pull on re-open |
| Branch Management | ✅ Complete | Create named working branches |
| Commit & Push | ✅ Complete | Stage all, commit with message, push to remote |
| Pull Request Creation | ✅ Complete | GitHub REST API PR creation |
| Masterdoc Parsing | ✅ Complete | Fetch and parse CloudLabs masterdoc.json structure |
| GitHub Token Persistence | ✅ Complete | Stored in testlab-settings.json |

### API / Multi-Mode Support
| Feature | Status | Description |
|---------|--------|-------------|
| Express REST API | ✅ Complete | 30+ endpoints for all operations |
| CLI Recording | ✅ Complete | Interactive terminal-based recording |
| Web UI | ✅ Complete | Single-page app on localhost:9005 |
| AI Chat Editing | ✅ Complete | `proposeGuideEdit()` for LLM-powered guide editing |

---

## 6. Codebase Metrics

### Source Files & Lines of Code

| File | Lines (approx.) | Description |
|------|-----------------|-------------|
| `desktop.js` | **1,191** | Electron main process, 30 IPC handlers |
| `src/server.js` | **~1,200** | Express API server, 30+ routes |
| `src/desktop/app.html` | **~2,900** | Full SPA (HTML + CSS + JS inline) |
| `src/desktop/editor.html` | **~800** | Canvas-based screenshot editor |
| `src/services/llm.js` | **~300** | LLM integration + 200-line system prompt |
| `src/services/vision.js` | **~150** | GPT-4o Vision integration |
| `src/core/recorder.js` | **~250** | CDP recording logic |
| `src/core/screenshot.js` | **~200** | Sharp image pipeline |
| `src/core/browser.js` | **~100** | Playwright lifecycle |
| `src/agent/orchestrator.js` | **~200** | Session orchestration |
| `src/services/guide-builder.js` | **~150** | Guide assembly + versioning |
| `src/services/git-service.js` | **~200** | Git operations |
| `src/services/masterdoc-parser.js` | **~100** | Masterdoc parsing |
| `src/config.js` | **67** | Configuration loader |
| **Total Estimated** | **~7,800+** | **Core application code** |

### Project Structure Summary

| Category | Count |
|----------|-------|
| Source files (`.js`, `.cjs`, `.html`) | 18 |
| Configuration files | 5 (`.env`, `config.js`, `auth.json`, `testlab-settings.json`, `package.json`) |
| Dependencies (production) | 10 |
| Dev dependencies | 1 (Electron) |
| API endpoints | 30+ |
| IPC handlers | 30 |

---

## 7. Generated Output Analysis

### Lab Guides Produced

| # | Guide Name | Steps | Screenshots | Generated Date |
|---|-----------|-------|-------------|---------------|
| 1 | deploy-a-vm | 3 | 3 | 2026-04-10 10:02 |
| 2 | deploy-a-vm-in-azure | 9 | 9 | 2026-04-10 11:28 |
| 3 | how-to-create-vm-in-azure | 3 | 3 | 2026-03-24 17:20 |
| 4 | how-to-open-vm-creation-feature-in-azure | 3 | 3 | 2026-03-24 05:32 |
| 5 | how-to-open-vm-creation-in-azure | 3 | 3 | 2026-03-24 05:37 |
| 6 | how-to-open-vm-in-azure | 3 | 3 | 2026-03-24 17:35 |
| 7 | open-a-existing-virtual-machine-in-azure | 4 | 4 | 2026-03-27 06:49 |
| 8 | open-existing-vm | 3 | 3 | 2026-04-10 12:28 |

**Totals: 8 guides | 31 steps | 31 screenshots**

### Output Format Per Guide

```
output/<guide-name>/
├── guide.md              # CloudLabs-format professional markdown
├── manifest.json         # Metadata (schemaVersion 2, steps[], annotations[])
├── screenshots/          # Individual step PNGs (step-01.png, step-02.png, ...)
└── versions/             # Auto-archived previous versions (guide.v1.md, ...)
```

### Output Quality Characteristics
- **Professional tone**: Imperative instructions ("Click on...", "Navigate to...")
- **Bold UI elements**: All buttons, fields, menu items bolded
- **Numbered annotations**: **(1)**, **(2)**, **(3)** mapped to screenshot highlights
- **Task grouping**: Related steps organized into logical tasks
- **Abbreviation expansion**: vm → Virtual machine, rg → Resource group, etc.
- **CloudLabs structure**: Exercise → Duration → Overview → Objectives → Tasks → Review → Success message

---

## 8. Cloned Repositories (Test Lab)

| Repository | Local Folder | Purpose |
|-----------|-------------|---------|
| CloudLabsAI-Azure/Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry | `repos/CloudLabsAI-Azure--Build-Custom-Knowledge-RAG-App-With-Azure-AI-Foundry/` | Azure AI Foundry RAG tutorial lab guide |
| smanojgowda/CloudLabs_Automation | `repos/smanojgowda--CloudLabs_Automation/` | Chrome extension for CloudLabs portal automation |
| smanojgowda/Cloudlabs-Lab-Guide-Generator | `repos/smanojgowda--Cloudlabs-Lab-Guide-Generator/` | Previous version of this project |
| Aryan-MP/Interns2026 | `repos/Aryan-MP--Interns2026/` | Intern assessment/assignment files |

---

## 9. API Documentation

### Session Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Health check + LLM provider info |
| `GET` | `/api/session` | Current session status |
| `POST` | `/api/session/start` | Start a recording session |
| `POST` | `/api/session/capture` | Capture a step (CLI mode) |
| `PUT` | `/api/session/step/:num` | Update step description |
| `DELETE` | `/api/session/step/:num` | Delete a step |
| `POST` | `/api/session/generate` | Generate guide from recorded steps |
| `POST` | `/api/session/cancel` | Cancel active session |

### Desktop-Specific
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/desktop/capture` | Capture step (desktop mode, base64) |
| `POST` | `/api/desktop/edit-screenshot` | Save edited screenshot |

### Guide Access
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/guides` | List all generated guides |
| `GET` | `/api/guides/:name` | Get specific guide markdown |

### AI Features
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/chat/edit` | AI-powered guide editing via chat |
| `POST` | `/api/ai/analyze` | GPT-4o Vision screenshot analysis |
| `POST` | `/api/ai/capture` | AI auto-record capture |

### Test Lab / Git Operations
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/testlab/setup` | Clone repo + parse masterdoc |
| `POST` | `/api/testlab/save-file` | Save markdown to local repo |
| `POST` | `/api/testlab/save-screenshot` | Save screenshot to repo |
| `POST` | `/api/testlab/branch` | Create working branch |
| `GET` | `/api/testlab/status` | Git status |
| `POST` | `/api/testlab/commit` | Commit & push |
| `POST` | `/api/testlab/pull-request` | Create GitHub PR |
| `GET` | `/api/testlab/diff` | Git diff summary |
| `POST` | `/api/testlab/read-file` | Read file from cloned repo |

---

## 10. Configuration Reference

### Environment Variables (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_PROVIDER` | `azure` | LLM provider (`azure` or `openai`) |
| `AZURE_OPENAI_API_KEY` | — | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | — | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o` | Azure deployment name |
| `AZURE_OPENAI_API_VERSION` | `2025-04-01-preview` | API version |
| `OPENAI_API_KEY` | — | OpenAI API key (if using OpenAI) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model name |
| `HEADLESS` | `false` | Browser headless mode |
| `SLOW_MO` | `100` | Playwright slow motion (ms) |
| `VIEWPORT_WIDTH` | `1920` | Browser viewport width |
| `VIEWPORT_HEIGHT` | `1080` | Browser viewport height |
| `PORT` | `9005` | Express server port |
| `SCREENSHOT_QUALITY` | `100` | PNG quality |
| `LOG_LEVEL` | `info` | Winston log level |

### Persistent Files

| File | Purpose |
|------|---------|
| `auth.json` | Browser session cookies/storage state (auto-generated after Azure login) |
| `testlab-settings.json` | GitHub token, repo URL, masterdoc URL, environment URL |

---

## 11. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **WebContentsView** over `<webview>` | Supports native Bastion RDP popups with `window.opener` |
| 2 | **Semi-automated recording** | User controls navigation accuracy; AI handles professional writing |
| 3 | **Canvas-based screenshot editor** | Direct pixel manipulation for annotations without external tools |
| 4 | **CDP event listening** | Low-overhead click tracking without injecting into DOM |
| 5 | **Dynamic sidebar detection** | Azure sidebar width varies per page; auto-cropped |
| 6 | **SVG overlay annotations** | Clean, scalable numbered circles/rectangles via Sharp composite |
| 7 | **Fallback markdown template** | Graceful degradation when LLM API fails |
| 8 | **Auto-versioning** | Backup previous guides before overwriting — no data loss |
| 9 | **Dual LLM provider support** | Azure OpenAI or OpenAI, configurable via `.env` |
| 10 | **Persistent auth sessions** | Avoids Azure login on every app restart |

---

## 12. Screenshot Processing Pipeline

```
1. Full-page screenshot (Playwright page.screenshot() or Electron capturePage())
        │
2. Dynamic sidebar detection (CSS selectors via dom-helpers.js)
        │
3. Sidebar crop (Sharp — remove Azure Portal left navigation)
        │
4. HiDPI scale correction (compute scaleX/scaleY between image and viewport)
        │
5. Annotation overlay generation (SVG with red rectangles + numbered circles)
        │
6. SVG composite onto screenshot (Sharp overlay)
        │
7. Save processed PNG to output/screenshots/step-NN.png
```

**Configuration Defaults:**
- Annotation color: Red (`{r:255, g:0, b:0, alpha:1}`)
- Annotation stroke: 4px
- Annotation padding: 6px
- Screenshot quality: 100%
- Viewport: 1920×1080

---

## 13. LLM System Prompt Overview

The LLM integration uses an extensive system prompt (~200+ lines) with:

- **Role**: Expert technical writer for CloudLabs/Spektra Systems
- **Input**: Raw step descriptions + screenshot metadata + annotations
- **Output**: Professional CloudLabs-format markdown
- **Key Instructions**:
  - Rewrite casual descriptions into polished, imperative instructions
  - Expand all abbreviations (30+ mappings: vm, rg, nsg, vnet, aks, etc.)
  - Fix spelling mistakes silently
  - Bold all UI element names
  - Assign numbered annotations matching screenshot highlights
  - Group steps into logical tasks
  - Add Exercise header, Duration, Overview, Objectives, Review, Success message
- **5 worked examples** showing input → output transformations
- **Temperature**: Low (for consistency)

---

## 14. Development & Deployment

### How to Run

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Configure environment
# Copy .env.example to .env and add API keys

# Run desktop app (primary mode)
npm run desktop

# Run CLI recording
npm run record

# Run web UI server
npm run serve

# Run API server only
npm run server
```

### NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `electron desktop.js` | Start Electron app |
| `desktop` | `electron desktop.js` | Start Electron app (alias) |
| `dev` | `electron desktop.js` | Development mode |
| `record` | `node src/index.js record` | Interactive CLI recording |
| `serve` | `node src/index.js serve` | Web UI on port 9005 |
| `server` | `node src/server.js` | Express API server only |

---

## 15. Project Health Assessment

### Strengths

| Area | Assessment |
|------|-----------|
| **Architecture** | ✅ Clean layered architecture with clear separation of concerns |
| **Feature Completeness** | ✅ All 3 modes functional (Manual, AI, Test Lab) |
| **LLM Integration** | ✅ Comprehensive system prompt produces professional output |
| **Screenshot Pipeline** | ✅ Robust pipeline (capture → crop → scale → annotate → save) |
| **Git Integration** | ✅ Full workflow (clone → branch → commit → push → PR) |
| **Multi-Mode Operation** | ✅ Desktop, CLI, and Web UI all operational |
| **Error Handling** | ✅ Fallback templates, session versioning, auth persistence |
| **UI/UX** | ✅ Professional dark theme with Spektra branding |

### Areas for Improvement

| Area | Observation |
|------|------------|
| **Testing** | ⚠️ No test suite found (unit, integration, or E2E tests) |
| **CI/CD** | ⚠️ No continuous integration or deployment pipeline |
| **Documentation** | ℹ️ Good README and PROJECT_CONTEXT.md; could add JSDoc to source |
| **Error Logging** | ℹ️ Winston logger in place; could benefit from centralized error reporting |
| **Guide Variety** | ℹ️ All 8 test guides are Azure VM-related; broader testing recommended |
| **Packaging** | ⚠️ No Electron builder/packager configured for distribution |
| **Security** | ⚠️ GitHub token stored in plaintext (`testlab-settings.json`); consider OS keychain |
| **Accessibility** | ℹ️ Desktop UI could benefit from ARIA labels and keyboard navigation enhancements |

---

## 16. Statistics Summary

| Metric | Value |
|--------|-------|
| **Total Source Files** | ~18 |
| **Total Lines of Code** | ~7,800+ |
| **Production Dependencies** | 10 |
| **API Endpoints** | 30+ |
| **IPC Handlers** | 30 |
| **Generated Lab Guides** | 8 |
| **Total Recorded Steps** | 31 |
| **Total Screenshots** | 31 |
| **Cloned Repositories** | 4 |
| **App Modes** | 3 (Manual, AI, Test Lab) |
| **LLM Providers Supported** | 2 (Azure OpenAI, OpenAI) |
| **UI Themes** | Dark (Spektra purple `#7c3aed`) |

---

## 17. Conclusion

Spektra Lab Studio is a well-architected, feature-rich tool that addresses a real workflow need — automating the creation of professional Azure lab documentation. The project demonstrates strong engineering practices with its layered architecture, dual LLM provider support, comprehensive screenshot pipeline, and multi-mode operation.

The tool has proven its capability through 8 generated guides totaling 31 annotated steps with screenshots. The combination of semi-automated recording (human accuracy) with AI-powered writing (professional quality) represents an effective approach to lab documentation.

**Key recommendations for next steps:**
1. Add automated tests (unit + integration) for critical paths
2. Configure Electron Builder for distributable packages
3. Move sensitive tokens to OS keychain/credential store
4. Expand test coverage beyond Azure VM scenarios
5. Set up CI/CD pipeline for automated builds

---

*Report generated from project analysis on April 14, 2026.*
