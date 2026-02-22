/**
 * LLM Council — Dashboard with Split-Screen Iframes
 *
 * Manages:
 * 1. Model selection grid + judge config
 * 2. On submit: creates 5 iframe panels (4 council + 1 judge) in-page
 * 3. Injects prompt into each iframe via content script messaging
 * 4. Polls for responses, then sends evaluation to judge iframe
 * 5. Parses judge result and shows results modal
 */

import { MODELS, MSG, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';
import { buildEvaluationPrompt } from '../judge/judge-engine.js';
import { parseJudgeResponse } from '../judge/judge-parser.js';

// ── DOM References ───────────────────────────────────────────────────────────

const modelsGrid = document.getElementById('models-grid');
const modelCount = document.getElementById('model-count');
const judgeSelect = document.getElementById('judge-select');
const judgeBadge = document.getElementById('judge-badge');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const btnAttach = document.getElementById('btn-attach');
const bannerClose = document.getElementById('banner-close');
const banner = document.getElementById('banner');

const mainContent = document.getElementById('main-content');
const splitScreen = document.getElementById('split-screen');
const splitTopRow = document.getElementById('split-top-row');
const splitBottomRow = document.getElementById('split-bottom-row');

const promptStatus = document.getElementById('prompt-status');
const promptStatusText = document.getElementById('prompt-status-text');

const resultsModal = document.getElementById('results-modal');
const resultsBody = document.getElementById('results-body');
const resultsClose = document.getElementById('results-close');
const resultsCloseBtn = document.getElementById('results-close-btn');
const btnCopyResults = document.getElementById('btn-copy-results');

// ── State ────────────────────────────────────────────────────────────────────

let selectedCouncil = new Set();
let selectedJudge = DEFAULTS.DEFAULT_JUDGE;
let lastResult = null;
let iframePanels = {};  // panelKey -> { iframe, frameId, panelEl, url, role, modelId }
let currentTabId = null;

// ── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    currentTabId = await getCurrentTabId();
    renderModelsGrid();
    renderJudgeDropdown();
    setupEventListeners();
    setupSidebarNav();
    updateUI();
    console.log('[LLM Council] Dashboard initialized. Tab ID:', currentTabId);
}

async function getCurrentTabId() {
    return new Promise((resolve) => {
        chrome.tabs.getCurrent((tab) => resolve(tab?.id || null));
    });
}

async function loadConfig() {
    const config = await chrome.storage.local.get([
        STORAGE_KEYS.SELECTED_COUNCIL,
        STORAGE_KEYS.SELECTED_JUDGE,
    ]);
    if (config[STORAGE_KEYS.SELECTED_COUNCIL]) selectedCouncil = new Set(config[STORAGE_KEYS.SELECTED_COUNCIL]);
    if (config[STORAGE_KEYS.SELECTED_JUDGE]) selectedJudge = config[STORAGE_KEYS.SELECTED_JUDGE];
}

async function saveConfig() {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SELECTED_COUNCIL]: [...selectedCouncil],
        [STORAGE_KEYS.SELECTED_JUDGE]: selectedJudge,
    });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderModelsGrid() {
    modelsGrid.innerHTML = '';
    for (const [id, model] of Object.entries(MODELS)) {
        const card = document.createElement('div');
        card.className = `model-card${selectedCouncil.has(id) ? ' selected' : ''}`;
        card.dataset.modelId = id;
        card.innerHTML = `
      <div class="model-checkbox-visual"></div>
      <span class="model-icon">${model.icon}</span>
      <span class="model-name">${model.name}</span>
    `;
        card.addEventListener('click', () => toggleModel(id));
        modelsGrid.appendChild(card);
    }
}

function renderJudgeDropdown() {
    judgeSelect.innerHTML = '';
    for (const [id, model] of Object.entries(MODELS)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${model.icon} ${model.name}`;
        if (id === selectedJudge) option.selected = true;
        judgeSelect.appendChild(option);
    }
}

// ── Model Selection ──────────────────────────────────────────────────────────

function toggleModel(modelId) {
    if (selectedCouncil.has(modelId)) {
        selectedCouncil.delete(modelId);
    } else {
        if (selectedCouncil.size >= DEFAULTS.MAX_COUNCIL) return;
        selectedCouncil.add(modelId);
    }
    updateUI();
    saveConfig();
}

function updateUI() {
    const count = selectedCouncil.size;
    const valid = count >= DEFAULTS.MIN_COUNCIL && count <= DEFAULTS.MAX_COUNCIL;

    modelCount.textContent = `${count} selected`;
    modelCount.className = `model-count${valid ? ' valid' : count > DEFAULTS.MAX_COUNCIL ? ' over' : ''}`;

    document.querySelectorAll('.model-card').forEach(card => {
        const id = card.dataset.modelId;
        card.classList.toggle('selected', selectedCouncil.has(id));
    });

    const jm = MODELS[selectedJudge];
    if (jm) judgeBadge.textContent = jm.name;

    btnSend.disabled = !valid || !promptInput.value.trim();
}

// ── Sidebar Navigation ──────────────────────────────────────────────────────

function setupSidebarNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewName = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById(`view-${viewName}`);
            if (target) target.classList.add('active');
            splitScreen.style.display = 'none';
        });
    });
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    promptInput.addEventListener('input', updateUI);

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btnSend.disabled) {
            e.preventDefault();
            handleSubmit();
        }
    });

    btnSend.addEventListener('click', handleSubmit);

    // File upload
    if (btnAttach) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json';
        fileInput.style.display = 'none';
        fileInput.multiple = true;
        document.body.appendChild(fileInput);

        btnAttach.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const files = [...e.target.files];
            if (files.length === 0) return;

            const names = files.map(f => f.name).join(', ');
            const currentPrompt = promptInput.value.trim();
            promptInput.value = currentPrompt
                ? `${currentPrompt}\n\n[Attached: ${names}]`
                : `[Attached: ${names}]`;
            promptInput.focus();
            updateUI();

            // Read file contents for text files
            files.forEach(file => {
                if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.json') || file.name.endsWith('.csv')) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const content = ev.target.result;
                        promptInput.value += `\n\n--- ${file.name} ---\n${content}`;
                        updateUI();
                    };
                    reader.readAsText(file);
                }
            });

            fileInput.value = ''; // reset
        });
    }

    judgeSelect.addEventListener('change', () => {
        selectedJudge = judgeSelect.value;
        updateUI();
        saveConfig();
    });

    bannerClose?.addEventListener('click', () => banner.classList.add('hidden'));

    document.querySelectorAll('.template-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const current = promptInput.value.trim();
            const tmpl = tag.dataset.template;
            promptInput.value = current ? `${current} ${tmpl}` : tmpl;
            promptInput.focus();
            updateUI();
        });
    });

    resultsClose?.addEventListener('click', () => resultsModal.style.display = 'none');
    resultsCloseBtn?.addEventListener('click', () => resultsModal.style.display = 'none');
    btnCopyResults?.addEventListener('click', copyResults);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBMIT — Create split screen with iframes
// ══════════════════════════════════════════════════════════════════════════════

async function handleSubmit() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const councilIds = [...selectedCouncil];
    if (councilIds.length < DEFAULTS.MIN_COUNCIL) return;

    // Switch to split-screen view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    splitScreen.style.display = 'flex';

    showStatus('Loading AI sites...');

    // Build the panel list: councils first, then judge
    const panels = [
        ...councilIds.map(id => ({ id, role: 'council' })),
        { id: selectedJudge, role: 'judge' }
    ];

    // Create iframe panels (NO sandbox attribute)
    createIframePanels(panels);

    // Wait for iframes to load
    showStatus('Waiting for sites to load...');
    await waitForIframeLoads(panels);

    // Discover frame IDs (with retry)
    showStatus('Connecting to AI sites...');
    await discoverFrameIds();

    // Log frame discovery results
    for (const [key, panel] of Object.entries(iframePanels)) {
        console.log(`[LLM Council] Panel ${key}: frameId=${panel.frameId}, url=${panel.url}`);
    }

    // Inject prompt into council iframes
    showStatus('Sending prompt to council...');
    const councilResponses = {};

    for (const councilId of councilIds) {
        const panel = iframePanels[councilId];
        if (!panel || !panel.frameId) {
            console.warn(`[LLM Council] No frameId for ${councilId}, retrying discovery...`);
            await delay(2000);
            await discoverFrameIds(); // retry once
            if (!panel?.frameId) {
                updatePanelStatus(councilId, '❌ No connection');
                continue;
            }
        }

        updatePanelStatus(councilId, '⏳ Injecting...');
        try {
            await injectAndSend(panel.frameId, prompt);
            updatePanelStatus(councilId, '⏳ Waiting...');
        } catch (e) {
            console.error(`[LLM Council] Inject failed for ${councilId}:`, e);
            updatePanelStatus(councilId, '❌ Failed');
        }

        // Delay between injections to prevent race conditions
        await delay(DEFAULTS.INJECTION_DELAY_MS);
    }

    // Poll for council responses
    showStatus('Waiting for council responses...');
    await pollForCouncilResponses(councilIds, councilResponses);

    // Build evaluation prompt
    const responsesArray = councilIds.map(id => ({
        modelName: MODELS[id]?.name || id,
        status: councilResponses[id] ? 'complete' : 'failed',
        response: councilResponses[id] || null,
    }));

    const completedResponses = responsesArray.filter(r => r.status === 'complete');

    if (completedResponses.length === 0) {
        showStatus('All councils failed. No evaluation possible.');
        hideStatusAfterDelay(5000);
        return;
    }

    // Send evaluation to judge
    const judgeKey = `judge-${selectedJudge}`;
    const judgePanel = iframePanels[judgeKey];
    showStatus('Sending evaluation to Judge...');

    if (judgePanel && judgePanel.frameId) {
        const evalPrompt = buildEvaluationPrompt(prompt, responsesArray);
        updatePanelStatus(judgeKey, '⏳ Evaluating...');
        try {
            await injectAndSend(judgePanel.frameId, evalPrompt);
        } catch (e) {
            console.error('[LLM Council] Judge inject failed:', e);
            updatePanelStatus(judgeKey, '❌ Failed');
            showStatus('Judge injection failed.');
            return;
        }

        showStatus('Waiting for Judge verdict...');
        const judgeResponse = await pollFrameForResponse(judgePanel.frameId, DEFAULTS.JUDGE_TIMEOUT_MS);

        if (judgeResponse) {
            const modelNames = completedResponses.map(r => r.modelName);
            const judgeResult = parseJudgeResponse(judgeResponse, modelNames);
            lastResult = judgeResult;
            updatePanelStatus(judgeKey, '✅ Done');
            showStatus('Evaluation complete!');
            hideStatusAfterDelay(2000);
            showResults(judgeResult);
        } else {
            updatePanelStatus(judgeKey, '⏰ Timeout');
            showStatus('Judge timed out.');
            hideStatusAfterDelay(3000);
        }
    } else {
        showStatus('Judge frame not found.');
        hideStatusAfterDelay(3000);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// IFRAME PANEL CREATION — NO SANDBOX
// ══════════════════════════════════════════════════════════════════════════════

function createIframePanels(panels) {
    splitTopRow.innerHTML = '';
    splitBottomRow.innerHTML = '';
    iframePanels = {};

    // Add back button
    let backBtn = document.querySelector('.btn-back');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.className = 'btn-back';
        backBtn.textContent = '← Back to Home';
        backBtn.addEventListener('click', goBackToHome);
        document.body.appendChild(backBtn);
    }

    const topCount = Math.min(3, panels.length);
    const topPanels = panels.slice(0, topCount);
    const bottomPanels = panels.slice(topCount);

    topPanels.forEach(p => splitTopRow.appendChild(createSinglePanel(p)));
    bottomPanels.forEach(p => splitBottomRow.appendChild(createSinglePanel(p)));
}

function createSinglePanel({ id, role }) {
    const model = MODELS[id];
    const panelKey = role === 'judge' ? `judge-${id}` : id;
    const icon = model?.icon || '🤖';
    const name = model?.name || id;
    const url = model?.url || '#';

    const panel = document.createElement('div');
    panel.className = 'iframe-panel';
    panel.id = `panel-${panelKey}`;

    // NO sandbox attribute — let AI sites run freely
    panel.innerHTML = `
    <div class="iframe-panel-header">
      <span class="iframe-panel-icon">${icon}</span>
      <span class="iframe-panel-name">${name}</span>
      <span class="iframe-panel-badge ${role}">${role === 'judge' ? 'JUDGE' : 'COUNCIL'}</span>
      <span class="iframe-panel-status" id="status-${panelKey}">Loading...</span>
    </div>
    <iframe src="${url}" id="iframe-${panelKey}" allow="clipboard-read; clipboard-write"></iframe>
    <div class="iframe-panel-loading" id="loading-${panelKey}">
      <div class="spinner"></div>
    </div>
  `;

    iframePanels[panelKey] = {
        iframe: null,
        frameId: null,
        panelEl: panel,
        url: url,
        role: role,
        modelId: id,
    };

    return panel;
}

function goBackToHome() {
    // Remove all iframes to free resources
    splitTopRow.innerHTML = '';
    splitBottomRow.innerHTML = '';
    iframePanels = {};

    splitScreen.style.display = 'none';
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.view === 'home');
    });
    document.getElementById('view-home').classList.add('active');
    const backBtn = document.querySelector('.btn-back');
    if (backBtn) backBtn.remove();
}

// ══════════════════════════════════════════════════════════════════════════════
// IFRAME LOADING & FRAME DISCOVERY
// ══════════════════════════════════════════════════════════════════════════════

async function waitForIframeLoads(panels) {
    const loadPromises = panels.map(p => {
        const panelKey = p.role === 'judge' ? `judge-${p.id}` : p.id;
        const iframe = document.getElementById(`iframe-${panelKey}`);

        if (!iframe) return Promise.resolve();
        iframePanels[panelKey].iframe = iframe;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn(`[LLM Council] Iframe load timeout for ${panelKey}`);
                updatePanelStatus(panelKey, 'Loaded (timeout)');
                hideLoading(panelKey);
                resolve();
            }, 25000);

            iframe.addEventListener('load', () => {
                clearTimeout(timeout);
                console.log(`[LLM Council] Iframe loaded: ${panelKey}`);
                updatePanelStatus(panelKey, 'Loaded');
                hideLoading(panelKey);
                resolve();
            }, { once: true });
        });
    });

    await Promise.all(loadPromises);
    // Extra wait for page JS to settle (React hydration, etc.)
    await delay(5000);
}

function hideLoading(panelKey) {
    const loader = document.getElementById(`loading-${panelKey}`);
    if (loader) loader.style.display = 'none';
}

/**
 * Discover frameIds by matching iframe URLs to panel URLs.
 * Uses matchPatterns from MODELS for more reliable matching.
 */
async function discoverFrameIds() {
    if (!currentTabId) {
        console.error('[LLM Council] No current tab ID — cannot discover frames');
        return;
    }

    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        if (!frames) {
            console.error('[LLM Council] No frames returned');
            return;
        }

        console.log(`[LLM Council] Found ${frames.length} frames total`);

        for (const frame of frames) {
            if (frame.frameId === 0) continue; // skip main frame (our dashboard)
            if (!frame.url || frame.url === 'about:blank') continue;

            console.log(`[LLM Council] Frame ${frame.frameId}: ${frame.url}`);

            for (const [panelKey, panel] of Object.entries(iframePanels)) {
                if (panel.frameId) continue; // already discovered

                const model = MODELS[panel.modelId];
                if (!model) continue;

                // Match using model's matchPatterns
                const matchPatterns = model.matchPatterns || [];
                const frameUrl = frame.url.toLowerCase();

                let matched = false;
                for (const pattern of matchPatterns) {
                    if (frameUrl.includes(pattern.toLowerCase())) {
                        matched = true;
                        break;
                    }
                }

                // Also try matching by panel URL domain
                if (!matched) {
                    try {
                        const panelHost = new URL(panel.url).hostname;
                        const frameHost = new URL(frame.url).hostname;
                        if (frameHost === panelHost || frameHost.endsWith('.' + panelHost) || panelHost.endsWith('.' + frameHost)) {
                            matched = true;
                        }
                    } catch (e) { /* ignore */ }
                }

                if (matched) {
                    panel.frameId = frame.frameId;
                    updatePanelStatus(panelKey, '🟢 Connected');
                    console.log(`[LLM Council] ✓ Matched panel ${panelKey} → frame ${frame.frameId}`);
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[LLM Council] Frame discovery error:', e);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTENT SCRIPT INJECTION & MESSAGING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Inject content script & send prompt to a frame.
 * Retries injection up to 3 times with increasing delay.
 */
async function injectAndSend(frameId, prompt) {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Try to inject the content script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: currentTabId, frameIds: [frameId] },
                files: ['content-scripts/injector.js']
            });
            console.log(`[LLM Council] Content script injected into frame ${frameId} (attempt ${attempt})`);
        } catch (e) {
            console.warn(`[LLM Council] Script injection attempt ${attempt}: ${e.message}`);
        }

        // Wait for script to initialize
        await delay(1000 * attempt);

        // Try to send the message
        try {
            const response = await sendMessageToFrame(frameId, { type: 'INJECT_PROMPT', prompt });
            if (response?.success) {
                console.log(`[LLM Council] ✓ Prompt sent to frame ${frameId}`);
                return response;
            } else {
                console.warn(`[LLM Council] Frame ${frameId} response:`, response);
                if (attempt < MAX_RETRIES) continue;
                throw new Error(response?.error || 'Injection returned failure');
            }
        } catch (e) {
            console.warn(`[LLM Council] Send attempt ${attempt} failed:`, e.message);
            if (attempt === MAX_RETRIES) throw e;
            await delay(2000);
        }
    }
}

function sendMessageToFrame(frameId, message) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(currentTabId, message, { frameId }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function extractFromFrame(frameId) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.sendMessage(currentTabId, { type: 'EXTRACT_RESPONSE' }, { frameId }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ complete: false, response: '' });
                } else {
                    resolve(response || { complete: false, response: '' });
                }
            });
        } catch (e) {
            resolve({ complete: false, response: '' });
        }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE POLLING
// ══════════════════════════════════════════════════════════════════════════════

async function pollForCouncilResponses(councilIds, responses) {
    const startTime = Date.now();
    const pending = new Set(councilIds.filter(id => iframePanels[id]?.frameId));

    while (pending.size > 0 && (Date.now() - startTime) < DEFAULTS.COUNCIL_TIMEOUT_MS) {
        for (const id of [...pending]) {
            const panel = iframePanels[id];
            if (!panel?.frameId) {
                pending.delete(id);
                continue;
            }

            try {
                const result = await extractFromFrame(panel.frameId);
                if (result.complete && result.response) {
                    responses[id] = result.response;
                    pending.delete(id);
                    updatePanelStatus(id, '✅ Done');
                    showStatus(`${MODELS[id]?.name || id} responded! (${pending.size} remaining)`);
                }
            } catch (e) { /* retry next cycle */ }
        }

        if (pending.size > 0) await delay(DEFAULTS.POLL_INTERVAL_MS);
    }

    for (const id of pending) {
        updatePanelStatus(id, '⏰ Timeout');
    }
}

async function pollFrameForResponse(frameId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await extractFromFrame(frameId);
            if (result.complete && result.response) return result.response;
        } catch (e) { /* retry */ }
        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function updatePanelStatus(panelKey, text) {
    const el = document.getElementById(`status-${panelKey}`);
    if (el) el.textContent = text;
}

function showStatus(text) {
    promptStatus.style.display = 'flex';
    promptStatusText.textContent = text;
}

function hideStatusAfterDelay(ms) {
    setTimeout(() => { promptStatus.style.display = 'none'; }, ms);
}

// ── Results ──────────────────────────────────────────────────────────────────

function showResults(result) {
    resultsBody.innerHTML = '';

    if (result.parsed && result.scores.length > 0) {
        if (result.winner) {
            const wd = result.scores.find(s => s.modelName === result.winner);
            resultsBody.innerHTML += `
        <div class="result-winner">
          <span class="result-winner-trophy">🏆</span>
          <div class="result-winner-info">
            <span class="result-winner-label">Winner</span>
            <span class="result-winner-name">${result.winner} — ${wd ? wd.total + '/50' : ''}</span>
          </div>
        </div>
      `;
        }

        const sorted = [...result.scores].sort((a, b) => b.total - a.total);
        for (const score of sorted) {
            const model = Object.values(MODELS).find(m => m.name === score.modelName);
            resultsBody.innerHTML += `
        <div class="result-score-card">
          <div class="result-score-header">
            <span class="result-score-model">${model?.icon || '🤖'} ${score.modelName}</span>
            <span class="result-score-total">${score.total}/50</span>
          </div>
          <div class="result-criteria">
            <div class="result-criterion"><div class="result-criterion-label">Acc</div><div class="result-criterion-score">${score.accuracy}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Dep</div><div class="result-criterion-score">${score.depth}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Cla</div><div class="result-criterion-score">${score.clarity}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rea</div><div class="result-criterion-score">${score.reasoning}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rel</div><div class="result-criterion-score">${score.relevance}</div></div>
          </div>
          ${score.justification ? `<div class="result-justification">"${score.justification}"</div>` : ''}
        </div>
      `;
        }
    } else {
        resultsBody.innerHTML = `<div class="result-raw">${result.rawText || 'No response received.'}</div>`;
    }

    resultsModal.style.display = 'flex';
}

function copyResults() {
    if (!lastResult) return;
    let text = '📊 LLM Council Evaluation\n\n';
    if (lastResult.parsed) {
        if (lastResult.winner) text += `🏆 Winner: ${lastResult.winner}\n\n`;
        for (const s of lastResult.scores) {
            text += `${s.modelName}: ${s.total}/50 (Acc:${s.accuracy} Dep:${s.depth} Cla:${s.clarity} Rea:${s.reasoning} Rel:${s.relevance})\n`;
            if (s.justification) text += `  "${s.justification}"\n`;
        }
    } else {
        text += lastResult.rawText || 'No results.';
    }
    navigator.clipboard.writeText(text).then(() => {
        btnCopyResults.textContent = '✅ Copied!';
        setTimeout(() => btnCopyResults.textContent = '📋 Copy', 2000);
    });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ─────────────────────────────────────────────────────────────────────

init();
