/**
 * Lab Guide Recorder — Electron Desktop App
 *
 * Single-window app: Azure Portal on the left (WebContentsView), recorder panel on the right.
 * Uses WebContentsView instead of <webview> so Bastion popups get native window.opener.
 * Starts the Express server internally, captures screenshots via IPC.
 */
import { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, cpSync, existsSync } from 'fs';

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
        try { portalView.setBounds(lastPortalBounds); } catch {}
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bastion-closed'); } catch {}
      });
    }

    // Allow nested popups (auth chains from Bastion, etc.)
    childWC.setWindowOpenHandler(({ url }) => {
      if (url.includes('login.microsoftonline.com') || url.includes('login.live.com') ||
          url.includes('msauth.net') || url.includes('msftauth.net') || url.includes('login.windows.net')) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: mainWindow, modal: true, autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure' } } };
      }
      if (url.includes('azure.com') || url.includes('azure.net') || url.includes('microsoft.com') || url.includes('windows.net')) {
        return { action: 'allow', overrideBrowserWindowOptions: { parent: mainWindow, frame: false, skipTaskbar: true, autoHideMenuBar: true,
          width: lastPortalBounds.width || 1000, height: lastPortalBounds.height || 700,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:azure', sandbox: false } } };
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
        window.__lastClickedElements = [];
        document.addEventListener('click', (e) => {
          const el = e.target.closest(
            'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="link"], ' +
            'input, select, textarea, [data-testid], .fxs-blade-title-titleText, ' +
            '.azc-toolbarButton, .ms-Button'
          ) || e.target;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            window.__lastClickedElements.push({
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 100),
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
  if (folderPath && existsSync(folderPath)) { shell.openPath(folderPath); return true; }
  return false;
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

app.on('window-all-closed', () => {});
