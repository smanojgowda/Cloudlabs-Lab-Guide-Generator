/**
 * Azure Portal authentication — interactive login + state persistence
 */
import { existsSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';
import { launch, saveAuth, getPage } from './browser.js';
import { waitForAzureReady } from '../utils/dom-helpers.js';

const PORTAL_URL = 'https://portal.azure.com';

/**
 * Ensure we have a valid Azure Portal session.
 * If auth.json exists → navigate and verify.
 * If not → open login page and pause for manual login, then save state.
 */
export async function ensureAuthenticated() {
  await launch();
  const page = getPage();

  if (existsSync(config.browser.authFile)) {
    logger.info('Attempting to reuse saved session…');
    try {
      // Use 'commit' to avoid context-destroyed errors during Azure's redirect chain
      await page.goto(PORTAL_URL, { waitUntil: 'commit' });
      // Give the portal/redirect time to settle
      await page.waitForTimeout(5000);

      const isLoggedIn = await checkLoggedIn(page);
      if (isLoggedIn) {
        logger.info('Session restored — already logged in');
        await waitForAzureReady(page);
        return;
      }
    } catch (err) {
      logger.warn(`Session restore navigation failed: ${err.message}`);
    }
    logger.warn('Saved session expired — falling back to interactive login');
  }

  await interactiveLogin(page).catch(async (err) => {
    // One more safety net — if interactiveLogin fails due to a stale context,
    // check if we actually landed on the portal anyway
    logger.warn(`interactiveLogin threw: ${err.message} — checking if portal loaded…`);
    await page.waitForTimeout(3000);
    try {
      const href = page.url().toLowerCase();
      if (href.includes('portal.azure.com') && !href.includes('login.microsoftonline.com')) {
        logger.info('Portal appears loaded despite the error — saving auth');
        await saveAuth();
        return;
      }
    } catch { /* ignore */ }
    throw err;
  });
}

/**
 * Interactive login: navigate to portal, pause for user to complete SSO/MFA,
 * then save storageState for future runs.
 */
async function interactiveLogin(page) {
  logger.info('Opening Azure Portal for interactive login…');
  logger.info('>>> Complete the login in the browser window. The agent will resume automatically. <<<');

  // Use 'commit' — Azure Portal does a client-side JS redirect to login.microsoftonline.com
  // which destroys the execution context if we wait for domcontentloaded
  try {
    await page.goto(PORTAL_URL, { waitUntil: 'commit' });
  } catch (err) {
    // Redirect during navigation is expected — ignore
    logger.debug(`Initial navigation note: ${err.message}`);
  }

  // Poll until the URL shows we're on the Azure Portal (not login page).
  // IMPORTANT: We must first wait to see the login page appear (Azure redirects
  // portal.azure.com → login.microsoftonline.com). Without this, the poll sees
  // "portal.azure.com" in the initial URL and exits immediately before redirect.
  logger.info('Waiting for Azure login page to appear…');
  const loginDeadline = Date.now() + 300_000;
  let sawLoginPage = false;

  // Give Azure time to redirect before checking anything — avoids false "already logged in"
  await page.waitForTimeout(8000);

  while (Date.now() < loginDeadline) {
    try {
      const href = page.url().toLowerCase();

      // Phase 1: Wait until we see the login page (redirect from portal)
      if (!sawLoginPage) {
        if (href.includes('login.microsoftonline.com') || href.includes('login.live.com')) {
          sawLoginPage = true;
          logger.info('Login page detected — complete sign-in (including MFA) in the browser window…');
          logger.info('>>> Waiting up to 5 minutes for you to finish authentication… <<<');
        }
        // Also handle: user was already logged in and portal loaded directly
        // Only trust this AFTER the initial 8s wait above — ensures redirects had time to fire
        if (href.includes('portal.azure.com') && !href.includes('signin')) {
          try {
            // Must see BOTH the avatar menu AND the top toolbar to be sure it's fully loaded
            const hasAvatar = await page.locator('#meControl, [class*="fxs-avatarmenu"]').count();
            const hasTopbar = await page.locator('.fxs-topbar-internal, [class*="fxs-header"]').count();
            if (hasAvatar > 0 && hasTopbar > 0) {
              logger.info('Already logged in — portal loaded directly');
              break;
            }
          } catch { /* context may be gone — ignore */ }
        }
      }

      // Phase 2: After seeing login page, wait for portal URL to return
      // This covers: password entry → MFA → authenticator approval → portal load
      if (sawLoginPage) {
        if (href.includes('portal.azure.com') &&
            !href.includes('login.microsoftonline.com') &&
            !href.includes('login.live.com') &&
            !href.includes('aad_landing')) {
          // Extra check: make sure the portal actually has content, not just a redirect stub
          try {
            const hasContent = await page.locator('#meControl, .fxs-topbar-internal, [class*="fxs-blade"]').count();
            if (hasContent > 0) {
              logger.info('Login complete — portal loaded after authentication');
              break;
            }
          } catch { /* context issue — wait more */ }
        }
      }
    } catch {
      // page.url() can fail during navigation — just retry
    }
    await page.waitForTimeout(2000);
  }

  // Let the portal fully render after login
  await page.waitForTimeout(5000);
  await safeWaitForAzureReady(page);
  await saveAuth();
  logger.info('Login complete — session saved for future runs');
}

/**
 * Wrapper around waitForAzureReady that swallows context-destroyed errors.
 * Used during login flow where navigations can be unpredictable.
 */
async function safeWaitForAzureReady(page) {
  try {
    await waitForAzureReady(page);
  } catch (err) {
    logger.debug(`waitForAzureReady error (safe-ignored): ${err.message}`);
    await page.waitForTimeout(2000);
  }
}

/**
 * Check if the current page state indicates a logged-in Azure Portal session
 */
async function checkLoggedIn(page) {
  try {
    const url = page.url().toLowerCase();
    if (url.includes('login.microsoftonline.com') || url.includes('login.live.com')) {
      return false;
    }
    // Look for portal shell / avatar / directory indicator
    const indicators = [
      '#meControl',
      '[class*="fxs-avatarmenu"]',
      '[class*="fxs-topbar-avatar"]',
      '.fxs-topbar-internal',
    ];
    for (const sel of indicators) {
      const found = await page.locator(sel).count();
      if (found > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Login-only mode — just authenticate and save state, then exit.
 */
export async function loginOnly() {
  await ensureAuthenticated();
  logger.info('Login-only mode complete. auth.json is ready.');
}
