/**
 * LeetCode Hints — Background Service Worker
 *
 * Since there's no popup (we use an in-page overlay instead),
 * clicking the extension icon sends a toggle message to the
 * content script on the active tab.
 */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Only act on LeetCode problem pages
  if (!tab.url || !tab.url.includes("leetcode.com/problems/")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggleOverlay" });
  } catch {
    // Content script might not be injected yet (e.g., page just loaded).
    // Inject it programmatically, then send the toggle.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
      // Give the script a moment to initialize
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { action: "toggleOverlay" });
      }, 200);
    } catch (err) {
      console.error("LeetCode Hints: Failed to inject content script", err);
    }
  }
});
