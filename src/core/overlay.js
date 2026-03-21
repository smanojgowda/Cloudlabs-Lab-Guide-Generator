/**
 * In-browser recording overlay — injected into the Playwright-controlled page.
 *
 * Adds a floating panel to the Azure Portal page so the user can:
 * - Type step descriptions
 * - Click "Capture" to screenshot the current state
 * - See step count & status
 * - Click "Generate Guide" when done
 *
 * Communicates with our Express server via fetch to localhost.
 */
import logger from '../utils/logger.js';

/**
 * Inject the recording overlay into the page.
 * Uses addInitScript so it re-injects on every navigation.
 *
 * @param {import('playwright').Page} page
 * @param {number} serverPort - the port our Express server is running on
 */
export async function injectOverlay(page, serverPort) {
  const overlayScript = buildOverlayScript(serverPort);

  // addInitScript re-runs on every navigation/reload
  await page.addInitScript(overlayScript);

  // Also inject immediately for the current page
  try {
    await page.evaluate(overlayScript);
  } catch {
    // Page might not be ready yet — the initScript will handle it
  }

  logger.info('Recording overlay injected into browser page.');
}

/**
 * Build the overlay JavaScript as a string to inject into the page.
 */
function buildOverlayScript(port) {
  return `(() => {
  // Prevent double injection
  if (document.getElementById('lg-recorder-overlay')) return;

  const API = 'http://localhost:${port}/api';

  // ── Create overlay container ──
  const overlay = document.createElement('div');
  overlay.id = 'lg-recorder-overlay';
  overlay.innerHTML = \`
    <div id="lg-panel" style="
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      width: 380px; background: #1a1a2e; border: 2px solid #22d3ee;
      border-radius: 12px; font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e2e8f0; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      transition: all 0.3s ease; overflow: hidden;
    ">
      <!-- Header -->
      <div id="lg-header" style="
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; background: linear-gradient(135deg, #0f172a, #1e1b4b);
        cursor: move; user-select: none; border-bottom: 1px solid #334155;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <div id="lg-rec-dot" style="width:10px;height:10px;border-radius:50%;background:#ef4444;animation:lg-pulse 1.5s infinite;"></div>
          <span style="font-size:13px;font-weight:700;color:#22d3ee;">Lab Recorder</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span id="lg-step-badge" style="
            background:rgba(34,211,238,0.2);color:#22d3ee;padding:2px 8px;
            border-radius:10px;font-size:11px;font-weight:600;
          ">0 steps</span>
          <button id="lg-minimize-btn" style="
            background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:2px 4px;
          " title="Minimize">_</button>
        </div>
      </div>

      <!-- Body -->
      <div id="lg-body" style="padding: 12px 14px;">
        <!-- Description input -->
        <textarea id="lg-desc" placeholder="What did you just do? (e.g., Clicked 'Create a resource')"
          style="
            width:100%;height:52px;padding:8px 10px;background:#0f1729;border:1px solid #334155;
            border-radius:6px;color:#e2e8f0;font-family:inherit;font-size:13px;resize:vertical;
            outline:none;
          "></textarea>

        <!-- Buttons row -->
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="lg-capture-btn" style="
            flex:1;padding:8px;background:#22d3ee;color:#000;border:none;border-radius:6px;
            font-weight:700;font-size:13px;cursor:pointer;transition:background 0.2s;
          ">📸 Capture Step</button>
          <button id="lg-generate-btn" style="
            padding:8px 12px;background:#22c55e;color:#fff;border:none;border-radius:6px;
            font-weight:700;font-size:13px;cursor:pointer;transition:background 0.2s;
          ">✓ Generate</button>
        </div>

        <!-- Status -->
        <div id="lg-status" style="
          margin-top:8px;font-size:11px;color:#94a3b8;text-align:center;
          min-height:16px;transition:color 0.3s;
        "></div>

        <!-- Last capture thumbnail -->
        <div id="lg-thumb-row" style="display:none;margin-top:8px;text-align:center;">
          <img id="lg-thumb" style="max-width:100%;max-height:80px;border-radius:4px;border:1px solid #334155;">
        </div>
      </div>
    </div>
  \`;

  document.body.appendChild(overlay);

  // ── Styles ──
  const style = document.createElement('style');
  style.textContent = \`
    @keyframes lg-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
    #lg-desc:focus { border-color: #22d3ee !important; }
    #lg-capture-btn:hover { background: #06b6d4 !important; }
    #lg-generate-btn:hover { background: #16a34a !important; }
    #lg-minimize-btn:hover { color: #e2e8f0 !important; }
  \`;
  document.head.appendChild(style);

  // ── References ──
  const panel = document.getElementById('lg-panel');
  const header = document.getElementById('lg-header');
  const body = document.getElementById('lg-body');
  const desc = document.getElementById('lg-desc');
  const captureBtn = document.getElementById('lg-capture-btn');
  const generateBtn = document.getElementById('lg-generate-btn');
  const status = document.getElementById('lg-status');
  const stepBadge = document.getElementById('lg-step-badge');
  const minimizeBtn = document.getElementById('lg-minimize-btn');
  const thumbRow = document.getElementById('lg-thumb-row');
  const thumb = document.getElementById('lg-thumb');

  let minimized = false;
  let stepCount = 0;

  // ── Minimize / expand ──
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    minimized = !minimized;
    body.style.display = minimized ? 'none' : 'block';
    minimizeBtn.textContent = minimized ? '□' : '_';
    panel.style.width = minimized ? '200px' : '380px';
  });

  // ── Dragging ──
  let isDragging = false, dragX = 0, dragY = 0;
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragX) + 'px';
    panel.style.top = (e.clientY - dragY) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  // ── Capture ──
  captureBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const description = desc.value.trim();

    // Temporarily hide overlay for clean screenshot
    overlay.style.display = 'none';

    captureBtn.disabled = true;
    captureBtn.textContent = '⏳ Capturing...';
    status.textContent = '';
    status.style.color = '#94a3b8';

    try {
      const res = await fetch(API + '/session/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description || undefined }),
      });
      const step = await res.json();

      if (step.error) {
        status.textContent = 'Error: ' + step.error;
        status.style.color = '#ef4444';
      } else {
        stepCount = step.stepNumber;
        stepBadge.textContent = stepCount + ' step' + (stepCount !== 1 ? 's' : '');
        status.textContent = 'Step ' + step.stepNumber + ' captured!';
        status.style.color = '#22c55e';
        desc.value = '';

        // Show thumbnail
        if (step.screenshotFilename) {
          thumb.src = 'http://localhost:${port}/screenshots/' + step.screenshotFilename + '?t=' + Date.now();
          thumbRow.style.display = 'block';
        }
      }
    } catch (err) {
      status.textContent = 'Failed: ' + err.message;
      status.style.color = '#ef4444';
    } finally {
      // Show overlay again
      overlay.style.display = 'block';
      captureBtn.disabled = false;
      captureBtn.textContent = '📸 Capture Step';
    }
  });

  // ── Generate ──
  generateBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (stepCount === 0) {
      status.textContent = 'Capture at least one step first!';
      status.style.color = '#f59e0b';
      return;
    }
    if (!confirm('Stop recording and generate the lab guide?')) return;

    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Generating...';
    status.textContent = 'Generating guide with AI... this may take a moment.';
    status.style.color = '#f59e0b';

    try {
      const res = await fetch(API + '/session/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.error) {
        status.textContent = 'Error: ' + data.error;
        status.style.color = '#ef4444';
        generateBtn.disabled = false;
        generateBtn.textContent = '✓ Generate';
      } else {
        status.textContent = 'Guide generated! (' + data.stepsCount + ' steps) Check the web UI.';
        status.style.color = '#22c55e';
        generateBtn.textContent = '✓ Done!';

        // Change rec dot to green
        document.getElementById('lg-rec-dot').style.background = '#22c55e';
        document.getElementById('lg-rec-dot').style.animation = 'none';
      }
    } catch (err) {
      status.textContent = 'Failed: ' + err.message;
      status.style.color = '#ef4444';
      generateBtn.disabled = false;
      generateBtn.textContent = '✓ Generate';
    }
  });

  // ── Keyboard shortcut: Ctrl+Shift+C to capture ──
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      captureBtn.click();
    }
  });

  // ── Load initial step count ──
  fetch(API + '/session').then(r => r.json()).then(data => {
    if (data.stepCount) {
      stepCount = data.stepCount;
      stepBadge.textContent = stepCount + ' step' + (stepCount !== 1 ? 's' : '');
    }
  }).catch(() => {});

})();`;
}
