/**
 * Express API server — Record Mode web UI & API
 */
import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import config from './config.js';
import logger from './utils/logger.js';
import {
  startSession, recordStep, stopAndGenerate, getSessionStatus,
  closeBrowser, removeStep, editStep, cancelSession,
  addCapturedStep,
} from './agent/orchestrator.js';
import { getSteps } from './core/recorder.js';
import { proposeGuideEdit } from './services/llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(resolve(__dirname, 'public')));

// Serve output/screenshots
app.use('/output', express.static(config.paths.output));
app.use('/screenshots', express.static(config.paths.screenshots));

// ─── API Routes ───────────────────────────────────────────────────────

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    mode: 'record',
    llmProvider: config.llm.provider,
    llmModel: config.llm.provider === 'azure' ? config.llm.azure.deployment : config.llm.openai.model,
  });
});

/**
 * GET /api/session — Get current session status and all steps
 */
app.get('/api/session', (req, res) => {
  res.json(getSessionStatus());
});

/**
 * POST /api/session/start — Launch browser & start recording
 * Body: { url?: string, title?: string, description?: string }
 */
app.post('/api/session/start', async (req, res) => {
  try {
    const { url, title, description } = req.body || {};
    const result = await startSession({
      url: typeof url === 'string' ? url.slice(0, 2000) : undefined,
      title: typeof title === 'string' ? title.slice(0, 500) : undefined,
      description: typeof description === 'string' ? description.slice(0, 5000) : undefined,
    });
    res.json(result);
  } catch (err) {
    logger.error(`API /session/start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/capture — Capture current screen as a step
 * Body: { description?: string, highlights?: Array<{selector?, text?, x?, y?, label?}> }
 */
app.post('/api/session/capture', async (req, res) => {
  try {
    const { description, highlights } = req.body || {};
    const step = await recordStep(
      typeof description === 'string' ? description.slice(0, 2000) : undefined,
      Array.isArray(highlights) ? highlights : undefined,
    );
    res.json(step);
  } catch (err) {
    logger.error(`API /session/capture error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/session/step/:num — Update a step's description
 * Body: { description: string }
 */
app.put('/api/session/step/:num', (req, res) => {
  const num = parseInt(req.params.num, 10);
  const { description } = req.body || {};
  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'Missing description' });
  }
  editStep(num, description.slice(0, 2000));
  res.json({ status: 'updated' });
});

/**
 * DELETE /api/session/step/:num — Delete a step
 */
app.delete('/api/session/step/:num', (req, res) => {
  const num = parseInt(req.params.num, 10);
  removeStep(num);
  res.json({ status: 'deleted' });
});

/**
 * POST /api/session/generate — Stop recording & generate guide
 * Body: { title?: string, description?: string, guideName?: string }
 */
app.post('/api/session/generate', async (req, res) => {
  try {
    const { title, description, guideName } = req.body || {};
    const result = await stopAndGenerate({
      title: typeof title === 'string' ? title.slice(0, 500) : undefined,
      description: typeof description === 'string' ? description.slice(0, 5000) : undefined,
      guideName: typeof guideName === 'string' ? guideName.replace(/[^a-z0-9-]/gi, '').slice(0, 60) : undefined,
    });
    res.json({
      markdownPath: result.markdownPath,
      guideDir: result.guideDir,
      markdown: result.markdown,
      stepsCount: result.steps.length,
    });
  } catch (err) {
    logger.error(`API /session/generate error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/cancel — Cancel without generating
 */
app.post('/api/session/cancel', (req, res) => {
  cancelSession();
  res.json({ status: 'cancelled' });
});

/**
 * POST /api/desktop/capture — Capture a step from Electron desktop app.
 * Receives a base64 screenshot + click data, processes with Sharp, saves as a step.
 * Body: { screenshot: base64, description?: string, clickBox?: {x,y,width,height}, pageUrl?, pageTitle?, dpr? }
 */
app.post('/api/desktop/capture', async (req, res) => {
  try {
    const { screenshot, description, clickBox, pageUrl, pageTitle, dpr } = req.body || {};
    if (!screenshot || typeof screenshot !== 'string') {
      return res.status(400).json({ error: 'Missing screenshot data' });
    }

    const buffer = Buffer.from(screenshot, 'base64');
    const step = await addCapturedStep({
      description: typeof description === 'string' ? description.slice(0, 2000) : '',
      buffer,
      clickBox: clickBox || null,
      pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : '',
      pageTitle: typeof pageTitle === 'string' ? pageTitle.slice(0, 500) : '',
      dpr: typeof dpr === 'number' ? dpr : 1,
    });
    res.json(step);
  } catch (err) {
    logger.error(`API /desktop/capture error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/desktop/edit-screenshot — Overwrite a step's screenshot with an edited image.
 * Body: { stepNumber: number, screenshot: base64 }
 */
app.post('/api/desktop/edit-screenshot', (req, res) => {
  try {
    const { stepNumber, screenshot } = req.body || {};
    if (!stepNumber || !screenshot || typeof screenshot !== 'string') {
      return res.status(400).json({ error: 'Missing stepNumber or screenshot' });
    }
    const steps = getSteps();
    const step = steps.find(s => s.stepNumber === stepNumber);
    if (!step || !step.screenshotPath) {
      return res.status(404).json({ error: 'Step not found' });
    }
    const buf = Buffer.from(screenshot, 'base64');
    writeFileSync(step.screenshotPath, buf);
    res.json({ status: 'updated', stepNumber });
  } catch (err) {
    logger.error(`API /desktop/edit-screenshot error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guides — List generated guides
 */
app.get('/api/guides', (req, res) => {
  try {
    const outputDir = config.paths.output;
    if (!existsSync(outputDir)) return res.json({ guides: [] });

    const entries = readdirSync(outputDir, { withFileTypes: true });
    const guides = entries
      .filter(e => e.isDirectory() && e.name !== 'screenshots')
      .map(e => {
        const manifestPath = resolve(outputDir, e.name, 'manifest.json');
        let manifest = null;
        if (existsSync(manifestPath)) {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        }
        return { name: e.name, manifest, guidePath: `/output/${e.name}/guide.md` };
      });

    res.json({ guides });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guides/:name — Get a specific guide's Markdown
 */
app.get('/api/guides/:name', (req, res) => {
  const name = req.params.name.replace(/[^a-z0-9-]/gi, '');
  const mdPath = resolve(config.paths.output, name, 'guide.md');
  if (!existsSync(mdPath)) return res.status(404).json({ error: 'Guide not found' });

  const markdown = readFileSync(mdPath, 'utf-8');
  res.json({ name, markdown });
});

/**
 * POST /api/chat/edit — Ask AI to propose edits to the guide.
 * Body: { message: string, markdown: string }
 * Returns: { explanation: string, changes: [{ oldText, newText }] }
 */
app.post('/api/chat/edit', async (req, res) => {
  try {
    const { message, markdown } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing message' });
    }
    if (!markdown || typeof markdown !== 'string') {
      return res.status(400).json({ error: 'No guide markdown provided. Generate a guide first.' });
    }
    const result = await proposeGuideEdit(
      markdown.slice(0, 100000),
      message.slice(0, 2000),
    );
    res.json(result);
  } catch (err) {
    logger.error(`API /chat/edit error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(resolve(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────

/**
 * Try to listen on the preferred port. If it's busy, increment and retry (up to 20 attempts).
 * Stores the actual port on app.actualPort so Electron can read it.
 */
function startListening(preferredPort) {
  return new Promise((resolve, reject) => {
    let port = preferredPort;
    const maxAttempts = 20;
    let attempt = 0;

    function tryPort() {
      attempt++;
      const server = app.listen(port, () => {
        app.actualPort = port;
        logger.info(`Record Mode server: http://localhost:${port}`);
        logger.info(`LLM: ${config.llm.provider} / ${config.llm.provider === 'azure' ? config.llm.azure.deployment : config.llm.openai.model}`);
        resolve(port);
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
          logger.warn(`Port ${port} busy, trying ${port + 1}...`);
          port++;
          tryPort();
        } else {
          reject(err);
        }
      });
    }
    tryPort();
  });
}

const actualPort = await startListening(config.server.port);
export { actualPort };
export default app;
