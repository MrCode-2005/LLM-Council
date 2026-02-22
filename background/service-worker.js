/**
 * LLM Council — Background Service Worker
 *
 * Minimal service worker that:
 * 1. Opens the dashboard tab when extension icon is clicked
 * 2. Handles keep-alive for the extension
 *
 * All pipeline logic (iframe creation, prompt injection, polling,
 * judge evaluation) is handled by dashboard.js directly.
 */

// ── Open Dashboard Tab on Icon Click ─────────────────────────────────────────

chrome.action.onClicked.addListener(async () => {
    const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url: dashboardUrl });
    }
});

// ── Keep-Alive ───────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'council-keepalive') {
        console.log('[LLM Council] Keep-alive ping');
    }
});
