/**
 * LLM Council — Dashboard with Split-Screen Iframes
 *
 * Features:
 * - Collapsible sidebar for maximum space
 * - Side-by-side resizable iframe panels with drag handles
 * - Resilient pipeline: skip failed models, proceed with whatever works
 * - File upload support
 * - Retry logic for content script injection
 */

import { MODELS, MSG, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';
import { buildEvaluationPrompt } from '../judge/judge-engine.js';
import { parseJudgeResponse } from '../judge/judge-parser.js';

// ── DOM References ───────────────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const modelsGrid = document.getElementById('models-grid');
const modelCount = document.getElementById('model-count');
const judgeSelect = document.getElementById('judge-select');
const judgeBadge = document.getElementById('judge-badge');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const btnAttach = document.getElementById('btn-attach');
const promptBar = document.getElementById('prompt-bar');
const bannerClose = document.getElementById('banner-close');
const banner = document.getElementById('banner');

const mainContent = document.getElementById('main-content');
const splitScreen = document.getElementById('split-screen');
const splitPanels = document.getElementById('split-panels');

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
let iframePanels = {};   // panelKey -> { iframe, frameId, panelEl, url, role, modelId, failed }
let currentTabId = null;
let sidebarCollapsed = false;
let expandBtn = null;    // floating expand button

// ── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    currentTabId = await getCurrentTabId();
    renderModelsGrid();
    renderJudgeDropdown();
    setupEventListeners();
    setupSidebarNav();
    setupSidebarToggle();
    updateUI();
    console.log('[LLM Council] Dashboard ready. Tab:', currentTabId);
}

async function getCurrentTabId() {
    return new Promise(r => chrome.tabs.getCurrent(t => r(t?.id || null)));
}

async function loadConfig() {
    const c = await chrome.storage.local.get([STORAGE_KEYS.SELECTED_COUNCIL, STORAGE_KEYS.SELECTED_JUDGE]);
    if (c[STORAGE_KEYS.SELECTED_COUNCIL]) selectedCouncil = new Set(c[STORAGE_KEYS.SELECTED_COUNCIL]);
    if (c[STORAGE_KEYS.SELECTED_JUDGE]) selectedJudge = c[STORAGE_KEYS.SELECTED_JUDGE];
}

async function saveConfig() {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SELECTED_COUNCIL]: [...selectedCouncil],
        [STORAGE_KEYS.SELECTED_JUDGE]: selectedJudge,
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR — Collapsible
// ══════════════════════════════════════════════════════════════════════════════

function setupSidebarToggle() {
    // Create floating expand button (hidden initially)
    expandBtn = document.createElement('button');
    expandBtn.className = 'sidebar-expand-btn hidden';
    expandBtn.textContent = '☰';
    expandBtn.title = 'Expand sidebar';
    expandBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(expandBtn);

    sidebarToggle?.addEventListener('click', toggleSidebar);
}

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.body.classList.toggle('sidebar-hidden', sidebarCollapsed);
    expandBtn.classList.toggle('hidden', !sidebarCollapsed);
}

// Auto-collapse sidebar when split-screen is shown
function collapseSidebar() {
    if (!sidebarCollapsed) {
        sidebarCollapsed = true;
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-hidden');
        expandBtn.classList.remove('hidden');
    }
}

function expandSidebar() {
    if (sidebarCollapsed) {
        sidebarCollapsed = false;
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-hidden');
        expandBtn.classList.add('hidden');
    }
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
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${model.icon} ${model.name}`;
        if (id === selectedJudge) opt.selected = true;
        judgeSelect.appendChild(opt);
    }
}

// ── Model Selection ──────────────────────────────────────────────────────────

function toggleModel(id) {
    if (selectedCouncil.has(id)) selectedCouncil.delete(id);
    else if (selectedCouncil.size < DEFAULTS.MAX_COUNCIL) selectedCouncil.add(id);
    updateUI();
    saveConfig();
}

function updateUI() {
    const n = selectedCouncil.size;
    const ok = n >= DEFAULTS.MIN_COUNCIL && n <= DEFAULTS.MAX_COUNCIL;
    modelCount.textContent = `${n} selected`;
    modelCount.className = `model-count${ok ? ' valid' : n > DEFAULTS.MAX_COUNCIL ? ' over' : ''}`;
    document.querySelectorAll('.model-card').forEach(c => c.classList.toggle('selected', selectedCouncil.has(c.dataset.modelId)));
    const jm = MODELS[selectedJudge];
    if (jm) judgeBadge.textContent = jm.name;
    btnSend.disabled = !ok || !promptInput.value.trim();
}

// ── Sidebar Navigation ──────────────────────────────────────────────────────

function setupSidebarNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const v = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(vw => vw.classList.remove('active'));
            const target = document.getElementById(`view-${v}`);
            if (target) target.classList.add('active');
            splitScreen.style.display = 'none';
        });
    });
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    promptInput.addEventListener('input', updateUI);
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btnSend.disabled) { e.preventDefault(); handleSubmit(); }
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
            if (!files.length) return;
            const names = files.map(f => f.name).join(', ');
            const cur = promptInput.value.trim();
            promptInput.value = cur ? `${cur}\n[Attached: ${names}]` : `[Attached: ${names}]`;
            files.forEach(f => {
                if (f.type.startsWith('text/') || /\.(md|json|csv|txt)$/.test(f.name)) {
                    const reader = new FileReader();
                    reader.onload = ev => { promptInput.value += `\n--- ${f.name} ---\n${ev.target.result}`; updateUI(); };
                    reader.readAsText(f);
                }
            });
            updateUI();
            fileInput.value = '';
        });
    }

    judgeSelect.addEventListener('change', () => { selectedJudge = judgeSelect.value; updateUI(); saveConfig(); });
    bannerClose?.addEventListener('click', () => banner.classList.add('hidden'));

    document.querySelectorAll('.template-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const c = promptInput.value.trim(), t = tag.dataset.template;
            promptInput.value = c ? `${c} ${t}` : t;
            promptInput.focus(); updateUI();
        });
    });

    resultsClose?.addEventListener('click', () => resultsModal.style.display = 'none');
    resultsCloseBtn?.addEventListener('click', () => resultsModal.style.display = 'none');
    btnCopyResults?.addEventListener('click', copyResults);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBMIT — RESILIENT PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

async function handleSubmit() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    const councilIds = [...selectedCouncil];
    if (councilIds.length < DEFAULTS.MIN_COUNCIL) return;

    // Collapse sidebar & switch to split view
    collapseSidebar();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    splitScreen.style.display = 'flex';

    showStatus('Loading AI sites...');

    const panels = [
        ...councilIds.map(id => ({ id, role: 'council' })),
        { id: selectedJudge, role: 'judge' }
    ];

    createResizablePanels(panels);

    // Wait for loads — detect which ones fail early
    showStatus('Waiting for sites to load...');
    await waitForIframeLoads(panels);

    // Discover frames
    showStatus('Connecting to AI sites...');
    await discoverFrameIds();

    // Retry discovery after a short delay for slow-loading sites
    await delay(2000);
    await discoverFrameIds();

    // Log state
    for (const [k, p] of Object.entries(iframePanels)) {
        console.log(`[LLM Council] ${k}: frameId=${p.frameId}, failed=${p.failed}`);
    }

    // ── Inject prompt into councils (skip failed ones) ──
    showStatus('Sending prompt to council...');
    const councilResponses = {};
    let injectedCount = 0;

    for (const cid of councilIds) {
        const panel = iframePanels[cid];

        // Skip if iframe failed to load or no frame discovered
        if (!panel || panel.failed) {
            console.warn(`[LLM Council] Skipping ${cid} — iframe failed to load`);
            updatePanelStatus(cid, '⛔ Skipped');
            continue;
        }

        if (!panel.frameId) {
            console.warn(`[LLM Council] Skipping ${cid} — no frame connection`);
            updatePanelStatus(cid, '❌ No connection');
            continue;
        }

        updatePanelStatus(cid, '⏳ Injecting...');
        try {
            await injectAndSend(panel.frameId, prompt);
            updatePanelStatus(cid, '⏳ Waiting...');
            injectedCount++;
        } catch (e) {
            console.error(`[LLM Council] Inject failed for ${cid}:`, e);
            updatePanelStatus(cid, '❌ Failed');
        }

        await delay(DEFAULTS.INJECTION_DELAY_MS);
    }

    if (injectedCount === 0) {
        showStatus('No models accepted the prompt. Check console for errors.');
        hideStatusAfterDelay(5000);
        return;
    }

    // ── Poll council responses (only for successfully injected) ──
    showStatus(`Waiting for ${injectedCount} council responses...`);
    await pollForCouncilResponses(councilIds, councilResponses);

    // ── Build evaluation ──
    const responsesArray = councilIds.map(id => ({
        modelName: MODELS[id]?.name || id,
        status: councilResponses[id] ? 'complete' : 'failed',
        response: councilResponses[id] || null,
    }));

    const completed = responsesArray.filter(r => r.status === 'complete');

    if (completed.length === 0) {
        showStatus('No council responses received.');
        hideStatusAfterDelay(5000);
        return;
    }

    // ── Judge evaluation ──
    const judgeKey = `judge-${selectedJudge}`;
    const judgePanel = iframePanels[judgeKey];

    if (!judgePanel || judgePanel.failed || !judgePanel.frameId) {
        showStatus(`Judge (${MODELS[selectedJudge]?.name}) unavailable. Showing raw responses.`);
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        hideStatusAfterDelay(3000);
        return;
    }

    showStatus('Sending evaluation to Judge...');
    const evalPrompt = buildEvaluationPrompt(prompt, responsesArray);

    try {
        await injectAndSend(judgePanel.frameId, evalPrompt);
        updatePanelStatus(judgeKey, '⏳ Evaluating...');
    } catch (e) {
        console.error('[LLM Council] Judge inject failed:', e);
        updatePanelStatus(judgeKey, '❌ Failed');
        showStatus('Judge injection failed. Showing raw responses.');
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        return;
    }

    showStatus('Waiting for Judge verdict...');
    const judgeResponse = await pollFrameForResponse(judgePanel.frameId, DEFAULTS.JUDGE_TIMEOUT_MS);

    if (judgeResponse) {
        const modelNames = completed.map(r => r.modelName);
        const judgeResult = parseJudgeResponse(judgeResponse, modelNames);
        lastResult = judgeResult;
        updatePanelStatus(judgeKey, '✅ Done');
        showStatus('Evaluation complete!');
        hideStatusAfterDelay(2000);
        showResults(judgeResult);
    } else {
        updatePanelStatus(judgeKey, '⏰ Timeout');
        showStatus('Judge timed out. Showing raw responses.');
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        hideStatusAfterDelay(3000);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// RESIZABLE SIDE-BY-SIDE PANELS
// ══════════════════════════════════════════════════════════════════════════════

function createResizablePanels(panels) {
    splitPanels.innerHTML = '';
    iframePanels = {};

    // Back button
    let backBtn = document.querySelector('.btn-back');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.className = 'btn-back';
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', goBackToHome);
        document.body.appendChild(backBtn);
    }

    const totalPanels = panels.length;
    const flexBasis = `${100 / totalPanels}%`;

    panels.forEach((p, i) => {
        const panelEl = createSinglePanel(p, flexBasis);
        splitPanels.appendChild(panelEl);

        // Add resize handle between panels (not after the last one)
        if (i < totalPanels - 1) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.dataset.index = i;
            splitPanels.appendChild(handle);
            setupResizeHandle(handle);
        }
    });
}

function createSinglePanel({ id, role }, flexBasis) {
    const model = MODELS[id];
    const panelKey = role === 'judge' ? `judge-${id}` : id;
    const icon = model?.icon || '🤖';
    const name = model?.name || id;
    const url = model?.url || '#';

    const panel = document.createElement('div');
    panel.className = 'iframe-panel';
    panel.id = `panel-${panelKey}`;
    panel.style.flex = `1 1 ${flexBasis}`;

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
        iframe: null, frameId: null, panelEl: panel,
        url, role, modelId: id, failed: false,
    };

    return panel;
}

// ── Resize Handle Logic ──────────────────────────────────────────────────────

function setupResizeHandle(handle) {
    let startX, leftPanel, rightPanel, leftWidth, rightWidth, totalWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;

        // Find adjacent panels
        leftPanel = handle.previousElementSibling;
        rightPanel = handle.nextElementSibling;
        if (!leftPanel || !rightPanel) return;

        leftWidth = leftPanel.getBoundingClientRect().width;
        rightWidth = rightPanel.getBoundingClientRect().width;
        totalWidth = leftWidth + rightWidth;

        handle.classList.add('active');

        // Add overlay to prevent iframes from stealing mouse events
        const overlay = document.createElement('div');
        overlay.className = 'resize-overlay';
        document.body.appendChild(overlay);

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            const newLeft = Math.max(100, leftWidth + dx);
            const newRight = Math.max(100, totalWidth - newLeft);

            leftPanel.style.flex = `0 0 ${newLeft}px`;
            rightPanel.style.flex = `0 0 ${newRight}px`;
        };

        const onMouseUp = () => {
            handle.classList.remove('active');
            overlay.remove();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function goBackToHome() {
    splitPanels.innerHTML = '';
    iframePanels = {};
    splitScreen.style.display = 'none';
    expandSidebar();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'home'));
    document.getElementById('view-home').classList.add('active');
    document.querySelector('.btn-back')?.remove();
}

// ══════════════════════════════════════════════════════════════════════════════
// IFRAME LOADING — Detect failures early
// ══════════════════════════════════════════════════════════════════════════════

async function waitForIframeLoads(panels) {
    const loadPromises = panels.map(p => {
        const panelKey = p.role === 'judge' ? `judge-${p.id}` : p.id;
        const iframe = document.getElementById(`iframe-${panelKey}`);
        if (!iframe) return Promise.resolve();

        iframePanels[panelKey].iframe = iframe;

        return new Promise(resolve => {
            let loaded = false;

            const timeout = setTimeout(() => {
                if (!loaded) {
                    console.warn(`[LLM Council] ${panelKey}: load timeout`);
                    updatePanelStatus(panelKey, 'Loaded (slow)');
                    hideLoading(panelKey);
                }
                resolve();
            }, 25000);

            iframe.addEventListener('load', () => {
                loaded = true;
                clearTimeout(timeout);
                hideLoading(panelKey);

                // Check if iframe loaded an error page (refused to connect)
                // We can detect this by checking if the frame URL changed to about:blank or error
                setTimeout(() => {
                    checkIframeHealth(panelKey);
                }, 2000);

                resolve();
            }, { once: true });

            iframe.addEventListener('error', () => {
                loaded = true;
                clearTimeout(timeout);
                markPanelFailed(panelKey, 'Failed to load');
                resolve();
            }, { once: true });
        });
    });

    await Promise.all(loadPromises);
    await delay(4000); // Wait for JS hydration
}

function checkIframeHealth(panelKey) {
    // We can't directly check cross-origin iframe content,
    // but we can check if the frame appears in webNavigation
    // This is done during discoverFrameIds()
}

function markPanelFailed(panelKey, reason) {
    const panel = iframePanels[panelKey];
    if (!panel) return;
    panel.failed = true;
    hideLoading(panelKey);
    updatePanelStatus(panelKey, `⛔ ${reason}`);

    // Add error overlay
    const panelEl = panel.panelEl;
    panelEl.classList.add('error');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'iframe-panel-error';
    errorDiv.innerHTML = `<span>⛔ ${reason}</span><small>This model will be skipped</small>`;
    panelEl.appendChild(errorDiv);
}

function hideLoading(panelKey) {
    const loader = document.getElementById(`loading-${panelKey}`);
    if (loader) loader.style.display = 'none';
}

// ── Frame Discovery ──────────────────────────────────────────────────────────

async function discoverFrameIds() {
    if (!currentTabId) return;

    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        if (!frames) return;

        for (const frame of frames) {
            if (frame.frameId === 0) continue;
            if (!frame.url || frame.url === 'about:blank') continue;

            for (const [panelKey, panel] of Object.entries(iframePanels)) {
                if (panel.frameId || panel.failed) continue;

                const model = MODELS[panel.modelId];
                if (!model) continue;

                const frameUrl = frame.url.toLowerCase();
                let matched = false;

                // Match via matchPatterns
                for (const pattern of (model.matchPatterns || [])) {
                    if (frameUrl.includes(pattern.toLowerCase())) { matched = true; break; }
                }

                // Fallback: domain match
                if (!matched) {
                    try {
                        const pH = new URL(panel.url).hostname;
                        const fH = new URL(frame.url).hostname;
                        if (fH === pH || fH.endsWith('.' + pH) || pH.endsWith('.' + fH)) matched = true;
                    } catch (e) { }
                }

                if (matched) {
                    panel.frameId = frame.frameId;
                    updatePanelStatus(panelKey, '🟢 Connected');
                    console.log(`[LLM Council] ✓ ${panelKey} → frame ${frame.frameId}`);
                    break;
                }
            }
        }

        // Mark panels with no frame discovered as failed
        for (const [key, panel] of Object.entries(iframePanels)) {
            if (!panel.frameId && !panel.failed) {
                // Don't mark as failed yet — give it another chance via retry
            }
        }
    } catch (e) {
        console.error('[LLM Council] Frame discovery error:', e);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTENT SCRIPT INJECTION & MESSAGING
// ══════════════════════════════════════════════════════════════════════════════

async function injectAndSend(frameId, prompt) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: currentTabId, frameIds: [frameId] },
                files: ['content-scripts/injector.js']
            });
        } catch (e) {
            console.warn(`[LLM Council] Inject attempt ${attempt}:`, e.message);
        }

        await delay(800 * attempt);

        try {
            const res = await sendMsg(frameId, { type: 'INJECT_PROMPT', prompt });
            if (res?.success) return res;
            if (attempt < 3) continue;
            throw new Error(res?.error || 'Injection failed');
        } catch (e) {
            if (attempt === 3) throw e;
            await delay(1500);
        }
    }
}

function sendMsg(frameId, msg) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(currentTabId, msg, { frameId }, r => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(r);
            });
        } catch (e) { reject(e); }
    });
}

function extractFromFrame(frameId) {
    return new Promise(resolve => {
        try {
            chrome.tabs.sendMessage(currentTabId, { type: 'EXTRACT_RESPONSE' }, { frameId }, r => {
                if (chrome.runtime.lastError) resolve({ complete: false, response: '' });
                else resolve(r || { complete: false, response: '' });
            });
        } catch (e) { resolve({ complete: false, response: '' }); }
    });
}

// ── Response Polling ─────────────────────────────────────────────────────────

async function pollForCouncilResponses(councilIds, responses) {
    const start = Date.now();
    const pending = new Set(councilIds.filter(id => {
        const p = iframePanels[id];
        return p && !p.failed && p.frameId;
    }));

    while (pending.size > 0 && (Date.now() - start) < DEFAULTS.COUNCIL_TIMEOUT_MS) {
        for (const id of [...pending]) {
            const panel = iframePanels[id];
            if (!panel?.frameId) { pending.delete(id); continue; }

            try {
                const r = await extractFromFrame(panel.frameId);
                if (r.complete && r.response) {
                    responses[id] = r.response;
                    pending.delete(id);
                    updatePanelStatus(id, '✅ Done');
                    showStatus(`${MODELS[id]?.name} responded! (${pending.size} remaining)`);
                }
            } catch (e) { }
        }
        if (pending.size > 0) await delay(DEFAULTS.POLL_INTERVAL_MS);
    }

    for (const id of pending) updatePanelStatus(id, '⏰ Timeout');
}

async function pollFrameForResponse(frameId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const r = await extractFromFrame(frameId);
            if (r.complete && r.response) return r.response;
        } catch (e) { }
        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function updatePanelStatus(k, text) {
    const el = document.getElementById(`status-${k}`);
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

    if (result.parsed && result.scores?.length > 0) {
        if (result.winner) {
            const wd = result.scores.find(s => s.modelName === result.winner);
            resultsBody.innerHTML += `
        <div class="result-winner">
          <span class="result-winner-trophy">🏆</span>
          <div class="result-winner-info">
            <span class="result-winner-label">Winner</span>
            <span class="result-winner-name">${result.winner} — ${wd ? wd.total + '/50' : ''}</span>
          </div>
        </div>`;
        }
        const sorted = [...result.scores].sort((a, b) => b.total - a.total);
        for (const s of sorted) {
            const m = Object.values(MODELS).find(x => x.name === s.modelName);
            resultsBody.innerHTML += `
        <div class="result-score-card">
          <div class="result-score-header">
            <span class="result-score-model">${m?.icon || '🤖'} ${s.modelName}</span>
            <span class="result-score-total">${s.total}/50</span>
          </div>
          <div class="result-criteria">
            <div class="result-criterion"><div class="result-criterion-label">Acc</div><div class="result-criterion-score">${s.accuracy}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Dep</div><div class="result-criterion-score">${s.depth}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Cla</div><div class="result-criterion-score">${s.clarity}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rea</div><div class="result-criterion-score">${s.reasoning}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rel</div><div class="result-criterion-score">${s.relevance}</div></div>
          </div>
          ${s.justification ? `<div class="result-justification">"${s.justification}"</div>` : ''}
        </div>`;
        }
    } else {
        resultsBody.innerHTML = `<div class="result-raw">${result.rawText || 'No response received.'}</div>`;
    }

    resultsModal.style.display = 'flex';
}

function copyResults() {
    if (!lastResult) return;
    let t = '📊 LLM Council Evaluation\n\n';
    if (lastResult.parsed) {
        if (lastResult.winner) t += `🏆 Winner: ${lastResult.winner}\n\n`;
        for (const s of lastResult.scores) {
            t += `${s.modelName}: ${s.total}/50 (Acc:${s.accuracy} Dep:${s.depth} Cla:${s.clarity} Rea:${s.reasoning} Rel:${s.relevance})\n`;
            if (s.justification) t += `  "${s.justification}"\n`;
        }
    } else { t += lastResult.rawText || 'No results.'; }
    navigator.clipboard.writeText(t).then(() => {
        btnCopyResults.textContent = '✅ Copied!';
        setTimeout(() => btnCopyResults.textContent = '📋 Copy', 2000);
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ─────────────────────────────────────────────────────────────────────

init();
