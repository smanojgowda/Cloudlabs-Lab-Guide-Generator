/* Lab Guide Recorder — background service worker */

// Open side panel when user clicks the extension icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Auto-open side panel when a tab finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch {
      // Might need user gesture on first open — user can click the icon
    }
  }
});

// Forward keyboard shortcut (Ctrl+Shift+C) to the side panel
chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-step') {
    chrome.runtime.sendMessage({ action: 'capture' });
  }
});
