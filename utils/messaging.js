/**
 * LLM Council — Chrome Messaging Helpers
 */

/**
 * Send a message to the service worker and await a response.
 * @param {string} type - Message type from MSG constants
 * @param {object} payload - Message data
 * @returns {Promise<any>}
 */
export function sendToBackground(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, ...payload });
}

/**
 * Send a message to a specific tab's content script.
 * @param {number} tabId - Chrome tab ID
 * @param {string} type - Message type
 * @param {object} payload - Message data
 * @returns {Promise<any>}
 */
export function sendToTab(tabId, type, payload = {}) {
    return chrome.tabs.sendMessage(tabId, { type, ...payload });
}

/**
 * Listen for messages of specific type(s).
 * @param {string|string[]} types - Message type(s) to listen for
 * @param {Function} handler - (message, sender, sendResponse) => void
 * @returns {Function} Cleanup function to remove listener
 */
export function onMessage(types, handler) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);

    const listener = (message, sender, sendResponse) => {
        if (typeSet.has(message.type)) {
            return handler(message, sender, sendResponse);
        }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
}
