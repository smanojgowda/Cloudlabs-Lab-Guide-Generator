/**
 * Browser lifecycle management — launch, context, cleanup
 */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';

let browser = null;
let context = null;
let page = null;

/**
 * Launch browser and create a context.
 * Reuses auth.json if present for Azure login persistence.
 */
export async function launch() {
  // Check if existing browser/page is still alive
  if (browser) {
    try {
      if (page && !page.isClosed()) {
        page.url(); // throws if dead
        return { browser, context, page };
      }
    } catch {
      logger.info('Previous browser session is dead — relaunching...');
      browser = null;
      context = null;
      page = null;
    }
  }

  const hasAuth = existsSync(config.browser.authFile);
  logger.info(`Launching Chromium (auth=${hasAuth})`);

  browser = await chromium.launch({
    headless: false,
    slowMo: config.browser.slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--window-size=${config.browser.viewport.width},${config.browser.viewport.height}`,
    ],
  });

  const contextOptions = {
    viewport: config.browser.viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  };

  if (hasAuth) {
    contextOptions.storageState = config.browser.authFile;
    logger.info('Loaded saved authentication state from auth.json');
  }

  context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(config.browser.defaultTimeout);
  context.setDefaultNavigationTimeout(config.browser.navigationTimeout);

  page = await context.newPage();

  page.on('dialog', async (dialog) => {
    logger.debug(`Browser dialog: ${dialog.type()} — "${dialog.message()}"`);
    await dialog.dismiss().catch(() => {});
  });

  page.on('crash', () => {
    logger.error('Page crashed! The tab renderer process died.');
  });

  return { browser, context, page };
}

/**
 * Save current authentication state for session reuse.
 * are automatically persisted. This is kept for explicit save points.
 */
export async function saveAuth() {
  if (!context) throw new Error('No browser context — call launch() first');
  await context.storageState({ path: config.browser.authFile });
  logger.info(`Auth state saved to ${config.browser.authFile}`);
}

/**
 * Get current page instance
 */
export function getPage() {
  if (!page) throw new Error('No page — call launch() first');
  return page;
}

/**
 * Get current browser context
 */
export function getContext() {
  if (!context) throw new Error('No context — call launch() first');
  return context;
}

/**
 * Close browser and reset handles
 */
export async function close() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    context = null;
    page = null;
    logger.info('Browser closed');
  }
}
