/**
 * Azure Portal Navigator — execute actions (click, type, navigate, select)
 * with retry logic, fallback selectors, and dynamic UI handling.
 */
import logger from '../utils/logger.js';
import { retry } from '../utils/retry.js';
import {
  findBestElement,
  scrollIntoViewAndStabilize,
  waitForAzureReady,
  describeElement,
} from '../utils/dom-helpers.js';

const PORTAL_URL = 'https://portal.azure.com';

/**
 * Action types the navigator can perform
 * @typedef {'navigate'|'click'|'type'|'select'|'wait'|'scroll'|'url'} ActionType
 */

/**
 * Execute a single action on the Azure Portal page
 *
 * @param {import('playwright').Page} page
 * @param {object} action
 * @param {ActionType} action.type - what to do
 * @param {string} [action.selector] - CSS selector
 * @param {string} [action.role] - ARIA role (button, link, menuitem, etc.)
 * @param {string} [action.name] - accessible name / label for role
 * @param {string} [action.text] - visible text to find
 * @param {string} [action.value] - value for type/select actions
 * @param {string} [action.url] - URL for navigate actions
 * @param {string} [action.description] - human-readable description of this step
 * @returns {Promise<{boundingBox: object|null, description: string}>}
 */
export async function executeAction(page, action) {
  return retry(
    async (attempt) => {
      logger.info(`Executing action [${action.type}]: ${action.description || ''} (attempt ${attempt})`);

      switch (action.type) {
        case 'url':
        case 'navigate':
          return await doNavigate(page, action);
        case 'click':
          return await doClick(page, action);
        case 'type':
          return await doType(page, action);
        case 'select':
          return await doSelect(page, action);
        case 'wait':
          return await doWait(page, action);
        case 'scroll':
          return await doScroll(page, action);
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    },
    { retries: 3, delayMs: 2000, label: `action:${action.type}:${action.description || ''}` }
  );
}

// ─── Action Implementations ───────────────────────────────────────────

async function doNavigate(page, action) {
  const target = action.url || action.value;
  if (!target) throw new Error('Navigate action requires url or value');

  // If it's a portal resource path (not full URL), prepend portal base
  const url = target.startsWith('http') ? target : `${PORTAL_URL}/#${target}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForAzureReady(page);

  return { boundingBox: null, description: `Navigated to ${url}` };
}

async function doClick(page, action) {
  const handle = await locateElement(page, action);
  const desc = await describeElement(handle);
  await scrollIntoViewAndStabilize(page, handle);

  const box = await handle.boundingBox();
  if (!box) throw new Error(`Element has no bounding box: ${desc}`);

  logger.debug(`Clicking element at (${box.x + box.width / 2}, ${box.y + box.height / 2}): ${desc}`);
  await handle.click({ force: false, timeout: 10_000 });

  // Wait for any navigation / loading triggered by the click
  await waitForAzureReady(page);

  return { boundingBox: box, description: `Clicked ${desc}` };
}

async function doType(page, action) {
  const handle = await locateElement(page, action);
  const desc = await describeElement(handle);
  await scrollIntoViewAndStabilize(page, handle);

  const box = await handle.boundingBox();

  // Clear existing content first
  await handle.click({ clickCount: 3 });
  await handle.press('Backspace');
  await handle.type(action.value || '', { delay: 40 });

  await page.waitForTimeout(500);
  return { boundingBox: box, description: `Typed "${action.value}" into ${desc}` };
}

async function doSelect(page, action) {
  // For dropdowns: click to open, then click the option
  const dropdownHandle = await locateElement(page, action);
  const desc = await describeElement(dropdownHandle);
  await scrollIntoViewAndStabilize(page, dropdownHandle);
  const box = await dropdownHandle.boundingBox();

  await dropdownHandle.click();
  await page.waitForTimeout(500);

  // Now find and click the option
  if (action.value) {
    const optionHandle = await findBestElement(page, {
      text: action.value,
      role: 'option',
      name: action.value,
    });
    if (optionHandle) {
      await optionHandle.click();
    } else {
      // Fallback: click by text anywhere in the dropdown overlay
      await page.getByText(action.value, { exact: false }).first().click();
    }
    await waitForAzureReady(page);
  }

  return { boundingBox: box, description: `Selected "${action.value}" from ${desc}` };
}

async function doWait(page, action) {
  const ms = parseInt(action.value || '3000', 10);
  logger.info(`Waiting ${ms}ms…`);
  await page.waitForTimeout(ms);
  await waitForAzureReady(page);
  return { boundingBox: null, description: `Waited ${ms}ms` };
}

async function doScroll(page, action) {
  if (action.selector || action.text || action.role) {
    const handle = await locateElement(page, action);
    await scrollIntoViewAndStabilize(page, handle);
    const box = await handle.boundingBox();
    return { boundingBox: box, description: `Scrolled to element` };
  }
  // Scroll the page by a fixed amount
  await page.mouse.wheel(0, parseInt(action.value || '500', 10));
  await page.waitForTimeout(500);
  return { boundingBox: null, description: `Scrolled page by ${action.value || 500}px` };
}

// ─── Element Location ─────────────────────────────────────────────────

/**
 * Locate an element using multi-strategy approach.
 * Throws if not found after all strategies exhausted.
 */
async function locateElement(page, action) {
  const handle = await findBestElement(page, action);
  if (!handle) {
    const hint = action.text || action.name || action.selector || '(no hint)';
    throw new Error(
      `Element not found for action "${action.description || action.type}". ` +
      `Tried: role=${action.role}, name=${action.name}, text=${action.text}, selector=${action.selector}. ` +
      `Hint: ${hint}`
    );
  }
  return handle;
}

/**
 * Resolve highlight descriptors to bounding boxes for screenshot annotations.
 * Each highlight is: { number, role, name, text, selector }
 * Returns: Array<{ boundingBox: {x,y,width,height}|null, number: int }>
 *
 * @param {import('playwright').Page} page
 * @param {Array<object>} highlights
 * @returns {Promise<Array<{boundingBox: object|null, number: number}>>}
 */
export async function resolveHighlights(page, highlights) {
  if (!highlights || highlights.length === 0) return [];

  const results = [];
  for (const hl of highlights) {
    try {
      const handle = await findBestElement(page, hl);
      if (handle) {
        const box = await handle.boundingBox();
        results.push({ boundingBox: box, number: hl.number });
      } else {
        logger.debug(`Highlight element not found: number=${hl.number}, name=${hl.name || hl.text}`);
        results.push({ boundingBox: null, number: hl.number });
      }
    } catch {
      results.push({ boundingBox: null, number: hl.number });
    }
  }
  return results.filter(r => r.boundingBox !== null);
}
