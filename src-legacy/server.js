/**
 * Express API server — Record Mode web UI & API
 */
import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import config from './config.js';
import logger from './utils/logger.js';
import {
  startSession, recordStep, stopAndGenerate, getSessionStatus,
  closeBrowser, removeStep, editStep, cancelSession,
  addCapturedStep,
} from './agent/orchestrator.js';
import { getSteps } from './core/recorder.js';
import { proposeGuideEdit, generateGuideAssist } from './services/llm.js';
import { analyzeStep } from './services/vision.js';
import { parseMasterdoc, fetchMasterdocFiles, parseGitHubUrl, extractBranch } from './services/masterdoc-parser.js';
import { cloneOrPull, createBranch, commitAndPush, getStatus, createPullRequest, getDiffSummary, REPOS_DIR } from './services/git-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(resolve(__dirname, 'public')));

// Serve output/screenshots
app.use('/output', express.static(config.paths.output));
app.use('/screenshots', express.static(config.paths.screenshots));

/**
 * Recursively discover .md files in a repo directory.
 * Skips hidden dirs, node_modules, and common non-guide paths.
 */
function discoverMarkdownFiles(rootDir, relDir = '') {
  const results = [];
  const fullDir = relDir ? resolve(rootDir, relDir) : rootDir;
  if (!existsSync(fullDir)) return results;

  for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...discoverMarkdownFiles(rootDir, relPath));
    } else if (entry.name.endsWith('.md')) {
      results.push({
        repoPath: relPath,
        filename: entry.name,
        fullPath: resolve(rootDir, relPath),
      });
    }
  }
  return results;
}

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
    const { screenshot, description, clickBox, clickBoxes, pageUrl, pageTitle, dpr } = req.body || {};
    if (!screenshot || typeof screenshot !== 'string') {
      return res.status(400).json({ error: 'Missing screenshot data' });
    }

    const buffer = Buffer.from(screenshot, 'base64');
    const step = await addCapturedStep({
      description: typeof description === 'string' ? description.slice(0, 2000) : '',
      buffer,
      clickBox: clickBox || null,
      clickBoxes: Array.isArray(clickBoxes) ? clickBoxes : null,
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
          try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')); } catch { /* corrupt manifest */ }
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

/**
 * POST /api/guide-assist — Generate a step-by-step procedure outline for a lab topic.
 * Body: { topic: string, context?: string }
 * Returns: { labTitle, estimatedDuration, overview, prerequisites, tasks }
 */
app.post('/api/guide-assist', async (req, res) => {
  try {
    const { topic, context: additionalContext } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing topic' });
    }
    const result = await generateGuideAssist(
      topic.slice(0, 500),
      additionalContext ? String(additionalContext).slice(0, 1000) : '',
    );
    res.json(result);
  } catch (err) {
    logger.error(`API /guide-assist error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Test Lab API Routes ──────────────────────────────────────────────

/**
 * POST /api/testlab/setup — Clone repo, parse masterdoc (optional), return guide structure
 * Body: { githubUrl: string, masterdocUrl?: string, token?: string }
 */
app.post('/api/testlab/setup', async (req, res) => {
  try {
    const { githubUrl, masterdocUrl, token } = req.body || {};
    if (!githubUrl || typeof githubUrl !== 'string') {
      return res.status(400).json({ error: 'Missing githubUrl' });
    }

    // Parse GitHub URL
    const { owner, repo, cloneUrl } = parseGitHubUrl(githubUrl.slice(0, 500));
    const branch = masterdocUrl ? extractBranch(masterdocUrl.slice(0, 1000)) : undefined;

    // Clone or pull repo (token enables private repo access)
    const { localPath, cloned } = await cloneOrPull({
      cloneUrl, owner, repo, branch,
      token: typeof token === 'string' ? token.slice(0, 200) : undefined,
    });

    let labName, language, files;

    if (masterdocUrl && typeof masterdocUrl === 'string') {
      // Parse masterdoc
      const masterdoc = await parseMasterdoc(masterdocUrl.slice(0, 1000));
      labName = masterdoc.name;
      language = masterdoc.language;

      // Read file contents from local repo
      files = masterdoc.files.map(f => {
        const filePath = resolve(localPath, f.repoPath);
        let content = null;
        if (existsSync(filePath)) {
          content = readFileSync(filePath, 'utf-8');
        }
        return { ...f, localPath: filePath, content };
      });
    } else {
      // No masterdoc — discover markdown files from the repo
      labName = repo;
      language = 'English';
      files = discoverMarkdownFiles(localPath).map((f, idx) => {
        const content = readFileSync(f.fullPath, 'utf-8');
        return {
          rawUrl: null,
          order: idx + 1,
          repoPath: f.repoPath,
          filename: f.filename,
          localPath: f.fullPath,
          content,
        };
      });
    }

    res.json({
      owner, repo, branch: branch || 'main', localPath, cloned,
      labName,
      language,
      files,
    });
  } catch (err) {
    logger.error(`API /testlab/setup error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/save-file — Save edited markdown back to the local repo
 * Body: { filePath: string, content: string }
 */
app.post('/api/testlab/save-file', (req, res) => {
  try {
    const { filePath, content } = req.body || {};
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'Missing filePath' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing content' });
    }
    // Security: ensure the path is within the repos directory
    const normalizedPath = resolve(filePath);
    if (!normalizedPath.startsWith(REPOS_DIR)) {
      return res.status(403).json({ error: 'Cannot write outside repos directory' });
    }
    writeFileSync(normalizedPath, content, 'utf-8');
    res.json({ status: 'saved', filePath: normalizedPath });
  } catch (err) {
    logger.error(`API /testlab/save-file error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/save-screenshot — Save a screenshot to the repo at a given path
 * Body: { repoPath: string, screenshotRelPath: string, screenshot: base64 }
 */
app.post('/api/testlab/save-screenshot', (req, res) => {
  try {
    const { repoPath, screenshotRelPath, screenshot } = req.body || {};
    if (!repoPath || !screenshotRelPath || !screenshot) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const fullPath = resolve(repoPath, screenshotRelPath);
    const normalizedPath = resolve(fullPath);
    if (!normalizedPath.startsWith(REPOS_DIR)) {
      return res.status(403).json({ error: 'Cannot write outside repos directory' });
    }
    const dir = dirname(normalizedPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(screenshot, 'base64');
    writeFileSync(normalizedPath, buf);
    res.json({ status: 'saved', path: normalizedPath });
  } catch (err) {
    logger.error(`API /testlab/save-screenshot error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/branch — Create a working branch
 * Body: { localPath: string, branchName: string }
 */
app.post('/api/testlab/branch', async (req, res) => {
  try {
    const { localPath, branchName } = req.body || {};
    if (!localPath || !branchName) {
      return res.status(400).json({ error: 'Missing localPath or branchName' });
    }
    const name = await createBranch(localPath, branchName.replace(/[^a-z0-9\-\/]/gi, '-').slice(0, 100));
    res.json({ branch: name });
  } catch (err) {
    logger.error(`API /testlab/branch error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/testlab/status — Get git status
 * Query: ?localPath=...
 */
app.get('/api/testlab/status', async (req, res) => {
  try {
    const localPath = req.query.localPath;
    if (!localPath) return res.status(400).json({ error: 'Missing localPath' });
    const status = await getStatus(localPath);
    res.json(status);
  } catch (err) {
    logger.error(`API /testlab/status error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/commit — Commit and push changes
 * Body: { localPath: string, message: string, branch?: string }
 */
app.post('/api/testlab/commit', async (req, res) => {
  try {
    const { localPath, message, branch } = req.body || {};
    if (!localPath || !message) {
      return res.status(400).json({ error: 'Missing localPath or message' });
    }
    const result = await commitAndPush(localPath, message.slice(0, 500), branch);
    res.json(result);
  } catch (err) {
    logger.error(`API /testlab/commit error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/pull-request — Create a PR on GitHub
 * Body: { owner, repo, title, body, head, base, token }
 */
app.post('/api/testlab/pull-request', async (req, res) => {
  try {
    const { owner, repo, title, body: prBody, head, base, token } = req.body || {};
    if (!owner || !repo || !title || !head || !base || !token) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const pr = await createPullRequest({
      owner, repo,
      title: title.slice(0, 200),
      body: (prBody || '').slice(0, 5000),
      head, base,
      token: token.slice(0, 200),
    });
    res.json(pr);
  } catch (err) {
    logger.error(`API /testlab/pull-request error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/testlab/diff — Get diff summary
 * Query: ?localPath=...
 */
app.get('/api/testlab/diff', async (req, res) => {
  try {
    const localPath = req.query.localPath;
    if (!localPath) return res.status(400).json({ error: 'Missing localPath' });
    const diff = await getDiffSummary(localPath);
    res.json(diff);
  } catch (err) {
    logger.error(`API /testlab/diff error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testlab/read-file — Read a file from the repo
 * Body: { filePath: string }
 */
app.post('/api/testlab/read-file', (req, res) => {
  try {
    const { filePath } = req.body || {};
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'Missing filePath' });
    }
    const normalizedPath = resolve(filePath);
    if (!normalizedPath.startsWith(REPOS_DIR)) {
      return res.status(403).json({ error: 'Cannot read outside repos directory' });
    }
    if (!existsSync(normalizedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const content = readFileSync(normalizedPath, 'utf-8');
    res.json({ content, filePath: normalizedPath });
  } catch (err) {
    logger.error(`API /testlab/read-file error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Serve screenshots from repos directory (for test lab image previews)
app.use('/repos', express.static(resolve(config.root, 'repos')));

// ─── AI Auto-Record — Vision Analysis ─────────────────────────────────

/**
 * POST /api/ai/analyze — Analyze a screenshot with GPT-4o Vision.
 * Body: { screenshot: base64, interactions?: array, pageUrl?, pageTitle?, clickBox? }
 * Returns: { description, summary, uiElements, confidence, isSignificantAction }
 */
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { screenshot, interactions, pageUrl, pageTitle, clickBox } = req.body || {};
    if (!screenshot || typeof screenshot !== 'string') {
      return res.status(400).json({ error: 'Missing screenshot data' });
    }

    const buffer = Buffer.from(screenshot, 'base64');
    const analysis = await analyzeStep({
      screenshot: buffer,
      interactions: interactions || [],
      pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : '',
      pageTitle: typeof pageTitle === 'string' ? pageTitle.slice(0, 500) : '',
      clickBox: clickBox || null,
    });

    res.json(analysis);
  } catch (err) {
    logger.error(`API /ai/analyze error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ai/capture — Capture a step in AI auto-record mode.
 * Same as /api/desktop/capture but also triggers vision analysis.
 * Body: { screenshot: base64, interactions?: array, clickBox?, pageUrl?, pageTitle?, dpr? }
 * Returns: step object with AI-generated description
 */
app.post('/api/ai/capture', async (req, res) => {
  try {
    const { screenshot, interactions, clickBox, pageUrl, pageTitle, dpr } = req.body || {};
    if (!screenshot || typeof screenshot !== 'string') {
      return res.status(400).json({ error: 'Missing screenshot data' });
    }

    const buffer = Buffer.from(screenshot, 'base64');

    // Run vision analysis and step capture in parallel
    const [analysis, step] = await Promise.all([
      analyzeStep({
        screenshot: buffer,
        interactions: interactions || [],
        pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : '',
        pageTitle: typeof pageTitle === 'string' ? pageTitle.slice(0, 500) : '',
        clickBox: clickBox || null,
      }).catch(err => {
        logger.warn(`Vision analysis failed, using fallback: ${err.message}`);
        return null;
      }),
      addCapturedStep({
        description: '', // Will be updated with AI description
        buffer,
        clickBox: clickBox || null,
        pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 2000) : '',
        pageTitle: typeof pageTitle === 'string' ? pageTitle.slice(0, 500) : '',
        dpr: typeof dpr === 'number' ? dpr : 1,
      }),
    ]);

    // Update step description with AI analysis
    if (analysis && analysis.description) {
      step.description = analysis.summary || analysis.description.slice(0, 200);
      step.aiDescription = analysis.description;
      step.aiSummary = analysis.summary || '';
      step.aiConfidence = analysis.confidence ?? 0.5;
      step.isSignificantAction = analysis.isSignificantAction !== false;
      step.uiElements = analysis.uiElements || [];
      step.suggestedTaskGroup = analysis.suggestedTaskGroup || '';
      step.aiStatus = 'pending'; // pending | approved | rejected
    } else {
      step.aiDescription = '';
      step.aiSummary = '';
      step.aiConfidence = 0;
      step.isSignificantAction = true;
      step.uiElements = [];
      step.suggestedTaskGroup = '';
      step.aiStatus = 'pending';
    }

    res.json(step);
  } catch (err) {
    logger.error(`API /ai/capture error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback — must be AFTER all API routes
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
