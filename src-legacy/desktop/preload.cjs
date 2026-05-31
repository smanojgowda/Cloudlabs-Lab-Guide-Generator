const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPort:              () => ipcRenderer.invoke('get-port'),
  captureScreenshot:    () => ipcRenderer.invoke('capture-screenshot'),
  captureRegion:        () => ipcRenderer.invoke('capture-region-screenshot'),
  injectClickTracker:   () => ipcRenderer.invoke('inject-click-tracker'),
  getClickData:         () => ipcRenderer.invoke('get-click-data'),
  getWebviewInfo:       () => ipcRenderer.invoke('get-webview-info'),
  getDevicePixelRatio:  () => ipcRenderer.invoke('get-device-pixel-ratio'),
  openFolder:           (p) => ipcRenderer.invoke('open-folder', p),
  saveGuide:            (opts) => ipcRenderer.invoke('save-guide', opts),
  exportGuideFolder:    (opts) => ipcRenderer.invoke('export-guide-folder', opts),

  // Portal navigation — renderer → main process → WebContentsView
  portalNavigate:   (url) => ipcRenderer.send('portal-navigate', url),
  portalGoBack:     ()    => ipcRenderer.send('portal-go-back'),
  portalGoForward:  ()    => ipcRenderer.send('portal-go-forward'),
  portalReload:     ()    => ipcRenderer.send('portal-reload'),

  // Report portal container bounds for WebContentsView positioning
  reportPortalBounds: (bounds) => ipcRenderer.send('portal-bounds', bounds),

  // Switch between portal and bastion views
  switchToPortal:  () => ipcRenderer.send('switch-to-portal'),
  switchToBastion: () => ipcRenderer.send('switch-to-bastion'),
  closeBastion:    () => ipcRenderer.send('close-bastion'),
  hideBastion:     () => ipcRenderer.send('hide-bastion'),
  showBastion:     () => ipcRenderer.send('show-bastion'),

  // Hide/show portal overlay (for screenshot editor)
  hidePortalView:  () => ipcRenderer.send('hide-portal-view'),
  showPortalView:  () => ipcRenderer.send('show-portal-view'),

  // Open screenshot in popup editor
  openEditor: (data) => ipcRenderer.invoke('open-editor', data),

  // Save edited guide markdown back to guide dir
  saveGuideToDir: (opts) => ipcRenderer.invoke('save-guide-to-dir', opts),

  // Guide versioning
  listGuideVersions: (opts) => ipcRenderer.invoke('list-guide-versions', opts),
  restoreGuideVersion: (opts) => ipcRenderer.invoke('restore-guide-version', opts),
  readGuideVersion: (opts) => ipcRenderer.invoke('read-guide-version', opts),

  // PDF export
  exportPDF: (opts) => ipcRenderer.invoke('export-pdf', opts),

  // Import an existing .md guide file
  importGuide: () => ipcRenderer.invoke('import-guide'),

  // Import an entire folder of .md guide files
  importGuideFolder: () => ipcRenderer.invoke('import-guide-folder'),

  // Save a local file back to disk (for local imports)
  saveLocalFile: (opts) => ipcRenderer.invoke('save-local-file', opts),

  // Read a local image as data URI (for local folder preview)
  readLocalImage: (absPath) => ipcRenderer.invoke('read-local-image', absPath),

  // Test Lab — token & form fields
  testlabSaveToken:   (token) => ipcRenderer.invoke('testlab-save-token', token),
  testlabGetToken:    () => ipcRenderer.invoke('testlab-get-token'),
  testlabSaveFields:  (fields) => ipcRenderer.invoke('testlab-save-fields', fields),
  testlabGetFields:   () => ipcRenderer.invoke('testlab-get-fields'),
  testlabOpenExternal: (url) => ipcRenderer.invoke('testlab-open-external', url),
  testlabOpenPath:    (path) => ipcRenderer.invoke('testlab-open-path', path),

  // AI Auto-Record
  aiGetEvents:        () => ipcRenderer.invoke('ai-get-events'),
  aiInjectAutoDetect: () => ipcRenderer.invoke('ai-inject-auto-detect'),
  aiStartAutoRecord:  () => ipcRenderer.invoke('ai-start-auto-record'),
  aiStopAutoRecord:   () => ipcRenderer.invoke('ai-stop-auto-record'),
  aiPauseAutoRecord:  () => ipcRenderer.invoke('ai-pause-auto-record'),
  aiIsActive:         () => ipcRenderer.invoke('ai-is-active'),

});

// Portal events — main process → renderer (via window events, safe with contextIsolation)
ipcRenderer.on('portal-did-navigate', (_, url) => {
  window.dispatchEvent(new CustomEvent('portal-navigated', { detail: url }));
});
ipcRenderer.on('portal-title-updated', (_, title) => {
  window.dispatchEvent(new CustomEvent('portal-title-updated', { detail: title }));
});
ipcRenderer.on('portal-did-finish-load', () => {
  window.dispatchEvent(new CustomEvent('portal-finish-load'));
});
ipcRenderer.on('portal-did-fail-load', (_, desc) => {
  window.dispatchEvent(new CustomEvent('portal-fail-load', { detail: desc }));
});
ipcRenderer.on('bastion-opened', (_, url) => {
  window.dispatchEvent(new CustomEvent('bastion-opened', { detail: url }));
});
ipcRenderer.on('bastion-closed', () => {
  window.dispatchEvent(new CustomEvent('bastion-closed'));
});
ipcRenderer.on('editor-saved', (_, data) => {
  window.dispatchEvent(new CustomEvent('editor-saved', { detail: data }));
});
