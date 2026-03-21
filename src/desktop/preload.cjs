const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPort:              () => ipcRenderer.invoke('get-port'),
  captureScreenshot:    () => ipcRenderer.invoke('capture-screenshot'),
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
  hideBastion:     () => ipcRenderer.send('hide-bastion'),
  showBastion:     () => ipcRenderer.send('show-bastion'),

  // Open screenshot in popup editor
  openEditor: (data) => ipcRenderer.invoke('open-editor', data),
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
