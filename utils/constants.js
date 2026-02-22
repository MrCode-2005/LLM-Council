/**
 * LLM Council — Constants & Configuration
 */

// ── Supported AI Models ─────────────────────────────────────────────────────

export const MODELS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    matchPatterns: ['chatgpt.com', 'chat.openai.com'],
    icon: '🤖',
    color: '#10a37f'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    matchPatterns: ['gemini.google.com'],
    icon: '✨',
    color: '#4285f4'
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    matchPatterns: ['perplexity.ai'],
    icon: '🔍',
    color: '#22b8cf'
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    url: 'https://grok.com/',
    matchPatterns: ['grok.com', 'x.com/i/grok'],
    icon: '⚡',
    color: '#1d9bf0'
  }
};

// ── Message Types ────────────────────────────────────────────────────────────

export const MSG = {
  // Popup → Service Worker
  ASK_COUNCIL: 'ASK_COUNCIL',
  REAUTHENTICATE_JUDGE: 'REAUTHENTICATE_JUDGE',
  GET_STATUS: 'GET_STATUS',

  // Service Worker → Content Script
  INJECT_PROMPT: 'INJECT_PROMPT',
  EXTRACT_RESPONSE: 'EXTRACT_RESPONSE',

  // Content Script → Service Worker
  PROMPT_SENT: 'PROMPT_SENT',
  RESPONSE_READY: 'RESPONSE_READY',
  INJECTION_FAILED: 'INJECTION_FAILED',

  // Service Worker → Popup
  STATUS_UPDATE: 'STATUS_UPDATE',
  ALL_RESPONSES_COLLECTED: 'ALL_RESPONSES_COLLECTED',
  JUDGE_RESULT: 'JUDGE_RESULT',
  ERROR: 'ERROR'
};

// ── Response Statuses ────────────────────────────────────────────────────────

export const RESPONSE_STATUS = {
  PENDING: 'pending',
  INJECTING: 'injecting',
  WAITING: 'waiting',
  COMPLETE: 'complete',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
};

// ── Judge Isolation Modes ────────────────────────────────────────────────────

export const JUDGE_MODE = {
  SAME_SESSION: 'same-session',
  INCOGNITO: 'incognito',
  SEPARATE_WINDOW: 'separate-window'
};

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  COUNCIL_TIMEOUT_MS: 120_000,   // 2 minutes per model
  JUDGE_TIMEOUT_MS: 180_000,     // 3 minutes for judge
  MIN_COUNCIL: 2,
  MAX_COUNCIL: 4,
  DEFAULT_JUDGE: 'gemini',       // Gemini is default judge
  JUDGE_MODE: JUDGE_MODE.INCOGNITO,
  POLL_INTERVAL_MS: 2_000,       // DOM polling interval
  INJECTION_DELAY_MS: 1_500      // delay between model injections
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  SELECTED_COUNCIL: 'selectedCouncil',
  SELECTED_JUDGE: 'selectedJudge',
  JUDGE_ISOLATION_MODE: 'judgeIsolationMode',
  JUDGE_CUSTOM_PROMPT: 'judgeCustomPrompt',
  LAST_PROMPT: 'lastPrompt'
};
