const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snippingAPI', {
  onInit: (callback) => ipcRenderer.on('snipping-init', (_, data) => callback(data)),
  done: (base64) => ipcRenderer.send('snipping-done', { base64 }),
  cancel: () => ipcRenderer.send('snipping-done', { base64: null }),
});
