/**
 * Lab Guide Recorder — Side Panel logic
 *
 * Communicates with the Express server to capture steps,
 * manage the recording session, and trigger guide generation.
 */

let API = '';
let stepCount = 0;
let editingStepNum = null;
let pollInterval = null;
let connected = false;

// ── DOM refs ──
const recDot = document.getElementById('recDot');
const stepBadge = document.getElementById('stepBadge');
const captureSection = document.getElementById('captureSection');
const stepDesc = document.getElementById('stepDesc');
const captureBtn = document.getElementById('captureBtn');
const status = document.getElementById('status');
const stepsList = document.getElementById('stepsList');
const generateBtn = document.getElementById('generateBtn');
const cancelBtn = document.getElementById('cancelBtn');
const notConnected = document.getElementById('notConnected');
const editModal = document.getElementById('editModal');
const editInput = document.getElementById('editInput');
const editSave = document.getElementById('editSave');
const editCancel = document.getElementById('editCancel');
const imgPreview = document.getElementById('imgPreview');
const imgPreviewSrc = document.getElementById('imgPreviewSrc');

// ── Initialize ──
async function init() {
  try {
    const resp = await fetch(chrome.runtime.getURL('config.json'));
    const cfg = await resp.json();
    API = `http://localhost:${cfg.port}/api`;
  } catch {
    // Fallback to default
    API = 'http://localhost:9005/api';
  }

  // Check connection
  await checkConnection();

  // Start polling for session state
  startPolling();
}

async function checkConnection() {
  try {
    const resp = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    if (data.status === 'ok') {
      connected = true;
      notConnected.style.display = 'none';
      captureSection.style.display = 'block';
      return;
    }
  } catch {
    // Not connected
  }
  connected = false;
  notConnected.style.display = 'block';
}

// ── API helpers ──
async function apiCall(path, opts = {}) {
  const resp = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return resp.json();
}

// ── Capture ──
captureBtn.addEventListener('click', async () => {
  const description = stepDesc.value.trim();
  captureBtn.disabled = true;
  captureBtn.textContent = '⏳ Capturing...';
  setStatus('');

  try {
    const step = await apiCall('/session/capture', {
      method: 'POST',
      body: { description: description || undefined },
    });

    if (step.error) {
      setStatus('Error: ' + step.error, 'error');
    } else {
      stepCount = step.stepNumber;
      updateBadge();
      setStatus(`Step ${step.stepNumber} captured!`, 'success');
      stepDesc.value = '';
      refreshSteps();
    }
  } catch (err) {
    setStatus('Capture failed: ' + err.message, 'error');
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = '📸 Capture Step';
  }
});

// ── Generate ──
generateBtn.addEventListener('click', async () => {
  if (stepCount === 0) {
    setStatus('Capture at least one step first!', 'warning');
    return;
  }
  if (!confirm('Stop recording and generate the lab guide?')) return;

  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ Generating...';
  setStatus('Generating guide with AI... this may take a moment.', 'warning');

  try {
    const data = await apiCall('/session/generate', {
      method: 'POST',
      body: {},
    });

    if (data.error) {
      setStatus('Error: ' + data.error, 'error');
      generateBtn.disabled = false;
      generateBtn.textContent = '✓ Generate Guide';
    } else {
      setStatus(`Guide generated! (${data.stepsCount} steps) Check the web UI.`, 'success');
      generateBtn.textContent = '✓ Done!';
      recDot.classList.add('done');
      stopPolling();
    }
  } catch (err) {
    setStatus('Generation failed: ' + err.message, 'error');
    generateBtn.disabled = false;
    generateBtn.textContent = '✓ Generate Guide';
  }
});

// ── Cancel ──
cancelBtn.addEventListener('click', async () => {
  if (!confirm('Cancel recording? Steps will be lost.')) return;
  try {
    await apiCall('/session/cancel', { method: 'POST' });
    setStatus('Session cancelled.', 'warning');
    stepCount = 0;
    updateBadge();
    renderSteps([]);
    recDot.classList.add('done');
    stopPolling();
  } catch (err) {
    setStatus('Cancel failed: ' + err.message, 'error');
  }
});

// ── Edit Modal ──
function openEdit(num, desc) {
  editingStepNum = num;
  editInput.value = desc;
  editModal.classList.add('active');
  editInput.focus();
}

editCancel.addEventListener('click', () => {
  editModal.classList.remove('active');
  editingStepNum = null;
});

editSave.addEventListener('click', async () => {
  if (editingStepNum == null) return;
  const desc = editInput.value.trim();
  if (!desc) return;
  await apiCall(`/session/step/${editingStepNum}`, {
    method: 'PUT',
    body: { description: desc },
  });
  editModal.classList.remove('active');
  editingStepNum = null;
  refreshSteps();
});

editInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') editSave.click();
  if (e.key === 'Escape') editCancel.click();
});

// ── Steps Rendering ──
async function refreshSteps() {
  try {
    const data = await apiCall('/session');
    if (data.steps) {
      renderSteps(data.steps);
      stepCount = data.stepCount || data.steps.length;
      updateBadge();
    }
  } catch { /* ignore */ }
}

function renderSteps(steps) {
  if (!steps || steps.length === 0) {
    stepsList.innerHTML = '<div class="empty-state">No steps captured yet.<br>Perform actions, then click Capture.</div>';
    return;
  }

  stepsList.innerHTML = '';
  steps.forEach(step => {
    const div = document.createElement('div');
    div.className = 'step-item';

    const thumbUrl = step.screenshotFilename
      ? `${API.replace('/api', '')}/screenshots/${step.screenshotFilename}`
      : '';

    div.innerHTML = `
      <div class="step-num">${step.stepNumber}</div>
      <div class="step-info">
        <div class="step-desc" title="${escHtml(step.description)}">${escHtml(step.description)}</div>
        <div class="step-meta">${escHtml(step.pageTitle || '')} · ${new Date(step.timestamp).toLocaleTimeString()}</div>
      </div>
      ${thumbUrl ? `<img class="step-thumb" src="${thumbUrl}" data-full="${thumbUrl}" alt="Step ${step.stepNumber}">` : ''}
      <div class="step-actions">
        <button title="Edit" data-edit="${step.stepNumber}" data-desc="${escAttr(step.description)}">✎</button>
        <button title="Delete" data-delete="${step.stepNumber}">✕</button>
      </div>
    `;
    stepsList.appendChild(div);
  });

  // Attach event listeners
  stepsList.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      openEdit(parseInt(btn.dataset.edit), btn.dataset.desc);
    });
  });

  stepsList.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const num = parseInt(btn.dataset.delete);
      await apiCall(`/session/step/${num}`, { method: 'DELETE' });
      refreshSteps();
    });
  });

  stepsList.querySelectorAll('.step-thumb').forEach(img => {
    img.addEventListener('click', () => {
      imgPreviewSrc.src = img.dataset.full;
      imgPreview.classList.add('active');
    });
  });

  // Scroll to bottom
  stepsList.scrollTop = stepsList.scrollHeight;
}

// ── Polling ──
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      const data = await apiCall('/session');

      if (!connected) {
        connected = true;
        notConnected.style.display = 'none';
        captureSection.style.display = 'block';
      }

      if (!data.active) return;

      const newCount = data.stepCount || (data.steps ? data.steps.length : 0);
      if (newCount !== stepCount) {
        stepCount = newCount;
        updateBadge();
        renderSteps(data.steps || []);
      }
    } catch {
      if (connected) {
        connected = false;
        notConnected.style.display = 'block';
      }
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Listen for keyboard shortcut from background ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'capture') {
    captureBtn.click();
  }
});

// ── Helpers ──
function updateBadge() {
  stepBadge.textContent = stepCount + ' step' + (stepCount !== 1 ? 's' : '');
}

function setStatus(text, type = '') {
  status.textContent = text;
  status.className = 'status' + (type ? ' ' + type : '');
}

function escHtml(t) {
  const d = document.createElement('span');
  d.textContent = t || '';
  return d.innerHTML;
}

function escAttr(t) {
  return (t || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Keyboard: Enter to capture ──
stepDesc.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    captureBtn.click();
  }
});

// ── Boot ──
init();
