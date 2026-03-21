/**
 * DOM helper functions — injected into the browser context via page.evaluate()
 * These help locate elements, detect sidebar, and extract metadata.
 */

/**
 * Find the Azure portal left sidebar and return its bounding rect
 * The sidebar is typically the nav element or a div with specific classes
 */
export async function detectSidebar(page) {
  return page.evaluate(() => {
    // Azure Portal sidebar selectors (ordered by specificity)
    const selectors = [
      '#leftNavContainer',
      '[class*="fxs-sidebar"]',
      '[class*="sidebar-container"]',
      'nav[class*="fxs-portal-nav"]',
      '[class*="fxs-portal-sidebar"]',
      '.fxs-blade-display-in-journey [class*="fxs-sidebar"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 20 && rect.width < 400) {
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, found: true };
        }
      }
    }

    // Fallback: look for narrow left column
    const allNavs = document.querySelectorAll('nav, [role="navigation"]');
    for (const nav of allNavs) {
      const rect = nav.getBoundingClientRect();
      if (rect.x < 10 && rect.width > 40 && rect.width < 350 && rect.height > 400) {
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, found: true };
      }
    }

    return { x: 0, y: 0, width: 0, height: 0, found: false };
  });
}

/**
 * Get a human-readable description of an element for logging
 */
export async function describeElement(handle) {
  return handle.evaluate(el => {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || '').trim().slice(0, 80);
    const role = el.getAttribute('role') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    return `<${tag}${role ? ` role="${role}"` : ''}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}> "${text || title}"`;
  });
}

/**
 * Scroll element into view and wait for it to be stable
 */
export async function scrollIntoViewAndStabilize(page, handle) {
  await handle.scrollIntoViewIfNeeded();
  // Wait for any animations to settle
  await page.waitForTimeout(300);
  // Verify the element is still visible
  await handle.waitForElementState('stable');
}

/**
 * Find the best matching element using multiple strategies
 * Returns the first visible, actionable element that matches
 */
export async function findBestElement(page, action) {
  const strategies = buildSelectionStrategies(action);
  for (const strategy of strategies) {
    try {
      const handle = await strategy(page);
      if (handle) {
        const isVisible = await handle.isVisible();
        if (isVisible) return handle;
      }
    } catch {
      // strategy didn't match, try next
    }
  }
  return null;
}

/**
 * Build ordered list of element location strategies for a given action
 */
function buildSelectionStrategies(action) {
  const { selector, text, role, name } = action;
  const strategies = [];

  // 1. Role-based (most reliable for Azure Portal)
  if (role && name) {
    strategies.push(page => page.getByRole(role, { name, exact: false }).first().elementHandle());
  }

  // 2. Accessible name / aria-label
  if (name && !role) {
    strategies.push(page => page.getByLabel(name, { exact: false }).first().elementHandle());
  }

  // 3. Text-based
  if (text) {
    strategies.push(page => page.getByText(text, { exact: false }).first().elementHandle());
  }

  // 4. CSS selector
  if (selector) {
    strategies.push(async page => {
      const loc = page.locator(selector).first();
      const count = await loc.count();
      return count > 0 ? loc.elementHandle() : null;
    });
  }

  // 5. Title attribute
  if (name) {
    strategies.push(page => page.getByTitle(name, { exact: false }).first().elementHandle());
  }

  // 6. Placeholder
  if (name) {
    strategies.push(page => page.getByPlaceholder(name, { exact: false }).first().elementHandle());
  }

  return strategies;
}

/**
 * Wait for Azure Portal to finish loading (spinner gone, blades rendered)
 */
export async function waitForAzureReady(page, timeoutMs = 30000) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  } catch {
    // May fail during redirects — that's OK, continue
  }

  // Wait for the main progress bar / spinner to disappear
  const spinnerSelectors = [
    '.fxs-portal-loading',
    '.fxs-progress',
    '[class*="loading-indicator"]',
    '.msportalfx-progress',
    '[class*="fxs-loader"]',
  ];

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const spinning = await page.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return true;
        }
        return false;
      }, spinnerSelectors);

      if (!spinning) break;
    } catch {
      // Execution context destroyed during navigation — wait and retry
    }
    await page.waitForTimeout(500);
  }

  // Extra settle time for Azure animations
  await page.waitForTimeout(800);
}
