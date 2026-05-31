/**
 * Record Mode — CDP-based event recorder
 *
 * Listens for user interactions (clicks, inputs, navigation) via Chrome DevTools Protocol,
 * captures element metadata (bounding box, tag, text, role, aria-label),
 * and auto-triggers annotated screenshot capture after each interaction.
 */
import { captureAndProcess, captureClean, annotateBuffer } from './screenshot.js';
import logger from '../utils/logger.js';

/** @type {Array<object>} */
let recordedSteps = [];
let stepCounter = 0;
let recording = false;
let cdpSession = null;
let currentPage = null;
let annotationNumber = 0;

/**
 * Start recording user interactions on the given page.
 * Uses CDP to listen for DOM events without interfering with user actions.
 * Also injects a click tracker to record the last-clicked element for annotations.
 *
 * @param {import('playwright').Page} page
 */
export async function startRecording(page) {
  if (recording) {
    logger.warn('Already recording — stop first before starting a new session.');
    return;
  }

  currentPage = page;
  recordedSteps = [];
  stepCounter = 0;
  annotationNumber = 0;

  // Create CDP session for low-level event listening
  try {
    cdpSession = await page.context().newCDPSession(page);

    // Enable DOM and Runtime domains
    await cdpSession.send('DOM.enable');
    await cdpSession.send('Runtime.enable');
    await cdpSession.send('Overlay.enable').catch(() => {});
  } catch (err) {
    cdpSession = null;
    logger.error(`Failed to initialize CDP session: ${err.message}`);
    throw err;
  }

  recording = true;

  // Click tracker code — shared between addInitScript and immediate inject
  const CLICK_TRACKER_CODE = `
    window.__buildCssSelector = function(el) {
      const tag = el.tagName.toLowerCase();
      const aria = el.getAttribute('aria-label');
      if (aria && aria.length < 100) return tag + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
      const testId = el.getAttribute('data-testid');
      if (testId) return tag + '[data-testid="' + testId + '"]';
      const ph = el.getAttribute('placeholder');
      if (ph && ph.length < 100) return tag + '[placeholder="' + ph.replace(/"/g, '\\\\"') + '"]';
      const role = el.getAttribute('role');
      const visText = (el.innerText || el.textContent || '').trim().split('\\n')[0].slice(0, 50);
      if (role && visText && visText.length < 40) return tag + '[role="' + role + '"]';
      if (el.name) return tag + '[name="' + el.name + '"]';
      if (el.id && !/^(_weave_e_|form-label-id-|ember|__)/i.test(el.id)) return '#' + el.id;
      const cls = Array.from(el.classList || []).filter(c => !c.match(/^(x-|_|ember|azc-br-|_wv_|fxc-has-)/)).slice(0, 2).join('.');
      if (cls && cls.length > 3) return tag + '.' + cls;
      return tag;
    };
    window.__findInteractive = function(el) {
      const interactive = el.closest('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="link"], [role="option"], input, select, textarea, [role="combobox"], [role="textbox"], [role="radio"], [role="checkbox"]');
      if (interactive && interactive !== document.body) return interactive;
      const tag = el.tagName.toLowerCase();
      if (['button','a','input','select','textarea'].includes(tag)) return el;
      let cur = el;
      for (let i = 0; i < 5; i++) {
        if (!cur || cur === document.body) break;
        if (cur.getAttribute('aria-label') || cur.getAttribute('role')) return cur;
        cur = cur.parentElement;
      }
      return el;
    };
    window.__lastClickedElements = [];
    document.addEventListener('click', (e) => {
      const raw = e.target.closest('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="link"], input, select, textarea, [data-testid], .fxs-blade-title-titleText, .azc-toolbarButton, .ms-Button') || e.target;
      const el = window.__findInteractive(raw);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const parentEl = el.parentElement;
        const visText = (el.innerText || el.textContent || '').trim().split('\\n')[0].slice(0, 80);
        window.__lastClickedElements.push({
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          tag: el.tagName.toLowerCase(),
          text: visText,
          ariaLabel: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          id: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          className: (el.className || '').toString().slice(0, 200),
          href: el.getAttribute('href') || '',
          title: el.getAttribute('title') || '',
          name: el.getAttribute('name') || '',
          dataTestId: el.getAttribute('data-testid') || '',
          type: el.getAttribute('type') || '',
          cssSelector: window.__buildCssSelector(el),
          parentText: parentEl ? (parentEl.textContent || '').trim().split('\\n')[0].slice(0, 60) : '',
        });
        if (window.__lastClickedElements.length > 10) window.__lastClickedElements.shift();
      }
    }, true);
  `;

  // Inject click tracker — persists across navigations via addInitScript
  await page.addInitScript(CLICK_TRACKER_CODE);

  // Also inject immediately for the current page
  await page.evaluate(CLICK_TRACKER_CODE).catch(() => {});

  logger.info('Recording started — click tracking active.');
}

/**
 * Manually capture the current screen state as a step.
 * Automatically highlights the last-clicked element with a red outline box.
 *
 * @param {string} [description] - optional description of what the user just did
 * @returns {Promise<object>} - the recorded step
 */
export async function captureStep(description = '') {
  if (!recording || !currentPage) {
    throw new Error('Not recording — call startRecording() first.');
  }

  stepCounter++;
  annotationNumber++;
  const filename = `step-${String(stepCounter).padStart(2, '0')}.png`;

  // Get the last-clicked element's bounding box for annotation
  let annotations = null;
  let lastClicked = null;
  try {
    lastClicked = await currentPage.evaluate(() => {
      const arr = window.__lastClickedElements;
      if (!arr || arr.length === 0) return null;
      // Pop the last clicked element (consume it)
      return arr.pop();
    });

    if (lastClicked && lastClicked.width > 0 && lastClicked.height > 0) {
      annotations = [{
        boundingBox: {
          x: lastClicked.x,
          y: lastClicked.y,
          width: lastClicked.width,
          height: lastClicked.height,
        },
        number: annotationNumber,
      }];
      logger.debug(`Auto-annotating: ${lastClicked.tag} "${lastClicked.text}" at (${lastClicked.x},${lastClicked.y})`);
    }
  } catch {
    // Page might have navigated — no annotation
  }

  let screenshot;
  try {
    // Always capture clean screenshot — no red box or step number overlays
    screenshot = await captureClean(currentPage, filename);
  } catch (err) {
    logger.error(`Screenshot capture failed: ${err.message}`);
    throw err;
  }

  const pageUrl = currentPage.url();
  const pageTitle = await currentPage.title().catch(() => '');

  // Build rich annotation data from click tracker
  let stepAnnotations = [];
  if (lastClicked && annotations) {
    stepAnnotations = [{
      number: annotationNumber,
      action: 'click',
      target: {
        cssSelector: lastClicked.cssSelector || '',
        text: lastClicked.text || '',
        ariaLabel: lastClicked.ariaLabel || '',
        role: lastClicked.role || '',
        tagName: lastClicked.tag || '',
        id: lastClicked.id || '',
        className: lastClicked.className || '',
        dataTestId: lastClicked.dataTestId || '',
        placeholder: lastClicked.placeholder || '',
        title: lastClicked.title || '',
        href: lastClicked.href || '',
        name: lastClicked.name || '',
        type: lastClicked.type || '',
        parentText: lastClicked.parentText || '',
      },
      boundingBox: { x: lastClicked.x, y: lastClicked.y, width: lastClicked.width, height: lastClicked.height },
    }];
  }

  const step = {
    stepNumber: stepCounter,
    description: description || `Step ${stepCounter}`,
    screenshotFilename: filename,
    screenshotPath: screenshot.path,
    screenshotRelative: screenshot.relativePath,
    pageUrl,
    pageTitle,
    annotations: stepAnnotations,
    timestamp: new Date().toISOString(),
  };

  recordedSteps.push(step);
  logger.info(`Step ${stepCounter} captured: ${filename} ${annotations ? '(with red box)' : '(clean)'} — "${description || 'no description'}"`);
  return step;
}

/**
 * Capture a step with annotated highlights on specific elements.
 * The caller provides element selectors/descriptions to highlight.
 *
 * @param {string} description - what this step does
 * @param {Array<{selector?: string, text?: string, x?: number, y?: number}>} highlights
 *   Elements to annotate. Each can be a CSS selector, text match, or viewport coordinates.
 * @returns {Promise<object>} - the recorded step
 */
export async function captureAnnotatedStep(description, highlights = []) {
  if (!recording || !currentPage) {
    throw new Error('Not recording — call startRecording() first.');
  }

  stepCounter++;
  const filename = `step-${String(stepCounter).padStart(2, '0')}.png`;

  // Resolve highlights to bounding boxes
  const annotations = [];
  let num = 0;
  for (const hl of highlights) {
    num++;
    try {
      let box = null;
      if (hl.selector) {
        const el = currentPage.locator(hl.selector).first();
        if (await el.count() > 0) {
          box = await el.boundingBox();
        }
      } else if (hl.text) {
        const el = currentPage.getByText(hl.text, { exact: false }).first();
        if (await el.count() > 0) {
          box = await el.boundingBox();
        }
      } else if (hl.x != null && hl.y != null) {
        // Point-based: create a small box around the click point
        box = { x: hl.x - 15, y: hl.y - 15, width: 30, height: 30 };
      }
      if (box) {
        annotations.push({ boundingBox: box, number: num });
      }
    } catch (err) {
      logger.debug(`Could not resolve highlight ${num}: ${err.message}`);
    }
  }

  let screenshot;
  try {
    // Always capture clean screenshot — no red box or step number overlays
    screenshot = await captureClean(currentPage, filename);
  } catch (err) {
    logger.error(`Screenshot capture failed: ${err.message}`);
    throw err;
  }

  const pageUrl = currentPage.url();
  const pageTitle = await currentPage.title().catch(() => '');

  const step = {
    stepNumber: stepCounter,
    description,
    screenshotFilename: filename,
    screenshotPath: screenshot.path,
    screenshotRelative: screenshot.relativePath,
    pageUrl,
    pageTitle,
    annotations: highlights.map((hl, i) => ({
      number: i + 1,
      selector: hl.selector || null,
      text: hl.text || null,
      label: hl.label || null,
    })),
    timestamp: new Date().toISOString(),
  };

  recordedSteps.push(step);
  logger.info(`Step ${stepCounter} captured with ${annotations.length} annotations: ${filename}`);
  return step;
}

/**
 * Capture element info at a specific viewport coordinate (from user click in overlay).
 * Used by the frontend to record what the user clicked.
 *
 * @param {number} x - viewport X coordinate
 * @param {number} y - viewport Y coordinate
 * @returns {Promise<object|null>} - element metadata or null
 */
export async function getElementAtPoint(x, y) {
  if (!currentPage) return null;

  try {
    const info = await currentPage.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 120),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        id: el.id || '',
        className: (el.className || '').toString().slice(0, 200),
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }, { px: x, py: y });
    return info;
  } catch {
    return null;
  }
}

/**
 * Stop recording and return all captured steps.
 * @returns {Array<object>}
 */
export function stopRecording() {
  if (!recording) {
    logger.warn('Not currently recording.');
    return recordedSteps;
  }

  recording = false;

  // Clean up CDP session
  if (cdpSession) {
    cdpSession.detach().catch(() => {});
    cdpSession = null;
  }

  logger.info(`Recording stopped. ${recordedSteps.length} steps captured.`);
  return recordedSteps;
}

/**
 * Get all recorded steps so far (without stopping).
 * @returns {Array<object>}
 */
export function getSteps() {
  return [...recordedSteps];
}

/**
 * Get recording status.
 */
export function isRecording() {
  return recording;
}

/**
 * Get current step count.
 */
export function getStepCount() {
  return stepCounter;
}

/**
 * Delete a specific step by number.
 * @param {number} stepNum
 */
export function deleteStep(stepNum) {
  const idx = recordedSteps.findIndex(s => s.stepNumber === stepNum);
  if (idx >= 0) {
    recordedSteps.splice(idx, 1);
    logger.info(`Step ${stepNum} deleted.`);
  }
}

/**
 * Update description for a specific step.
 * @param {number} stepNum
 * @param {string} newDescription
 */
export function updateStepDescription(stepNum, newDescription) {
  const step = recordedSteps.find(s => s.stepNumber === stepNum);
  if (step) {
    step.description = newDescription;
    logger.info(`Step ${stepNum} description updated.`);
  }
}

/**
 * Reset the recorder completely.
 */
export function resetRecorder() {
  stopRecording();
  recordedSteps = [];
  stepCounter = 0;
  annotationNumber = 0;
  currentPage = null;
  logger.info('Recorder reset.');
}

// ─── Desktop Mode Functions ───────────────────────────────────────────

/**
 * Start recording in desktop mode (no Playwright page — Electron handles the browser).
 */
export function startDesktopRecording() {
  if (recording) return;
  recordedSteps = [];
  stepCounter = 0;
  annotationNumber = 0;
  recording = true;
  currentPage = null;
  logger.info('Desktop recording started — click tracking handled by Electron.');
}

/**
 * Add a captured step from Electron desktop mode.
 * Receives a pre-captured screenshot buffer and optional click annotation data.
 *
 * @param {object} opts
 * @param {string} opts.description - step description
 * @param {Buffer} opts.buffer - raw PNG screenshot buffer
 * @param {object|null} opts.clickBox - { x, y, width, height } in CSS pixels
 * @param {string} opts.pageUrl
 * @param {string} opts.pageTitle
 * @param {number} opts.dpr - device pixel ratio for coordinate scaling
 * @returns {Promise<object>} the recorded step
 */
export async function addCapturedStep({ description, buffer, clickBox, clickBoxes, pageUrl, pageTitle, dpr }) {
  if (!recording) throw new Error('Not recording — start a session first.');

  stepCounter++;
  const filename = `step-${String(stepCounter).padStart(2, '0')}.png`;

  // Build annotations from all tracked clicks (clickBoxes), falling back to single clickBox
  let annotations = null;
  let stepAnnotations = [];
  const scale = dpr || 1;
  const boxes = (Array.isArray(clickBoxes) && clickBoxes.length > 0)
    ? clickBoxes
    : (clickBox && clickBox.width > 0 && clickBox.height > 0 ? [clickBox] : []);

  if (boxes.length > 0) {
    annotations = [];
    stepAnnotations = [];
    boxes.forEach((box, idx) => {
      if (!box || !box.width || !box.height) return;
      const annotNum = idx + 1;
      annotations.push({
        boundingBox: {
          x: box.x * scale,
          y: box.y * scale,
          width: box.width * scale,
          height: box.height * scale,
        },
        number: annotNum,
      });
      stepAnnotations.push({
        number: annotNum,
        action: 'click',
        target: {
          cssSelector: box.cssSelector || '',
          text: box.text || '',
          ariaLabel: box.ariaLabel || '',
          role: box.role || '',
          tagName: box.tag || '',
          id: box.id || '',
          className: box.className || '',
          dataTestId: box.dataTestId || '',
          placeholder: box.placeholder || '',
          title: box.title || '',
          href: box.href || '',
          name: box.name || '',
          type: box.type || '',
          parentText: box.parentText || '',
        },
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    });
  }

  // Save clean screenshot — no red box or step number overlays
  const screenshot = await annotateBuffer(buffer, null, filename);

  const step = {
    stepNumber: stepCounter,
    description: description || `Step ${stepCounter}`,
    screenshotFilename: filename,
    screenshotPath: screenshot.path,
    screenshotRelative: screenshot.relativePath,
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    annotations: stepAnnotations,
    timestamp: new Date().toISOString(),
  };

  recordedSteps.push(step);
  logger.info(`Step ${stepCounter} captured: ${filename}${annotations ? ' (annotated)' : ' (clean)'} — "${description || 'no description'}"`);
  return step;
}
