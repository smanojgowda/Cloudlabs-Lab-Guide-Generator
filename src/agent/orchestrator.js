/**
 * Session Manager — orchestrates Record Mode sessions.
 *
 * Record Mode pipeline:
 *   1. Launch browser, navigate to Azure Portal
 *   2. User performs actions manually
 *   3. User captures steps (screenshots + descriptions) via web UI or CLI
 *   4. When done, LLM generates CloudLabs-format Markdown lab guide from recorded steps
 */
import { launch, getPage, getContext, saveAuth, close } from '../core/browser.js';
import {
  startRecording, stopRecording, captureStep, captureAnnotatedStep,
  getSteps, isRecording, getStepCount, deleteStep, updateStepDescription,
  resetRecorder, startDesktopRecording, addCapturedStep,
} from '../core/recorder.js';
import { captureClean } from '../core/screenshot.js';
import { buildGuide } from '../services/guide-builder.js';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Check if the page/browser is still usable
 */
function isPageAlive(page) {
  try {
    if (!page) return false;
    if (page.isClosed()) return false;
    page.url();
    return true;
  } catch {
    return false;
  }
}

// ─── Session state ────────────────────────────────────────────────────
let sessionActive = false;
let labTitle = '';
let labDescription = '';

/**
 * Start a recording session — launch browser, navigate to portal, begin recording.
 *
 * @param {object} opts
 * @param {string} [opts.url] - starting URL (default: Azure Portal)
 * @param {string} [opts.title] - lab title
 * @param {string} [opts.description] - lab description
 * @returns {Promise<{status: string}>}
 */
export async function startSession(opts = {}) {
  if (sessionActive) {
    logger.warn('Session already active. Stop it first.');
    return { status: 'already-active' };
  }

  labTitle = opts.title || '';
  labDescription = opts.description || '';

  // Reset recorder state from any previous session
  resetRecorder();

  // Desktop mode — browser is managed by Electron, skip Playwright launch
  if (process.env.DESKTOP_MODE === 'true') {
    startDesktopRecording();
    sessionActive = true;
    logger.info('Desktop session started — Electron manages the browser.');
    return { status: 'started' };
  }

  // Launch browser (will relaunch if previous one died)
  const { page } = await launch();
  const startUrl = opts.url || 'https://portal.azure.com';

  logger.info(`═══ Recording Session: Navigating to ${startUrl} ═══`);
  await page.goto(startUrl, { waitUntil: 'commit' });

  // Wait for page to stabilize
  await page.waitForTimeout(3000);

  // Start the recorder
  await startRecording(page);
  sessionActive = true;

  logger.info('Session started. Capture steps from the web UI.');
  return { status: 'started' };
}

/**
 * Capture the current screen as a step.
 *
 * @param {string} [description] - what the user just did
 * @param {Array} [highlights] - elements to annotate
 * @returns {Promise<object>} - the captured step
 */
export async function recordStep(description, highlights) {
  if (!sessionActive) throw new Error('No active session. Start one first.');

  if (highlights && highlights.length > 0) {
    return captureAnnotatedStep(description, highlights);
  }
  return captureStep(description);
}

/**
 * Get current session status and all recorded steps.
 */
export function getSessionStatus() {
  return {
    active: sessionActive,
    recording: isRecording(),
    stepCount: getStepCount(),
    steps: getSteps(),
    labTitle,
    labDescription,
  };
}

/**
 * Remove a recorded step.
 */
export function removeStep(stepNum) {
  deleteStep(stepNum);
}

/**
 * Update a step's description.
 */
export function editStep(stepNum, newDescription) {
  updateStepDescription(stepNum, newDescription);
}

/**
 * Stop recording and generate the lab guide.
 *
 * @param {object} [opts]
 * @param {string} [opts.guideName] - output folder name
 * @param {string} [opts.title] - override lab title
 * @param {string} [opts.description] - override lab description
 * @returns {Promise<{markdownPath: string, markdown: string, guideDir: string, steps: Array}>}
 */
export async function stopAndGenerate(opts = {}) {
  if (!sessionActive) throw new Error('No active session.');

  const steps = stopRecording();
  sessionActive = false;

  if (steps.length === 0) {
    throw new Error('No steps recorded. Nothing to generate.');
  }

  const title = opts.title || labTitle || 'Lab Guide';
  const description = opts.description || labDescription || '';

  logger.info(`═══ Generating Guide: "${title}" (${steps.length} steps) ═══`);

  const result = await buildGuide(steps, title, description, opts.guideName);

  // Save auth for next session
  try { await saveAuth(); } catch { /* ok */ }

  logger.info(`═══ Guide Complete: ${result.markdownPath} ═══`);

  return {
    ...result,
    steps,
  };
}

/**
 * Stop session without generating guide.
 */
export function cancelSession() {
  if (sessionActive) {
    stopRecording();
    sessionActive = false;
    logger.info('Session cancelled without generating guide.');
  }
}

/**
 * Close the browser.
 */
export async function closeBrowser() {
  cancelSession();
  resetRecorder();
  if (process.env.DESKTOP_MODE !== 'true') {
    await close();
  }
}

// Re-export for server.js desktop capture endpoint
export { addCapturedStep } from '../core/recorder.js';
