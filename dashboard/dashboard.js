/**
 * LLM Council — Full-Page Dashboard Logic
 */

import { MODELS, MSG, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';

// ── DOM References ───────────────────────────────────────────────────────────

const modelsGrid = document.getElementById('models-grid');
const modelCount = document.getElementById('model-count');
const judgeSelect = document.getElementById('judge-select');
const judgeBadge = document.getElementById('judge-badge');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const btnReauth = document.getElementById('btn-reauth');
const bannerClose = document.getElementById('banner-close');
const banner = document.getElementById('banner');
const statusOverlay = document.getElementById('status-overlay');
const statusText = document.getElementById('status-text');
const statusModels = document.getElementById('status-models');
const resultsModal = document.getElementById('results-modal');
const resultsBody = document.getElementById('results-body');
const resultsClose = document.getElementById('results-close');
const resultsCloseBtn = document.getElementById('results-close-btn');
const btnCopyResults = document.getElementById('btn-copy-results');

// ── State ────────────────────────────────────────────────────────────────────

let selectedCouncil = new Set();
let selectedJudge = DEFAULTS.DEFAULT_JUDGE;
let judgeIsolationMode = DEFAULTS.JUDGE_MODE;
let lastResult = null;

// ── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    renderModelsGrid();
    renderJudgeDropdown();
    setupEventListeners();
    setupSidebarNav();
    updateUI();
}

async function loadConfig() {
    const config = await chrome.storage.local.get([
        STORAGE_KEYS.SELECTED_COUNCIL,
        STORAGE_KEYS.SELECTED_JUDGE,
        STORAGE_KEYS.JUDGE_ISOLATION_MODE
    ]);
    if (config[STORAGE_KEYS.SELECTED_COUNCIL]) selectedCouncil = new Set(config[STORAGE_KEYS.SELECTED_COUNCIL]);
    if (config[STORAGE_KEYS.SELECTED_JUDGE]) selectedJudge = config[STORAGE_KEYS.SELECTED_JUDGE];
    if (config[STORAGE_KEYS.JUDGE_ISOLATION_MODE]) judgeIsolationMode = config[STORAGE_KEYS.JUDGE_ISOLATION_MODE];
}

async function saveConfig() {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SELECTED_COUNCIL]: [...selectedCouncil],
        [STORAGE_KEYS.SELECTED_JUDGE]: selectedJudge,
        [STORAGE_KEYS.JUDGE_ISOLATION_MODE]: judgeIsolationMode
    });
}

// ── Render Models Grid ───────────────────────────────────────────────────────

function renderModelsGrid() {
    modelsGrid.innerHTML = '';

    for (const [id, model] of Object.entries(MODELS)) {
        const card = document.createElement('div');
        card.className = `model-card${selectedCouncil.has(id) ? ' selected' : ''}`;
        card.dataset.modelId = id;

        card.innerHTML = `
      <div class="model-checkbox-visual">${selectedCouncil.has(id) ? '' : ''}</div>
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

// ── UI Update ────────────────────────────────────────────────────────────────

function updateUI() {
    const count = selectedCouncil.size;
    const valid = count >= DEFAULTS.MIN_COUNCIL && count <= DEFAULTS.MAX_COUNCIL;

    modelCount.textContent = `${count} selected`;
    modelCount.className = `model-count${valid ? ' valid' : count > DEFAULTS.MAX_COUNCIL ? ' over' : ''}`;

    // Update card states
    document.querySelectorAll('.model-card').forEach(card => {
        const id = card.dataset.modelId;
        if (selectedCouncil.has(id)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    // Judge badge
    const judgeModel = MODELS[selectedJudge];
    if (judgeModel) judgeBadge.textContent = judgeModel.name;

    // Judge mode radios
    document.querySelectorAll('input[name="judge-mode"]').forEach(r => {
        r.checked = r.value === judgeIsolationMode;
    });

    // Send button
    const hasPrompt = promptInput.value.trim().length > 0;
    btnSend.disabled = !valid || !hasPrompt;
}

// ── Sidebar Navigation ──────────────────────────────────────────────────────

function setupSidebarNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;

            // Toggle active nav
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Toggle active view
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById(`view-${view}`);
            if (target) target.classList.add('active');
        });
    });
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    // Prompt input
    promptInput.addEventListener('input', updateUI);

    // Enter key submits
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btnSend.disabled) {
            e.preventDefault();
            handleSubmit();
        }
    });

    // Send button
    btnSend.addEventListener('click', handleSubmit);

    // Judge dropdown
    judgeSelect.addEventListener('change', () => {
        selectedJudge = judgeSelect.value;
        updateUI();
        saveConfig();
    });

    // Judge mode
    document.querySelectorAll('input[name="judge-mode"]').forEach(r => {
        r.addEventListener('change', () => {
            judgeIsolationMode = r.value;
            saveConfig();
        });
    });

    // Banner close
    bannerClose?.addEventListener('click', () => banner.classList.add('hidden'));

    // Re-auth
    btnReauth?.addEventListener('click', async () => {
        btnReauth.disabled = true;
        btnReauth.textContent = '⏳ Opening...';
        await chrome.runtime.sendMessage({ type: MSG.REAUTHENTICATE_JUDGE });
        btnReauth.disabled = false;
        btnReauth.textContent = '🔄 Re-authenticate Judge Account';
    });

    // Template tags
    document.querySelectorAll('.template-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const currentVal = promptInput.value.trim();
            const template = tag.dataset.template;
            promptInput.value = currentVal ? `${currentVal} ${template}` : template;
            promptInput.focus();
            updateUI();
        });
    });

    // Results modal close
    resultsClose?.addEventListener('click', () => resultsModal.style.display = 'none');
    resultsCloseBtn?.addEventListener('click', () => resultsModal.style.display = 'none');
    btnCopyResults?.addEventListener('click', copyResults);

    // Listen for background messages
    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case MSG.STATUS_UPDATE:
                showStatus(message.status);
                break;
            case MSG.JUDGE_RESULT:
                hideStatus();
                showResults(message.result);
                break;
            case MSG.ERROR:
                hideStatus();
                alert(`Error: ${message.error}`);
                break;
        }
    });
}

// ── Submit Prompt ────────────────────────────────────────────────────────────

async function handleSubmit() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const councilModels = [...selectedCouncil];
    if (councilModels.length < DEFAULTS.MIN_COUNCIL) return;

    showStatus('Opening AI sites and sending prompt...');

    try {
        await chrome.runtime.sendMessage({
            type: MSG.ASK_COUNCIL,
            prompt,
            councilModels,
            judgeModel: selectedJudge,
            judgeMode: judgeIsolationMode
        });
    } catch (e) {
        hideStatus();
        alert(`Error: ${e.message}`);
    }
}

// ── Status Overlay ───────────────────────────────────────────────────────────

function showStatus(text) {
    statusText.textContent = text;
    statusOverlay.style.display = 'flex';
}

function hideStatus() {
    statusOverlay.style.display = 'none';
}

// ── Results Display ──────────────────────────────────────────────────────────

function showResults(result) {
    lastResult = result;
    resultsBody.innerHTML = '';

    if (result.parsed && result.scores.length > 0) {
        // Winner
        if (result.winner) {
            const winnerData = result.scores.find(s => s.modelName === result.winner);
            resultsBody.innerHTML += `
        <div class="result-winner">
          <span class="result-winner-trophy">🏆</span>
          <div class="result-winner-info">
            <span class="result-winner-label">Winner</span>
            <span class="result-winner-name">${result.winner} — ${winnerData ? winnerData.total + '/50' : ''}</span>
          </div>
        </div>
      `;
        }

        // Score cards
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
        // Raw fallback
        resultsBody.innerHTML = `<div class="result-raw">${result.rawText || 'No response received.'}</div>`;
    }

    resultsModal.style.display = 'flex';
}

// ── Copy Results ─────────────────────────────────────────────────────────────

function copyResults() {
    if (!lastResult) return;

    let text = '📊 LLM Council Evaluation Results\n\n';
    if (lastResult.parsed) {
        if (lastResult.winner) text += `🏆 Winner: ${lastResult.winner}\n\n`;
        for (const s of lastResult.scores) {
            text += `${s.modelName}: ${s.total}/50 (Acc:${s.accuracy} Dep:${s.depth} Cla:${s.clarity} Rea:${s.reasoning} Rel:${s.relevance})\n`;
            if (s.justification) text += `  "${s.justification}"\n`;
            text += '\n';
        }
    } else {
        text += lastResult.rawText || 'No results.';
    }

    navigator.clipboard.writeText(text).then(() => {
        btnCopyResults.textContent = '✅ Copied!';
        setTimeout(() => btnCopyResults.textContent = '📋 Copy', 2000);
    });
}

// ── Init ─────────────────────────────────────────────────────────────────────

init();
