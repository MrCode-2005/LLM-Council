/**
 * LLM Council — Content Script (Injector)
 *
 * This script runs in AI site pages. It receives messages from the
 * service worker to inject prompts and extract responses.
 */

(function () {
    'use strict';

    // ── Adapter Registry ──────────────────────────────────────────────────────

    const ADAPTERS = {
        chatgpt: {
            match: () => /chatgpt\.com|chat\.openai\.com/.test(location.hostname),

            getInput: () =>
                document.querySelector('#prompt-textarea') ||
                document.querySelector('textarea[data-id="root"]') ||
                document.querySelector('div[contenteditable="true"]'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA') {
                    setNativeValue(el, text);
                } else {
                    const p = el.querySelector('p');
                    if (p) p.textContent = text;
                    else el.textContent = text;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('[data-testid="send-button"]') ||
                    document.querySelector('button[aria-label="Send prompt"]') ||
                    document.querySelector('form button[type="submit"]');
                if (btn && !btn.disabled) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const stop = document.querySelector('[data-testid="stop-button"]') ||
                    document.querySelector('[aria-label="Stop generating"]');
                if (stop) return false;
                return document.querySelectorAll('[data-message-author-role="assistant"]').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
                if (!msgs.length) return '';
                const last = msgs[msgs.length - 1];
                return (last.querySelector('.markdown') || last).innerText.trim();
            }
        },

        gemini: {
            match: () => /gemini\.google\.com/.test(location.hostname),

            getInput: () =>
                document.querySelector('.ql-editor[contenteditable="true"]') ||
                document.querySelector('div[contenteditable="true"]'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.classList.contains('ql-editor')) {
                    el.innerHTML = `<p>${text}</p>`;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                } else {
                    setNativeValue(el, text);
                }
            },

            submit: () => {
                const btn = document.querySelector('button.send-button') ||
                    document.querySelector('[aria-label="Send message"]') ||
                    document.querySelector('.send-button-container button');
                if (btn && !btn.disabled) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const loading = document.querySelector('mat-progress-bar') ||
                    document.querySelector('.loading-indicator');
                const stop = document.querySelector('[aria-label="Stop response"]');
                if (loading || stop) return false;
                return document.querySelectorAll('.model-response-text, message-content').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('.model-response-text, message-content');
                if (!msgs.length) return '';
                return msgs[msgs.length - 1].innerText.trim();
            }
        },

        perplexity: {
            match: () => /perplexity\.ai/.test(location.hostname),

            getInput: () =>
                document.querySelector('div#ask-input') ||
                document.querySelector('[role="textbox"]') ||
                document.querySelector('textarea[placeholder*="Ask"]') ||
                document.querySelector('textarea'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    setNativeValue(el, text);
                } else {
                    // contenteditable div
                    el.textContent = '';
                    document.execCommand('insertText', false, text);
                    if (!el.textContent?.trim()) {
                        el.innerHTML = `<p>${text}</p>`;
                    }
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('button[aria-label="Submit"]') ||
                    document.querySelector('button.bg-super') ||
                    document.querySelector('button[type="submit"]');
                if (btn && !btn.disabled) { btn.click(); return true; }
                // Try Enter key as fallback
                return false;
            },

            isComplete: () => {
                const loading = document.querySelector('.animate-spin');
                if (loading) return false;
                return document.querySelectorAll('.prose').length > 0;
            },

            getResponse: () => {
                const answers = document.querySelectorAll('.prose');
                if (!answers.length) return '';
                return answers[answers.length - 1].innerText.trim();
            }
        },

        grok: {
            match: () => /grok\.com|x\.com\/i\/grok/.test(location.hostname + location.pathname),

            getInput: () =>
                document.querySelector('textarea[aria-label*="Ask Grok"]') ||
                document.querySelector('textarea[aria-label*="Ask"]') ||
                document.querySelector('textarea[placeholder*="Ask"]') ||
                document.querySelector('textarea') ||
                document.querySelector('div[contenteditable="true"]'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    setNativeValue(el, text);
                } else {
                    el.textContent = '';
                    document.execCommand('insertText', false, text);
                    if (!el.textContent?.trim()) {
                        el.textContent = text;
                    }
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('button[aria-label="Submit"]') ||
                    document.querySelector('button[aria-label="Send"]') ||
                    document.querySelector('button[type="submit"]');
                if (btn && !btn.disabled) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const stop = document.querySelector('[aria-label*="Stop"]') ||
                    document.querySelector('button[class*="stop"]');
                if (stop) return false;
                return document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body');
                if (!msgs.length) return '';
                return msgs[msgs.length - 1].innerText.trim();
            }
        }
    };

    // ── Utility ──────────────────────────────────────────────────────────────

    function setNativeValue(el, value) {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (setter && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            el.focus();
            document.execCommand('insertText', false, value);
            if (!el.textContent?.trim()) {
                el.textContent = value;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
            }
        }
    }

    function getAdapter() {
        for (const [id, adapter] of Object.entries(ADAPTERS)) {
            if (adapter.match()) return { id, ...adapter };
        }
        return null;
    }

    // ── Message Handler ──────────────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const adapter = getAdapter();
        if (!adapter) {
            sendResponse({ success: false, error: 'No matching adapter for this site' });
            return true;
        }

        switch (message.type) {
            case 'INJECT_PROMPT': {
                try {
                    const input = adapter.getInput();
                    if (!input) {
                        sendResponse({ success: false, error: `${adapter.id}: Input element not found` });
                        return true;
                    }

                    adapter.setPrompt(input, message.prompt);

                    // Small delay then submit
                    setTimeout(() => {
                        const submitted = adapter.submit();
                        if (!submitted) {
                            input.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                            }));
                        }
                        sendResponse({ success: true, model: adapter.id });
                    }, 500);

                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                return true;
            }

            case 'EXTRACT_RESPONSE': {
                try {
                    const complete = adapter.isComplete();
                    const response = complete ? adapter.getResponse() : '';
                    sendResponse({
                        success: true,
                        complete,
                        response,
                        model: adapter.id
                    });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                return true;
            }

            default:
                sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
                return true;
        }
    });

    console.log('[LLM Council] Content script loaded for:', getAdapter()?.id || 'unknown site');
})();
