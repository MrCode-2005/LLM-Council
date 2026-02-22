/**
 * LLM Council — Background Service Worker
 *
 * Orchestrates:
 * 1. Opens dashboard tab when extension icon is clicked
 * 2. Opens tiled windows for council models + judge
 * 3. Injects prompts into council models
 * 4. Polls for response completion
 * 5. Builds evaluation prompt & injects into judge
 * 6. Parses judge result & sends to dashboard
 */

import { MODELS, MSG, RESPONSE_STATUS, JUDGE_MODE, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';
import { buildEvaluationPrompt } from '../judge/judge-engine.js';
import { parseJudgeResponse } from '../judge/judge-parser.js';

// ── Open Dashboard Tab on Icon Click ─────────────────────────────────────────

chrome.action.onClicked.addListener(async () => {
    // Check if dashboard tab already exists
    const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

    if (existing) {
        // Focus existing tab
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
    } else {
        // Open new tab
        await chrome.tabs.create({ url: dashboardUrl });
    }
});

// ── State ────────────────────────────────────────────────────────────────────

let councilState = {
    active: false,
    prompt: '',
    models: [],
    responses: {},
    judgeModelId: null,
    judgeTabId: null,
    judgeWindowId: null,
    councilWindows: []   // track opened windows for tiling
};

// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case MSG.ASK_COUNCIL:
            handleAskCouncil(message, sendResponse);
            return true;

        case MSG.REAUTHENTICATE_JUDGE:
            handleReauthJudge(sendResponse);
            return true;

        case MSG.GET_STATUS:
            sendResponse({
                active: councilState.active,
                responses: councilState.responses,
                prompt: councilState.prompt
            });
            return true;

        default:
            return false;
    }
});

// ── Council Pipeline ─────────────────────────────────────────────────────────

async function handleAskCouncil(message, sendResponse) {
    const { prompt, councilModels, judgeModel, judgeMode } = message;

    councilState = {
        active: true,
        prompt,
        models: councilModels,
        responses: {},
        judgeModelId: judgeModel,
        judgeTabId: null,
        judgeWindowId: null,
        councilWindows: []
    };

    for (const modelId of councilModels) {
        councilState.responses[modelId] = {
            tabId: null,
            windowId: null,
            status: RESPONSE_STATUS.PENDING,
            response: null,
            modelName: MODELS[modelId]?.name || modelId
        };
    }

    sendResponse({ success: true, message: 'Pipeline started' });
    broadcastStatus('Opening AI sites in tiled windows...');

    try {
        // Step 1: Get screen dimensions and compute tiling layout
        const screenInfo = await getScreenDimensions();
        const totalWindows = councilModels.length + 1; // councils + judge
        const tiles = computeTileLayout(screenInfo, totalWindows);

        // Step 2: Open council windows (tiled)
        for (let i = 0; i < councilModels.length; i++) {
            const modelId = councilModels[i];
            const model = MODELS[modelId];
            if (!model) continue;

            const tile = tiles[i];
            try {
                const win = await chrome.windows.create({
                    url: model.url,
                    left: tile.left,
                    top: tile.top,
                    width: tile.width,
                    height: tile.height,
                    focused: false,
                    type: 'normal'
                });
                councilState.responses[modelId].tabId = win.tabs[0].id;
                councilState.responses[modelId].windowId = win.id;
                councilState.councilWindows.push(win.id);
            } catch (e) {
                console.error(`[LLM Council] Failed to open ${modelId}:`, e);
                councilState.responses[modelId].status = RESPONSE_STATUS.FAILED;
            }
        }

        // Step 3: Open judge window (last tile position)
        const judgeTile = tiles[councilModels.length]; // last tile
        const judgeModel_info = MODELS[judgeModel];

        if (judgeModel_info) {
            const isIncognito = judgeMode === JUDGE_MODE.INCOGNITO;
            try {
                const judgeWin = await chrome.windows.create({
                    url: judgeModel_info.url,
                    left: judgeTile.left,
                    top: judgeTile.top,
                    width: judgeTile.width,
                    height: judgeTile.height,
                    focused: false,
                    incognito: isIncognito,
                    type: 'normal'
                });
                councilState.judgeTabId = judgeWin.tabs[0].id;
                councilState.judgeWindowId = judgeWin.id;
            } catch (e) {
                console.error('[LLM Council] Failed to open judge:', e);
                // Fallback: open without incognito
                const judgeWin = await chrome.windows.create({
                    url: judgeModel_info.url,
                    left: judgeTile.left,
                    top: judgeTile.top,
                    width: judgeTile.width,
                    height: judgeTile.height,
                    focused: false,
                    type: 'normal'
                });
                councilState.judgeTabId = judgeWin.tabs[0].id;
                councilState.judgeWindowId = judgeWin.id;
            }
        }

        broadcastStatus('Waiting for pages to load...');

        // Step 4: Wait for all council tabs to load
        for (const modelId of councilModels) {
            const state = councilState.responses[modelId];
            if (state.status === RESPONSE_STATUS.FAILED || !state.tabId) continue;
            try {
                await waitForTabLoad(state.tabId);
            } catch (e) {
                console.warn(`[LLM Council] Tab load timeout for ${modelId}`);
            }
        }

        // Wait for judge tab too
        if (councilState.judgeTabId) {
            try { await waitForTabLoad(councilState.judgeTabId); } catch (e) { }
        }

        // Step 5: Inject prompts into council models sequentially
        broadcastStatus('Injecting prompt into council models...');

        for (const modelId of councilModels) {
            const state = councilState.responses[modelId];
            if (state.status === RESPONSE_STATUS.FAILED || !state.tabId) continue;

            state.status = RESPONSE_STATUS.INJECTING;
            broadcastStatus(`Sending to ${state.modelName}...`);

            try {
                await injectIntoTab(state.tabId, prompt);
                state.status = RESPONSE_STATUS.WAITING;
            } catch (e) {
                console.error(`[LLM Council] Injection failed for ${modelId}:`, e);
                state.status = RESPONSE_STATUS.FAILED;
            }

            // Delay between injections
            if (councilModels.indexOf(modelId) < councilModels.length - 1) {
                await delay(DEFAULTS.INJECTION_DELAY_MS);
            }
        }

        // Step 6: Poll for all responses
        broadcastStatus('Waiting for council responses...');
        await waitForAllResponses(councilModels);

        // Step 7: Build evaluation prompt
        const responsesArray = councilModels.map(id => councilState.responses[id]);
        const completedResponses = responsesArray.filter(r => r.status === RESPONSE_STATUS.COMPLETE);

        if (completedResponses.length === 0) {
            broadcastStatus('All council models failed.');
            broadcastError('No council responses received. Judge evaluation skipped.');
            councilState.active = false;
            return;
        }

        const evalPrompt = buildEvaluationPrompt(prompt, responsesArray);
        broadcastStatus('Sending evaluation to Judge...');

        // Step 8: Inject evaluation prompt into judge
        if (councilState.judgeTabId) {
            await injectIntoTab(councilState.judgeTabId, evalPrompt);

            // Focus judge window
            if (councilState.judgeWindowId) {
                await chrome.windows.update(councilState.judgeWindowId, { focused: true });
            }

            broadcastStatus('Waiting for Judge verdict...');

            // Step 9: Wait for judge response
            const judgeResponse = await pollForResponse(councilState.judgeTabId, DEFAULTS.JUDGE_TIMEOUT_MS);

            // Step 10: Parse and send results
            const modelNames = completedResponses.map(r => r.modelName);
            const judgeResult = parseJudgeResponse(judgeResponse, modelNames);

            broadcastResult(judgeResult);
            broadcastStatus('Evaluation complete!');
        } else {
            broadcastError('Judge tab could not be opened.');
        }

    } catch (error) {
        console.error('[LLM Council] Pipeline error:', error);
        broadcastError(error.message);
    } finally {
        councilState.active = false;
    }
}

// ── Screen & Tiling ──────────────────────────────────────────────────────────

async function getScreenDimensions() {
    return new Promise((resolve) => {
        try {
            chrome.system.display.getInfo((displays) => {
                if (displays && displays.length > 0) {
                    const primary = displays[0];
                    resolve({
                        width: primary.workArea.width,
                        height: primary.workArea.height,
                        left: primary.workArea.left,
                        top: primary.workArea.top
                    });
                } else {
                    resolve({ width: 1920, height: 1080, left: 0, top: 0 });
                }
            });
        } catch (e) {
            resolve({ width: 1920, height: 1080, left: 0, top: 0 });
        }
    });
}

/**
 * Compute tiling positions for N windows.
 *
 * Layouts:
 *   2 windows → 2 columns
 *   3 windows → 3 columns
 *   4 windows → 2×2 grid
 *   5 windows → top row: 3, bottom row: 2
 */
function computeTileLayout(screen, count) {
    const tiles = [];
    const { width, height, left, top } = screen;

    if (count <= 3) {
        // Single row, N columns
        const colWidth = Math.floor(width / count);
        for (let i = 0; i < count; i++) {
            tiles.push({
                left: left + i * colWidth,
                top: top,
                width: colWidth,
                height: height
            });
        }
    } else if (count === 4) {
        // 2×2 grid
        const colWidth = Math.floor(width / 2);
        const rowHeight = Math.floor(height / 2);
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                tiles.push({
                    left: left + col * colWidth,
                    top: top + row * rowHeight,
                    width: colWidth,
                    height: rowHeight
                });
            }
        }
    } else {
        // 5 windows: top row 3, bottom row 2
        const topCols = 3;
        const bottomCols = 2;
        const topWidth = Math.floor(width / topCols);
        const bottomWidth = Math.floor(width / bottomCols);
        const rowHeight = Math.floor(height / 2);

        // Top row
        for (let i = 0; i < topCols; i++) {
            tiles.push({
                left: left + i * topWidth,
                top: top,
                width: topWidth,
                height: rowHeight
            });
        }

        // Bottom row
        for (let i = 0; i < bottomCols; i++) {
            tiles.push({
                left: left + i * bottomWidth,
                top: top + rowHeight,
                width: bottomWidth,
                height: rowHeight
            });
        }
    }

    return tiles;
}

// ── Tab Management ───────────────────────────────────────────────────────────

async function waitForTabLoad(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error(`Tab ${tabId} load timeout`));
        }, timeoutMs);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 2000);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

// ── Prompt Injection ─────────────────────────────────────────────────────────

async function injectIntoTab(tabId, prompt) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/injector.js']
        });
    } catch (e) {
        console.log('[LLM Council] Script injection note:', e.message);
    }

    await delay(500);

    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'INJECT_PROMPT', prompt }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response?.success) {
                resolve(response);
            } else {
                reject(new Error(response?.error || 'Injection failed'));
            }
        });
    });
}

// ── Response Polling ─────────────────────────────────────────────────────────

async function waitForAllResponses(modelIds) {
    const startTime = Date.now();
    const activeModels = modelIds.filter(id =>
        councilState.responses[id].status === RESPONSE_STATUS.WAITING
    );

    while (true) {
        for (const modelId of activeModels) {
            const state = councilState.responses[modelId];
            if (state.status !== RESPONSE_STATUS.WAITING) continue;

            if (Date.now() - startTime > DEFAULTS.COUNCIL_TIMEOUT_MS) {
                state.status = RESPONSE_STATUS.TIMEOUT;
                continue;
            }

            try {
                const result = await pollTab(state.tabId);
                if (result.complete) {
                    state.status = RESPONSE_STATUS.COMPLETE;
                    state.response = result.response;
                    broadcastStatus(`${state.modelName} responded!`);
                }
            } catch (e) { /* retry next poll */ }
        }

        const remaining = activeModels.filter(id =>
            councilState.responses[id].status === RESPONSE_STATUS.WAITING
        );
        if (remaining.length === 0) break;

        if (Date.now() - startTime > DEFAULTS.COUNCIL_TIMEOUT_MS) {
            for (const id of remaining) {
                councilState.responses[id].status = RESPONSE_STATUS.TIMEOUT;
            }
            break;
        }

        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }
}

async function pollForResponse(tabId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await pollTab(tabId);
            if (result.complete && result.response) return result.response;
        } catch (e) { }
        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }
    throw new Error('Judge response timeout');
}

function pollTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_RESPONSE' }, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response || { complete: false, response: '' });
        });
    });
}

// ── Re-authenticate Judge ────────────────────────────────────────────────────

async function handleReauthJudge(sendResponse) {
    try {
        if (councilState.judgeWindowId) {
            try { await chrome.windows.remove(councilState.judgeWindowId); } catch (e) { }
        }
        const config = await chrome.storage.local.get([STORAGE_KEYS.SELECTED_JUDGE, STORAGE_KEYS.JUDGE_ISOLATION_MODE]);
        const judgeModelId = config[STORAGE_KEYS.SELECTED_JUDGE] || DEFAULTS.DEFAULT_JUDGE;
        const model = MODELS[judgeModelId];
        if (model) {
            const isIncognito = config[STORAGE_KEYS.JUDGE_ISOLATION_MODE] === JUDGE_MODE.INCOGNITO;
            const win = await chrome.windows.create({ url: model.url, incognito: isIncognito, focused: true });
            councilState.judgeTabId = win.tabs[0].id;
            councilState.judgeWindowId = win.id;
        }
        sendResponse({ success: true });
    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}

// ── Broadcasting ─────────────────────────────────────────────────────────────

function broadcastStatus(statusText) {
    chrome.runtime.sendMessage({ type: MSG.STATUS_UPDATE, status: statusText, responses: councilState.responses }).catch(() => { });
}

function broadcastError(errorText) {
    chrome.runtime.sendMessage({ type: MSG.ERROR, error: errorText }).catch(() => { });
}

function broadcastResult(judgeResult) {
    chrome.runtime.sendMessage({ type: MSG.JUDGE_RESULT, result: judgeResult }).catch(() => { });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── Keep-Alive ───────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'council-keepalive' && councilState.active) {
        console.log('[LLM Council] Keep-alive ping');
    }
});
