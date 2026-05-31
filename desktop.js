/**
 * Lab Guide Recorder — Electron Desktop App
 *
 * Single-window app: Azure Portal on the left (WebContentsView), recorder panel on the right.
 * Uses WebContentsView instead of <webview> so Bastion popups get native window.opener.
 * Starts the Express server internally, captures screenshots via IPC.
 */
import { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session } from 'electron';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, cpSync, existsSync, readdirSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let actualPort = parseInt(process.env.PORT || '9005', 10);
process.env.DESKTOP_MODE = 'true';

let mainWindow;
let portalView;        // WebContentsView for Azure Portal
let portalWebContents; // = portalView.webContents
let bastionWindow = null;      // Frameless child window for Bastion
let activeWebContents = null;  // Current capture target (portal or bastion)
let lastPortalBounds = { x: 0, y: 0, width: 0, height: 0 }; // Cached portal container bounds
let activeView = 'portal';     // 'portal' or 'bastion'

// ── Create window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'Spektra Lab Studio',
    webPreferences: {
      preload: join(__dirname, 'src', 'desktop', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // Create the portal view (overlaid on top of app.html's webview-container area)
  portalView = new WebContentsView({
    webPreferences: {
      partition: 'persist:azure',
      sandbox: false,
      contextIsolation: true,
    },
  });
  mainWindow.contentView.addChildView(portalView);
  portalWebContents = portalView.webContents;
  activeWebContents = portalWebContents;
  portalView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // hidden until renderer reports bounds

  // ── Portal popup handling ──
  portalWebContents.setWindowOpenHandler(({ url }) => {
    console.log('[Popup] Requested:', url);

    // Auth popups — modal window
    if (url.includes('login.microsoftonline.com') || url.includes('login.live.com') ||
      url.includes('login.windows.net') || url.includes('msauth.net') || url.includes('msftauth.net')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 720, parent: mainWindow, modal: true, autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure' },
        },
      };
    }

    // Bastion + Azure URLs — frameless child window overlaid on portal area (window.opener works!)
    if (url.includes('azure.com') || url.includes('azure.net') ||
      url.includes('microsoft.com') || url.includes('windows.net') || url.includes('office.com')) {
      console.log('[Popup] Opening Azure/Bastion as child window:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          frame: false,
          transparent: false,
          skipTaskbar: true,
          autoHideMenuBar: true,
          width: lastPortalBounds.width || 1000,
          height: lastPortalBounds.height || 700,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure', sandbox: false },
        },
      };
    }

    // External URLs — system browser
    console.log('[Popup] Opening externally:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Grant permissions for portal (clipboard, media — needed by Bastion RDP/SSH)
  const azureSession = session.fromPartition('persist:azure');
  azureSession.setPermissionRequestHandler((wc, permission, callback) => {
    console.log('[Permission] Requested:', permission);
    callback(true);
  });
  azureSession.setPermissionCheckHandler(() => true);

  // Forward portal navigation events to the renderer
  portalWebContents.on('did-navigate', (e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-did-navigate', url);
  });
  portalWebContents.on('did-navigate-in-page', (e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-did-navigate', url);
  });
  portalWebContents.on('page-title-updated', (e, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-title-updated', title);
  });
  portalWebContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-did-finish-load');
  });
  portalWebContents.on('did-fail-load', (e, errorCode, errorDesc) => {
    if (errorCode !== -3 && mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('portal-did-fail-load', errorDesc);
  });
  portalWebContents.on('render-process-gone', (e, details) => {
    console.error('Portal crashed:', details.reason);
    setTimeout(() => { if (!portalWebContents.isDestroyed()) portalWebContents.reload(); }, 1000);
  });

  // Handle child popups — track Bastion as embedded frameless child window
  portalWebContents.on('did-create-window', (childWin) => {
    const childWC = childWin.webContents;

    // Check if this is an auth popup
    const childUrl = childWC.getURL() || '';
    const isAuth = childUrl.includes('login.microsoftonline.com') || childUrl.includes('login.live.com') ||
      childUrl.includes('msauth.net') || childUrl.includes('msftauth.net');

    if (!isAuth) {
      // This is Bastion/Azure — embed as frameless child window over portal area
      console.log('[Bastion] Child window created, embedding over portal area');
      bastionWindow = childWin;
      activeWebContents = childWC;
      activeView = 'bastion';

      // Position bastion over the portal container area
      positionBastionWindow();
      // Hide portal view, show bastion
      portalView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      bastionWindow.show();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bastion-opened', childWC.getURL());
      }

      // Inject click tracker when bastion loads
      childWC.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-did-finish-load');
      });

      childWin.on('closed', () => {
        console.log('[Bastion] Window closed, reverting to portal');
        bastionWindow = null;
        activeWebContents = portalWebContents;
        activeView = 'portal';
        try { portalView.setBounds(lastPortalBounds); } catch { }
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bastion-closed'); } catch { }
      });
    }

    // Allow nested popups (auth chains from Bastion, etc.)
    childWC.setWindowOpenHandler(({ url }) => {
      if (url.includes('login.microsoftonline.com') || url.includes('login.live.com') ||
        url.includes('msauth.net') || url.includes('msftauth.net') || url.includes('login.windows.net')) {
        return {
          action: 'allow', overrideBrowserWindowOptions: {
            width: 520, height: 720, parent: mainWindow, modal: true, autoHideMenuBar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure' }
          }
        };
      }
      if (url.includes('azure.com') || url.includes('azure.net') || url.includes('microsoft.com') || url.includes('windows.net')) {
        return {
          action: 'allow', overrideBrowserWindowOptions: {
            parent: mainWindow, frame: false, skipTaskbar: true, autoHideMenuBar: true,
            width: lastPortalBounds.width || 1000, height: lastPortalBounds.height || 700,
            webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure', sandbox: false }
          }
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  mainWindow.loadFile(join(__dirname, 'src', 'desktop', 'app.html'));
  mainWindow.on('unresponsive', () => { console.warn('Main window unresponsive, waiting...'); });

  // Reposition bastion child window when main window moves or resizes
  mainWindow.on('move', () => positionBastionWindow());
  mainWindow.on('resize', () => positionBastionWindow());
}

// Convert portal container bounds (relative to renderer) to screen coordinates for bastion child window
function positionBastionWindow() {
  if (!bastionWindow || bastionWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;
  if (activeView !== 'bastion') return;
  try {
    const contentBounds = mainWindow.getContentBounds();
    bastionWindow.setBounds({
      x: contentBounds.x + lastPortalBounds.x,
      y: contentBounds.y + lastPortalBounds.y,
      width: lastPortalBounds.width,
      height: lastPortalBounds.height,
    });
  } catch (err) {
    console.warn('[Bastion] setBounds error:', err.message);
  }
}

// ── IPC Handlers ──

ipcMain.handle('get-port', () => actualPort);

// Portal navigation (from renderer)
ipcMain.on('portal-navigate', (e, url) => {
  if (portalWebContents && !portalWebContents.isDestroyed()) portalWebContents.loadURL(url);
});
ipcMain.on('portal-go-back', () => { if (portalWebContents && !portalWebContents.isDestroyed()) portalWebContents.goBack(); });
ipcMain.on('portal-go-forward', () => { if (portalWebContents && !portalWebContents.isDestroyed()) portalWebContents.goForward(); });
ipcMain.on('portal-reload', () => { if (portalWebContents && !portalWebContents.isDestroyed()) portalWebContents.reload(); });

// Renderer reports the portal container bounds so we can position the overlay
ipcMain.on('portal-bounds', (e, bounds) => {
  lastPortalBounds = bounds;
  if (activeView === 'portal') {
    if (portalView) portalView.setBounds(bounds);
  } else if (activeView === 'bastion') {
    positionBastionWindow();
  }
});

// Switch between portal and bastion views
ipcMain.on('switch-to-portal', () => {
  activeView = 'portal';
  activeWebContents = portalWebContents;
  portalView.setBounds(lastPortalBounds);
  if (bastionWindow && !bastionWindow.isDestroyed()) bastionWindow.hide();
  console.log('[View] Switched to Portal');
});
ipcMain.on('switch-to-bastion', () => {
  if (!bastionWindow || bastionWindow.isDestroyed()) return;
  activeView = 'bastion';
  activeWebContents = bastionWindow.webContents;
  portalView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  positionBastionWindow();
  bastionWindow.show();
  console.log('[View] Switched to Bastion');
});

// Temporarily hide/show bastion (for editor overlay)
ipcMain.on('hide-bastion', () => {
  if (bastionWindow && !bastionWindow.isDestroyed()) bastionWindow.hide();
});
ipcMain.on('show-bastion', () => {
  if (bastionWindow && !bastionWindow.isDestroyed() && activeView === 'bastion') {
    positionBastionWindow();
    bastionWindow.show();
  }
});

// Capture screenshot from the active view (portal or bastion)
ipcMain.handle('capture-screenshot', async () => {
  const wc = activeWebContents;
  if (!wc || wc.isDestroyed()) return null;
  try {
    const image = await wc.capturePage();
    return image.toPNG().toString('base64');
  } catch (err) {
    console.error('Screenshot capture failed:', err.message);
    return null;
  }
});

// Inject click tracker into the active view (portal or bastion)
ipcMain.handle('inject-click-tracker', async () => {
  const wc = activeWebContents;
  if (!wc || wc.isDestroyed()) return false;
  try {
    await wc.executeJavaScript(`
      if (!window.__lastClickedElements) {
        window.__buildCssSelector = function(el) {
          const tag = el.tagName.toLowerCase();
          const aria = el.getAttribute('aria-label');
          if (aria) return tag + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]';
          const testId = el.getAttribute('data-testid');
          if (testId) return tag + '[data-testid="' + testId + '"]';
          if (el.id) return '#' + el.id;
          const role = el.getAttribute('role');
          const text = (el.textContent || '').trim().slice(0, 50);
          if (role && text) return tag + '[role="' + role + '"]';
          if (el.name) return tag + '[name="' + el.name + '"]';
          const cls = Array.from(el.classList || []).filter(c => !c.match(/^(x-|_|ember)/)).slice(0, 3).join('.');
          if (cls) return tag + '.' + cls;
          return tag;
        };
        window.__lastClickedElements = [];
        document.addEventListener('click', (e) => {
          const el = e.target.closest(
            'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="link"], ' +
            'input, select, textarea, [data-testid], .fxs-blade-title-titleText, ' +
            '.azc-toolbarButton, .ms-Button'
          ) || e.target;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const parentEl = el.parentElement;
            window.__lastClickedElements.push({
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 120),
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
              parentText: parentEl ? (parentEl.textContent || '').trim().slice(0, 80) : '',
            });
            if (window.__lastClickedElements.length > 10) window.__lastClickedElements.shift();
          }
        }, true);
      }
    `);
    return true;
  } catch { return false; }
});

// Get last-clicked element data
ipcMain.handle('get-click-data', async () => {
  const wc = activeWebContents;
  if (!wc || wc.isDestroyed()) return null;
  try {
    return await wc.executeJavaScript(`(() => { const a = window.__lastClickedElements; if (!a || !a.length) return null; return a.pop(); })()`);
  } catch { return null; }
});

// Get active view URL and title
ipcMain.handle('get-webview-info', async () => {
  const wc = activeWebContents;
  if (!wc || wc.isDestroyed()) return { url: '', title: '' };
  try { return { url: wc.getURL(), title: wc.getTitle() }; } catch { return { url: '', title: '' }; }
});

// Get device pixel ratio
ipcMain.handle('get-device-pixel-ratio', async () => {
  const wc = activeWebContents;
  if (!wc || wc.isDestroyed()) return 1;
  try { return await wc.executeJavaScript('window.devicePixelRatio || 1'); } catch { return 1; }
});

// Open folder
ipcMain.handle('open-folder', async (_, folderPath) => {
  if (!folderPath) return false;
  // Resolve relative paths against project root
  const resolved = isAbsolute(folderPath) ? folderPath : join(__dirname, folderPath);
  if (existsSync(resolved)) { shell.openPath(resolved); return true; }
  return false;
});

// Import guide
ipcMain.handle('import-guide', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Lab Guide',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    const filePath = result.filePaths[0];
    const markdown = readFileSync(filePath, 'utf-8');
    const guideDir = dirname(filePath);
    return { markdown, filePath, guideDir };
  } catch (err) {
    console.error('[Import] Failed to read guide:', err.message);
    return null;
  }
});

// Save guide
ipcMain.handle('save-guide', async (_, { markdown, defaultName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Lab Guide', defaultPath: defaultName || 'guide.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, markdown, 'utf-8');
  return result.filePath;
});

// Export guide folder
ipcMain.handle('export-guide-folder', async (_, { guideDir }) => {
  if (!guideDir || !existsSync(guideDir)) return null;
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose Export Destination', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const dest = join(result.filePaths[0], 'lab-guide');
  cpSync(guideDir, dest, { recursive: true });
  shell.openPath(dest);
  return dest;
});

// Version the current guide.md before overwriting
function versionGuideFile(guideDir) {
  const guidePath = join(guideDir, 'guide.md');
  if (!existsSync(guidePath)) return 0;
  const versionsDir = join(guideDir, 'versions');
  if (!existsSync(versionsDir)) mkdirSync(versionsDir, { recursive: true });
  const existing = readdirSync(versionsDir).filter(f => /^guide\.v\d+\.md$/.test(f));
  const nums = existing.map(f => parseInt(f.match(/\.v(\d+)\./)[1], 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  const content = readFileSync(guidePath, 'utf-8');
  writeFileSync(join(versionsDir, `guide.v${next}.md`), content, 'utf-8');
  console.log(`[Guide] Versioned: v${next}`);
  return next;
}

// Save edited guide markdown back to the output guide.md
ipcMain.handle('save-guide-to-dir', async (_, { guideDir, markdown }) => {
  if (!guideDir || !markdown) return false;
  try {
    // Version before overwriting
    versionGuideFile(guideDir);
    const guidePath = join(guideDir, 'guide.md');
    writeFileSync(guidePath, markdown, 'utf-8');
    console.log('[Guide] Saved edited guide to:', guidePath);
    return true;
  } catch (err) {
    console.error('[Guide] Save failed:', err.message);
    return false;
  }
});

// List all versions of a guide
ipcMain.handle('list-guide-versions', async (_, { guideDir }) => {
  if (!guideDir) return [];
  const versionsDir = join(guideDir, 'versions');
  if (!existsSync(versionsDir)) return [];
  return readdirSync(versionsDir)
    .filter(f => /^guide\.v\d+\.md$/.test(f))
    .map(f => ({ version: parseInt(f.match(/\.v(\d+)\./)[1], 10), filename: f }))
    .sort((a, b) => b.version - a.version);
});

// Restore a specific version
ipcMain.handle('restore-guide-version', async (_, { guideDir, version }) => {
  if (!guideDir || !version) return null;
  const versionPath = join(guideDir, 'versions', `guide.v${version}.md`);
  if (!existsSync(versionPath)) return null;
  // Version current before restoring
  versionGuideFile(guideDir);
  const content = readFileSync(versionPath, 'utf-8');
  writeFileSync(join(guideDir, 'guide.md'), content, 'utf-8');
  console.log(`[Guide] Restored from v${version}`);
  return content;
});

// Read a specific guide version's content (for diff)
ipcMain.handle('read-guide-version', async (_, { guideDir, version }) => {
  if (!guideDir || !version) return null;
  const versionPath = join(guideDir, 'versions', `guide.v${version}.md`);
  if (!existsSync(versionPath)) return null;
  return readFileSync(versionPath, 'utf-8');
});

// Export guide as PDF
ipcMain.handle('export-pdf', async (_, { markdown, guideDir }) => {
  if (!markdown) return null;

  // Convert markdown to styled HTML for PDF rendering
  let html = markdown
    .replace(/```([\s\S]*?)```/g, '<pre style="background:#f6f8fa;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;"><code>$1</code></pre>')
    .replace(/^#### (.+)$/gm, '<h4 style="font-size:14px;margin:12px 0 4px;">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:16px;margin:14px 0 6px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:22px;margin:18px 0 10px;border-bottom:2px solid #7c3aed;padding-bottom:6px;color:#7c3aed;">$1</h1>')
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #7c3aed;padding:8px 14px;margin:8px 0;background:#f8f6ff;">$1</blockquote>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Handle screenshot images — convert relative paths to file:// URIs
  if (guideDir) {
    html = html.replace(/!\[([^\]]*)\]\(screenshots\/([^)]+)\)/g, (_, alt, filename) => {
      const imgPath = join(guideDir, 'screenshots', filename).replace(/\\/g, '/');
      return '<img src="file:///' + imgPath + '" alt="' + alt + '" style="max-width:100%;border:1px solid #ddd;border-radius:4px;margin:8px 0;">';
    });
  }

  const fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#24292f;max-width:800px;margin:0 auto;padding:30px 40px;}' +
    'img{max-width:100%;border:1px solid #ddd;border-radius:4px;margin:8px 0;}' +
    'table{width:100%;border-collapse:collapse;margin:8px 0;}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:12px;}th{background:#f6f8fa;font-weight:600;}' +
    'ul,ol{padding-left:22px;margin:6px 0;}li{margin:4px 0;}' +
    '</style></head><body><p>' + html + '</p></body></html>';

  // Create hidden window and print to PDF
  const pdfWin = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true } });
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    // Brief wait for images to load
    await new Promise(r => setTimeout(r, 1500));
    const pdfData = await pdfWin.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      landscape: false,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: 'guide.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return null;
    writeFileSync(filePath, pdfData);
    console.log('[PDF] Exported to:', filePath);
    return filePath;
  } catch (err) {
    console.error('[PDF] Export failed:', err.message);
    return null;
  } finally {
    pdfWin.destroy();
  }
});

// ── Screenshot Editor Popup ──
let editorWindow = null;
let editorStepNumber = null;
let editorScreenshotPath = null;
let editorGuideDir = null;
let editorScreenshotFilename = null;

ipcMain.handle('open-editor', async (_, { stepNumber, screenshotRelative, screenshotPath, screenshotFilename, guideDir }) => {
  if (editorWindow && !editorWindow.isDestroyed()) { editorWindow.focus(); return; }

  editorStepNumber = stepNumber;
  editorScreenshotPath = screenshotPath;
  editorGuideDir = guideDir;
  editorScreenshotFilename = screenshotFilename;

  editorWindow = new BrowserWindow({
    width: 1000, height: 750,
    parent: mainWindow,
    title: 'Edit Screenshot — Step ' + stepNumber,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'src', 'desktop', 'editor-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  editorWindow.loadFile(join(__dirname, 'src', 'desktop', 'editor.html'));

  editorWindow.webContents.on('did-finish-load', () => {
    // Read the screenshot file and send as base64
    try {
      const buffer = readFileSync(screenshotPath);
      editorWindow.webContents.send('editor-image-data', {
        stepNumber,
        base64: buffer.toString('base64'),
      });
    } catch (err) {
      console.error('[Editor] Failed to read screenshot:', err.message);
    }
  });

  editorWindow.on('closed', () => { editorWindow = null; editorStepNumber = null; });
});

// Editor saves edited image
ipcMain.on('editor-save', (_, base64) => {
  if (!editorScreenshotPath || !editorStepNumber) return;
  try {
    const buffer = Buffer.from(base64, 'base64');
    // Save to original screenshot location
    writeFileSync(editorScreenshotPath, buffer);
    console.log('[Editor] Saved edited screenshot:', editorScreenshotPath);
    // Also update the copy in the guide folder so exports include the edit
    if (editorGuideDir && editorScreenshotFilename) {
      const guideCopy = join(editorGuideDir, 'screenshots', editorScreenshotFilename);
      if (existsSync(join(editorGuideDir, 'screenshots'))) {
        writeFileSync(guideCopy, buffer);
        console.log('[Editor] Updated guide copy:', guideCopy);
      }
    }
    // Notify renderer to refresh the image
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('editor-saved', { stepNumber: editorStepNumber });
    }
  } catch (err) {
    console.error('[Editor] Save failed:', err.message);
  }
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.close();
});

// ── Missing IPC Handlers ──

// Test Lab — token & form field persistence
const settingsPath = join(__dirname, 'testlab-settings.json');

function readSettings() {
  try { return JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { return {}; }
}
function writeSettings(data) {
  const existing = readSettings();
  writeFileSync(settingsPath, JSON.stringify({ ...existing, ...data }, null, 2), 'utf-8');
}

ipcMain.handle('testlab-save-token', (_, token) => { writeSettings({ token }); return true; });
ipcMain.handle('testlab-get-token', () => readSettings().token || '');
ipcMain.handle('testlab-save-fields', (_, fields) => { writeSettings({ fields }); return true; });
ipcMain.handle('testlab-get-fields', () => readSettings().fields || {});
ipcMain.handle('testlab-open-external', (_, url) => { shell.openExternal(url); return true; });
ipcMain.handle('testlab-open-path', (_, path) => { shell.openPath(path); return true; });

// Import an entire folder of .md guide files
ipcMain.handle('import-guide-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Guide Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  const files = readdirSync(folderPath)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      filename: f,
      filePath: join(folderPath, f),
      markdown: readFileSync(join(folderPath, f), 'utf-8'),
    }));
  return { folderPath, files };
});

// Save a local file back to disk
ipcMain.handle('save-local-file', async (_, { filePath, content }) => {
  if (!filePath || !content) return false;
  try { writeFileSync(filePath, content, 'utf-8'); return true; }
  catch (err) { console.error('[SaveLocal] Failed:', err.message); return false; }
});

// Read a local image as data URI
ipcMain.handle('read-local-image', async (_, absPath) => {
  if (!absPath || !existsSync(absPath)) return null;
  try {
    const buffer = readFileSync(absPath);
    const ext = absPath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) { console.error('[ReadImage] Failed:', err.message); return null; }
});

// AI Auto-Record stubs (no-op since AI auto-record depends on separate logic)
ipcMain.handle('ai-get-events', async () => []);
ipcMain.handle('ai-inject-auto-detect', async () => false);
ipcMain.handle('ai-start-auto-record', async () => false);
ipcMain.handle('ai-stop-auto-record', async () => false);
ipcMain.handle('ai-pause-auto-record', async () => false);
ipcMain.handle('ai-is-active', async () => false);

// Hide/show portal view (for screenshot editor overlay)
ipcMain.on('hide-portal-view', () => {
  if (portalView) portalView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
});
ipcMain.on('show-portal-view', () => {
  if (portalView && activeView === 'portal') portalView.setBounds(lastPortalBounds);
});

// ── Launch ──

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

process.on('uncaughtException', (err) => { console.error('[UncaughtException]', err.message); });
process.on('unhandledRejection', (reason) => { console.error('[UnhandledRejection]', reason); });

app.whenReady().then(async () => {
  const { actualPort: port } = await import('./src/server.js');
  actualPort = port;
  console.log('[Main] Server started on port:', actualPort);
  createWindow();

  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
});

app.on('window-all-closed', () => { });
