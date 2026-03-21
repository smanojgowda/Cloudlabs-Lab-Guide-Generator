const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorAPI', {
  // Receive image data from main process
  onImageData: (callback) => ipcRenderer.on('editor-image-data', (_, data) => callback(data)),
  // Send edited image back
  save: (base64) => ipcRenderer.send('editor-save', base64),
});
