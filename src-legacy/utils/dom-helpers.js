/**
 * DOM helper — detect Azure Portal sidebar for screenshot cropping.
 */

/**
 * Find the Azure portal left sidebar and return its bounding rect.
 */
export async function detectSidebar(page) {
  return page.evaluate(() => {
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
