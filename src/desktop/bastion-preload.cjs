/**
 * Bastion Webview Preload
 *
 * Runs BEFORE any page scripts in the Bastion <webview> tab.
 * Shims window.opener which Bastion requires to validate it was opened
 * from the Azure Portal. In our tab-based approach, there is no real opener,
 * so we create one that routes postMessage through IPC.
 *
 * contextIsolation MUST be off (set on the <webview> tag) for this to work.
 */
try {
  const { ipcRenderer } = require('electron');

  // Self-identify so main process tracks our webContents
  ipcRenderer.send('identify-bastion');

  // Extract trustedAuthority from the URL query string
  const params = new URLSearchParams(window.location.search);
  const trustedAuthority = params.get('trustedAuthority') || 'https://portal.azure.com';

  // Parse origin from trustedAuthority
  let authorityOrigin;
  try {
    authorityOrigin = new URL(trustedAuthority).origin;
  } catch {
    authorityOrigin = trustedAuthority;
  }

  // Define window.opener before Bastion's scripts run
  Object.defineProperty(window, 'opener', {
    value: {
      postMessage: function (data, targetOrigin) {
        console.log('[BastionPreload] bastion→portal postMessage');
        ipcRenderer.send('bastion-to-portal', { data, targetOrigin });
      },
      closed: false,
      origin: authorityOrigin,
      location: {
        origin: authorityOrigin,
        href: trustedAuthority,
        protocol: 'https:',
        host: authorityOrigin.replace('https://', ''),
      },
    },
    writable: false,
    configurable: true,
  });

  // Listen for Portal → Bastion messages forwarded via IPC
  ipcRenderer.on('portal-message', (_, msg) => {
    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: msg.data,
          origin: msg.origin || authorityOrigin,
        })
      );
    } catch (e) {
      console.warn('[BastionPreload] Failed to dispatch message:', e);
    }
  });

  console.log('[BastionPreload] window.opener shimmed for:', trustedAuthority);
} catch (e) {
  console.error('[BastionPreload] Error:', e);
}
