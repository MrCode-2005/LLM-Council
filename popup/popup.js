/**
 * LLM Council — Popup UI Logic
 */

import { MODELS, MSG, DEFAULTS, STORAGE_KEYS, JUDGE_MODE } from '../utils/constants.js';

// ── DOM References ───────────────────────────────────────────────────────────

const promptInput = document.getElementById('prompt-input');
const councilGrid = document.getElementById('council-grid');
const councilCount = document.getElementById('council-count');
const judgeSelect = document.getElementById('judge-select');
const judgeStatus = document.getElementById('judge-status');
const settingsToggle = document.getElementById('settings-toggle');
const settingsBody = document.getElementById('settings-body');
const settingsChevron = document.getElementById('settings-chevron');
const btnReauth = document.getElementById('btn-reauth');
const btnAskCouncil = document.getElementById('btn-ask-council');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const resultsPanel = document.getElementById('results-panel');
const winnerBanner = document.getElementById('winner-banner');
const winnerName = document.getElementById('winner-name');
const winnerScore = document.getElementById('winner-score');
const scoreCards = document.getElementById('score-cards');
const failedModels = document.getElementById('failed-models');
const rawResponse = document.getElementById('raw-response');
const rawResponseText = document.getElementById('raw-response-text');
const btnCopyResults = document.getElementById('btn-copy-results');
const btnReEvaluate = document.getElementById('btn-re-evaluate');

// ── State ────────────────────────────────────────────────────────────────────

let selectedCouncil = new Set();
let selectedJudge = DEFAULTS.DEFAULT_JUDGE;
let judgeIsolationMode = DEFAULTS.JUDGE_MODE;
let isRunning = false;
let lastResult = null;

// ── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    renderCouncilGrid();
    renderJudgeDropdown();
    setupEventListeners();
    updateUI();
}

async function loadConfig() {
    const config = await chrome.storage.local.get([
        STORAGE_KEYS.SELECTED_COUNCIL,
        STORAGE_KEYS.SELECTED_JUDGE,
        STORAGE_KEYS.JUDGE_ISOLATION_MODE
    ]);

    if (config[STORAGE_KEYS.SELECTED_COUNCIL]) {
        selectedCouncil = new Set(config[STORAGE_KEYS.SELECTED_COUNCIL]);
    }

    if (config[STORAGE_KEYS.SELECTED_JUDGE]) {
        selectedJudge = config[STORAGE_KEYS.SELECTED_JUDGE];
    }

    if (config[STORAGE_KEYS.JUDGE_ISOLATION_MODE]) {
        judgeIsolationMode = config[STORAGE_KEYS.JUDGE_ISOLATION_MODE];
    }
}

async function saveConfig() {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SELECTED_COUNCIL]: [...selectedCouncil],
        [STORAGE_KEYS.SELECTED_JUDGE]: selectedJudge,
        [STORAGE_KEYS.JUDGE_ISOLATION_MODE]: judgeIsolationMode
    });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderCouncilGrid() {
    councilGrid.innerHTML = '';

    for (const [id, model] of Object.entries(MODELS)) {
        const card = document.createElement('label');
        card.className = `model-card${selectedCouncil.has(id) ? ' selected' : ''}`;
        card.dataset.modelId = id;

        card.innerHTML = `
      <input type="checkbox" class="model-checkbox" value="${id}" 
        ${selectedCouncil.has(id) ? 'checked' : ''}>
      <span class="model-check">${selectedCouncil.has(id) ? '✓' : ''}</span>
      <span class="model-icon">${model.icon}</span>
      <span class="model-name">${model.name}</span>
    `;

        card.addEventListener('click', (e) => {
            e.preventDefault();
            toggleCouncilModel(id);
        });

        councilGrid.appendChild(card);
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

// ── UI Updates ───────────────────────────────────────────────────────────────

function updateUI() {
    // Council count validation
    const count = selectedCouncil.size;
    const valid = count >= DEFAULTS.MIN_COUNCIL && count <= DEFAULTS.MAX_COUNCIL;

    councilCount.textContent = `${count} selected (${DEFAULTS.MIN_COUNCIL}–${DEFAULTS.MAX_COUNCIL})`;
    councilCount.className = `section-hint ${valid ? 'valid' : (count > 0 ? 'invalid' : '')}`;

    // Disable cards at max if not selected
    document.querySelectorAll('.model-card').forEach(card => {
        const modelId = card.dataset.modelId;
        if (count >= DEFAULTS.MAX_COUNCIL && !selectedCouncil.has(modelId)) {
            card.classList.add('disabled');
        } else {
            card.classList.remove('disabled');
        }

        // Update check mark
        const check = card.querySelector('.model-check');
        if (selectedCouncil.has(modelId)) {
            card.classList.add('selected');
            check.textContent = '✓';
        } else {
            card.classList.remove('selected');
            check.textContent = '';
        }
    });

    // Ask Council button
    const hasPrompt = promptInput.value.trim().length > 0;
    btnAskCouncil.disabled = !valid || !hasPrompt || isRunning;

    if (isRunning) {
        btnAskCouncil.classList.add('loading');
        btnAskCouncil.querySelector('.btn-text').textContent = 'Running...';
    } else {
        btnAskCouncil.classList.remove('loading');
        btnAskCouncil.querySelector('.btn-text').textContent = 'Ask Council';
    }

    // Judge isolation radio buttons
    document.querySelectorAll('input[name="judge-mode"]').forEach(radio => {
        radio.checked = radio.value === judgeIsolationMode;
    });
}

function setStatus(text, state = 'running') {
    statusIndicator.className = `status-indicator ${state}`;
    statusText.textContent = text;
}

// ── Council Model Selection ──────────────────────────────────────────────────

function toggleCouncilModel(modelId) {
    if (selectedCouncil.has(modelId)) {
        selectedCouncil.delete(modelId);
    } else {
        if (selectedCouncil.size >= DEFAULTS.MAX_COUNCIL) return;
        selectedCouncil.add(modelId);
    }
    updateUI();
    saveConfig();
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    // Prompt input
    promptInput.addEventListener('input', updateUI);

    // Judge dropdown
    judgeSelect.addEventListener('change', () => {
        selectedJudge = judgeSelect.value;
        saveConfig();
    });

    // Settings toggle
    settingsToggle.addEventListener('click', () => {
        settingsBody.classList.toggle('open');
        settingsChevron.classList.toggle('open');
    });

    // Judge mode radios
    document.querySelectorAll('input[name="judge-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            judgeIsolationMode = radio.value;
            saveConfig();
        });
    });

    // Re-authenticate
    btnReauth.addEventListener('click', async () => {
        btnReauth.disabled = true;
        btnReauth.textContent = '⏳ Opening Judge...';
        try {
            await chrome.runtime.sendMessage({ type: MSG.REAUTHENTICATE_JUDGE });
            judgeStatus.textContent = 'Judge Account Active ✓';
            judgeStatus.className = 'judge-status active';
        } catch (e) {
            console.error('Reauth failed:', e);
        }
        btnReauth.disabled = false;
        btnReauth.textContent = '🔄 Re-authenticate Judge Account';
    });

    // Ask Council
    btnAskCouncil.addEventListener('click', handleAskCouncil);

    // Copy results
    btnCopyResults.addEventListener('click', copyResults);

    // Re-evaluate
    btnReEvaluate.addEventListener('click', handleAskCouncil);

    // Listen for background messages
    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case MSG.STATUS_UPDATE:
                setStatus(message.status, 'running');
                break;
            case MSG.JUDGE_RESULT:
                handleJudgeResult(message.result);
                break;
            case MSG.ERROR:
                setStatus(message.error, 'error');
                isRunning = false;
                updateUI();
                break;
        }
    });
}

// ── Ask Council Handler ──────────────────────────────────────────────────────

async function handleAskCouncil() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const councilModels = [...selectedCouncil];
    if (councilModels.length < DEFAULTS.MIN_COUNCIL) return;

    // CRITICAL: Judge must NOT be in the broadcast array
    const broadcastTargets = councilModels.filter(id => id !== selectedJudge);

    // Edge case: if all council models are also the judge, warn
    if (broadcastTargets.length < DEFAULTS.MIN_COUNCIL) {
        setStatus('Judge model overlaps with all council models. Pick a different judge.', 'error');
        return;
    }

    isRunning = true;
    updateUI();
    setStatus('Sending prompt to council...', 'running');

    // Hide previous results
    resultsPanel.style.display = 'none';

    try {
        await chrome.runtime.sendMessage({
            type: MSG.ASK_COUNCIL,
            prompt,
            councilModels: broadcastTargets,
            judgeModel: selectedJudge,
            judgeMode: judgeIsolationMode
        });
    } catch (e) {
        setStatus(`Error: ${e.message}`, 'error');
        isRunning = false;
        updateUI();
    }
}

// ── Results Handler ──────────────────────────────────────────────────────────

function handleJudgeResult(result) {
    isRunning = false;
    lastResult = result;
    updateUI();

    resultsPanel.style.display = '';

    if (result.parsed && result.scores.length > 0) {
        setStatus('Evaluation complete!', 'success');
        renderScores(result);
    } else {
        // Fallback: show raw response
        setStatus('Judge responded but output could not be parsed.', 'warning');
        scoreCards.innerHTML = '';
        winnerBanner.style.display = 'none';
        failedModels.style.display = 'none';
        rawResponse.style.display = '';
        rawResponseText.textContent = result.rawText || 'No response received.';
    }
}

function renderScores(result) {
    // Winner banner
    if (result.winner) {
        winnerBanner.style.display = '';
        winnerName.textContent = result.winner;
        const winnerData = result.scores.find(s => s.modelName === result.winner);
        winnerScore.textContent = winnerData ? `${winnerData.total}/50` : '';
    } else {
        winnerBanner.style.display = 'none';
    }

    // Score cards
    scoreCards.innerHTML = '';
    const sorted = [...result.scores].sort((a, b) => b.total - a.total);

    sorted.forEach((score, idx) => {
        const model = Object.values(MODELS).find(m => m.name === score.modelName);
        const icon = model?.icon || '🤖';
        const isWinner = score.modelName === result.winner;

        const card = document.createElement('div');
        card.className = `score-card${isWinner ? ' winner' : ''}`;

        card.innerHTML = `
      <div class="score-card-header">
        <div class="score-card-model">
          <span class="score-card-icon">${icon}</span>
          <span class="score-card-name">${score.modelName}</span>
          <span class="score-card-rank">#${idx + 1}</span>
        </div>
        <span class="score-card-total">${score.total}/50</span>
      </div>
      <div class="score-criteria">
        <div class="criterion">
          <span class="criterion-label">Acc</span>
          <span class="criterion-score">${score.accuracy}</span>
        </div>
        <div class="criterion">
          <span class="criterion-label">Dep</span>
          <span class="criterion-score">${score.depth}</span>
        </div>
        <div class="criterion">
          <span class="criterion-label">Cla</span>
          <span class="criterion-score">${score.clarity}</span>
        </div>
        <div class="criterion">
          <span class="criterion-label">Rea</span>
          <span class="criterion-score">${score.reasoning}</span>
        </div>
        <div class="criterion">
          <span class="criterion-label">Rel</span>
          <span class="criterion-score">${score.relevance}</span>
        </div>
      </div>
      ${score.justification ? `<div class="score-card-justification">"${score.justification}"</div>` : ''}
    `;

        scoreCards.appendChild(card);
    });

    // Failed models
    // (Handled by service worker — check responses for failed ones)
    rawResponse.style.display = 'none';
}

// ── Copy Results ─────────────────────────────────────────────────────────────

function copyResults() {
    if (!lastResult) return;

    let text = '📊 LLM Council Evaluation Results\n\n';

    if (lastResult.parsed) {
        if (lastResult.winner) {
            text += `🏆 Winner: ${lastResult.winner}\n\n`;
        }

        for (const score of lastResult.scores) {
            text += `${score.modelName}: ${score.total}/50\n`;
            text += `  Accuracy: ${score.accuracy} | Depth: ${score.depth} | Clarity: ${score.clarity}\n`;
            text += `  Reasoning: ${score.reasoning} | Relevance: ${score.relevance}\n`;
            if (score.justification) text += `  "${score.justification}"\n`;
            text += '\n';
        }

        if (lastResult.summary) {
            text += `Summary: ${lastResult.summary}\n`;
        }
    } else {
        text += lastResult.rawText || 'No results available.';
    }

    navigator.clipboard.writeText(text).then(() => {
        btnCopyResults.textContent = '✅ Copied!';
        setTimeout(() => { btnCopyResults.textContent = '📋 Copy Results'; }, 2000);
    });
}

// ── Start ────────────────────────────────────────────────────────────────────

init();
