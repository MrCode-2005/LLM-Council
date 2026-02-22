/**
 * LLM Council — Background Service Worker
 *
 * Orchestrates the entire council→judge pipeline:
 * 1. Opens/finds tabs for council models
 * 2. Injects prompts into council models
 * 3. Polls for response completion
 * 4. Builds evaluation prompt
 * 5. Opens judge in isolated context
 * 6. Injects evaluation prompt into judge
 * 7. Extracts and parses judge result
 */

import { MODELS, MSG, RESPONSE_STATUS, JUDGE_MODE, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';
import { buildEvaluationPrompt } from '../judge/judge-engine.js';
import { parseJudgeResponse } from '../judge/judge-parser.js';

// ── State ────────────────────────────────────────────────────────────────────

let councilState = {
    active: false,
    prompt: '',
    models: [],
    responses: {},   // modelId → { tabId, status, response, modelName }
    judgeModelId: null,
    judgeTabId: null,
    judgeWindowId: null
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

    // Reset state
    councilState = {
        active: true,
        prompt,
        models: councilModels,
        responses: {},
        judgeModelId: judgeModel,
        judgeTabId: null,
        judgeWindowId: null
    };

    // Initialize response tracking
    for (const modelId of councilModels) {
        councilState.responses[modelId] = {
            tabId: null,
            status: RESPONSE_STATUS.PENDING,
            response: null,
            modelName: MODELS[modelId]?.name || modelId
        };
    }

    sendResponse({ success: true, message: 'Council pipeline started' });
    broadcastStatus('Council pipeline started. Opening model tabs...');

    try {
        // Step 1: Open/find tabs for each council model (NOT judge!)
        await openCouncilTabs(councilModels);

        // Step 2: Inject prompts with delay between each
        await injectPromptsSequentially(prompt, councilModels);

        // Step 3: Poll for all responses
        await waitForAllResponses(councilModels);

        // Step 4: Build evaluation prompt
        const responsesArray = councilModels.map(id => councilState.responses[id]);
        const completedResponses = responsesArray.filter(r => r.status === RESPONSE_STATUS.COMPLETE);

        if (completedResponses.length === 0) {
            broadcastStatus('All council models failed. Cannot invoke Judge.');
            broadcastError('No council responses received. Judge evaluation skipped.');
            councilState.active = false;
            return;
        }

        const evalPrompt = buildEvaluationPrompt(prompt, responsesArray);
        broadcastStatus('All responses collected. Invoking Judge...');

        // Step 5: Open judge in isolated context
        const judgeTabId = await openJudgeTab(councilState.judgeModelId, judgeMode);
        councilState.judgeTabId = judgeTabId;

        // Step 6: Inject evaluation prompt into judge
        await injectIntoTab(judgeTabId, evalPrompt);
        broadcastStatus('Evaluation prompt sent to Judge. Waiting for verdict...');

        // Step 7: Wait for judge response
        const judgeResponse = await pollForResponse(judgeTabId, DEFAULTS.JUDGE_TIMEOUT_MS);

        // Step 8: Parse judge response
        const modelNames = completedResponses.map(r => r.modelName);
        const judgeResult = parseJudgeResponse(judgeResponse, modelNames);

        // Step 9: Send results
        broadcastResult(judgeResult);
        broadcastStatus('Evaluation complete!');

    } catch (error) {
        console.error('[LLM Council] Pipeline error:', error);
        broadcastError(error.message);
    } finally {
        councilState.active = false;
    }
}

// ── Tab Management ───────────────────────────────────────────────────────────

async function openCouncilTabs(modelIds) {
    for (const modelId of modelIds) {
        const model = MODELS[modelId];
        if (!model) continue;

        try {
            // Look for existing tab
            const existingTab = await findTabForModel(model);

            if (existingTab) {
                councilState.responses[modelId].tabId = existingTab.id;
            } else {
                // Open new tab
                const tab = await chrome.tabs.create({ url: model.url, active: false });
                councilState.responses[modelId].tabId = tab.id;
                // Wait for the tab to load
                await waitForTabLoad(tab.id);
            }
        } catch (e) {
            console.error(`[LLM Council] Failed to open tab for ${modelId}:`, e);
            councilState.responses[modelId].status = RESPONSE_STATUS.FAILED;
        }
    }
}

async function findTabForModel(model) {
    const tabs = await chrome.tabs.query({});
    return tabs.find(tab =>
        model.matchPatterns.some(pattern => tab.url?.includes(pattern))
    );
}

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
                // Additional delay for JS frameworks to initialize
                setTimeout(resolve, 2000);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function openJudgeTab(judgeModelId, judgeMode) {
    const model = MODELS[judgeModelId];
    if (!model) throw new Error(`Unknown judge model: ${judgeModelId}`);

    const mode = judgeMode || JUDGE_MODE.INCOGNITO;

    if (mode === JUDGE_MODE.INCOGNITO) {
        // Open in incognito window
        const window = await chrome.windows.create({
            url: model.url,
            incognito: true,
            focused: false
        });
        councilState.judgeWindowId = window.id;
        const tabId = window.tabs[0].id;
        await waitForTabLoad(tabId);
        return tabId;
    }

    if (mode === JUDGE_MODE.SEPARATE_WINDOW) {
        // Open in a separate normal window
        const window = await chrome.windows.create({
            url: model.url,
            focused: false
        });
        councilState.judgeWindowId = window.id;
        const tabId = window.tabs[0].id;
        await waitForTabLoad(tabId);
        return tabId;
    }

    // Same session — just open a new tab (or find existing)
    const existingTab = await findTabForModel(model);
    if (existingTab) return existingTab.id;

    const tab = await chrome.tabs.create({ url: model.url, active: false });
    await waitForTabLoad(tab.id);
    return tab.id;
}

// ── Prompt Injection ─────────────────────────────────────────────────────────

async function injectPromptsSequentially(prompt, modelIds) {
    for (const modelId of modelIds) {
        const state = councilState.responses[modelId];
        if (state.status === RESPONSE_STATUS.FAILED) continue;

        state.status = RESPONSE_STATUS.INJECTING;
        broadcastStatus(`Injecting prompt into ${state.modelName}...`);

        try {
            await injectIntoTab(state.tabId, prompt);
            state.status = RESPONSE_STATUS.WAITING;
        } catch (e) {
            console.error(`[LLM Council] Injection failed for ${modelId}:`, e);
            state.status = RESPONSE_STATUS.FAILED;
        }

        // Delay between injections to avoid overwhelming
        if (modelIds.indexOf(modelId) < modelIds.length - 1) {
            await delay(DEFAULTS.INJECTION_DELAY_MS);
        }
    }
}

async function injectIntoTab(tabId, prompt) {
    // Ensure content script is injected
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/injector.js']
        });
    } catch (e) {
        // Script might already be loaded — that's fine
        console.log('[LLM Council] Script injection note:', e.message);
    }

    // Wait a moment for script init
    await delay(500);

    // Send the prompt
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
            type: 'INJECT_PROMPT',
            prompt
        }, (response) => {
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

    broadcastStatus(`Waiting for ${activeModels.length} council responses...`);

    while (true) {
        let allDone = true;

        for (const modelId of activeModels) {
            const state = councilState.responses[modelId];
            if (state.status !== RESPONSE_STATUS.WAITING) continue;

            allDone = false;

            // Check timeout
            if (Date.now() - startTime > DEFAULTS.COUNCIL_TIMEOUT_MS) {
                state.status = RESPONSE_STATUS.TIMEOUT;
                state.response = null;
                continue;
            }

            // Poll the tab
            try {
                const result = await pollTab(state.tabId);
                if (result.complete) {
                    state.status = RESPONSE_STATUS.COMPLETE;
                    state.response = result.response;
                    broadcastStatus(`${state.modelName} responded! Waiting for others...`);
                }
            } catch (e) {
                console.error(`[LLM Council] Poll error for ${modelId}:`, e);
                // Don't fail immediately — retry on next poll
            }
        }

        // Check if all are done
        const remaining = activeModels.filter(id =>
            councilState.responses[id].status === RESPONSE_STATUS.WAITING
        );
        if (remaining.length === 0) break;

        // Check overall timeout
        if (Date.now() - startTime > DEFAULTS.COUNCIL_TIMEOUT_MS) {
            for (const id of remaining) {
                councilState.responses[id].status = RESPONSE_STATUS.TIMEOUT;
            }
            break;
        }

        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }

    // Summary
    const complete = activeModels.filter(id => councilState.responses[id].status === RESPONSE_STATUS.COMPLETE);
    const failed = activeModels.filter(id => councilState.responses[id].status !== RESPONSE_STATUS.COMPLETE);

    broadcastStatus(`${complete.length} responses received. ${failed.length} failed/timed out.`);
}

async function pollForResponse(tabId, timeoutMs) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        try {
            const result = await pollTab(tabId);
            if (result.complete && result.response) {
                return result.response;
            }
        } catch (e) {
            console.warn('[LLM Council] Judge poll error:', e.message);
        }
        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }

    throw new Error('Judge response timeout');
}

function pollTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_RESPONSE' }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response || { complete: false, response: '' });
            }
        });
    });
}

// ── Re-authenticate Judge ────────────────────────────────────────────────────

async function handleReauthJudge(sendResponse) {
    try {
        // Close existing judge window
        if (councilState.judgeWindowId) {
            try { await chrome.windows.remove(councilState.judgeWindowId); } catch (e) { /* ok */ }
        }

        // Get judge config
        const config = await chrome.storage.local.get([STORAGE_KEYS.SELECTED_JUDGE, STORAGE_KEYS.JUDGE_ISOLATION_MODE]);
        const judgeModelId = config[STORAGE_KEYS.SELECTED_JUDGE] || 'chatgpt';
        const judgeMode = config[STORAGE_KEYS.JUDGE_ISOLATION_MODE] || JUDGE_MODE.INCOGNITO;

        const tabId = await openJudgeTab(judgeModelId, judgeMode);
        councilState.judgeTabId = tabId;

        // Focus the judge window
        if (councilState.judgeWindowId) {
            await chrome.windows.update(councilState.judgeWindowId, { focused: true });
        }

        sendResponse({ success: true });
    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}

// ── Broadcasting (Service Worker → Popup) ────────────────────────────────────

function broadcastStatus(statusText) {
    chrome.runtime.sendMessage({
        type: MSG.STATUS_UPDATE,
        status: statusText,
        responses: councilState.responses
    }).catch(() => { /* popup might be closed */ });
}

function broadcastError(errorText) {
    chrome.runtime.sendMessage({
        type: MSG.ERROR,
        error: errorText
    }).catch(() => { });
}

function broadcastResult(judgeResult) {
    chrome.runtime.sendMessage({
        type: MSG.JUDGE_RESULT,
        result: judgeResult
    }).catch(() => { });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Keep-Alive ───────────────────────────────────────────────────────────────

// MV3 service workers can go idle. Use alarms to keep alive during pipeline.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'council-keepalive' && councilState.active) {
        console.log('[LLM Council] Keep-alive ping');
    }
});

function startKeepAlive() {
    chrome.alarms.create('council-keepalive', { periodInMinutes: 0.4 });
}

function stopKeepAlive() {
    chrome.alarms.clear('council-keepalive');
}
