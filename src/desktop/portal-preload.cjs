/**
 * Portal Webview Preload
 *
 * Runs inside the Azure Portal <webview> before page scripts.
 * Intercepts window.open() for Bastion URLs so Bastion opens as a tab
 * instead of a separate BrowserWindow. Returns a fake WindowProxy
 * that forwards postMessage calls via IPC.
 *
 * Requires contextIsolation=no on the webview.
 */
try {
  const { ipcRenderer } = require('electron');

  // Self-identify so main process tracks our webContents
  ipcRenderer.send('identify-portal');

  // Save native window.open
  const nativeOpen = window.open.bind(window);

  // Monkey-patch window.open for Bastion URLs
  window.open = function (url, target, features) {
    if (url && url.includes('.bastion.azure.com')) {
      console.log('[PortalPreload] Intercepted Bastion window.open:', url);

      // Tell main process → renderer to open Bastion as a tab
      ipcRenderer.send('open-bastion-tab', url);

      // Return a fake WindowProxy so the portal can send messages to Bastion
      const fakeProxy = {
        postMessage: function (data, targetOrigin) {
          console.log('[PortalPreload] portal→bastion postMessage');
          ipcRenderer.send('portal-to-bastion', { data, targetOrigin });
        },
        closed: false,
        close: function () {
          this.closed = true;
          ipcRenderer.send('close-bastion-tab');
        },
        focus: function () {},
        blur: function () {},
        location: { href: url },
      };
      return fakeProxy;
    }

    // All other URLs → native window.open (auth popups, etc.)
    return nativeOpen(url, target, features);
  };

  // Listen for messages FROM Bastion (forwarded by main process)
  ipcRenderer.on('bastion-message', (_, msg) => {
    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: msg.data,
          origin: msg.origin || '',
        })
      );
    } catch (e) {
      console.warn('[PortalPreload] Failed to dispatch bastion message:', e);
    }
  });

  console.log('[PortalPreload] Ready — window.open patched for Bastion');
} catch (e) {
  console.error('[PortalPreload] Error:', e);
}
