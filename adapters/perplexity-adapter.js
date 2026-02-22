/**
 * LLM Council — Perplexity Adapter
 * Handles DOM interaction for perplexity.ai
 */

import { BaseAdapter } from './base-adapter.js';

export class PerplexityAdapter extends BaseAdapter {
    constructor() {
        super('perplexity');
    }

    getInputElement() {
        return document.querySelector('textarea[placeholder*="Ask"]')
            || document.querySelector('textarea')
            || document.querySelector('div[contenteditable="true"]');
    }

    setPrompt(text) {
        const el = this.getInputElement();
        if (!el) throw new Error('Perplexity input element not found');

        el.focus();

        if (el.tagName === 'TEXTAREA') {
            this._setNativeValue(el, text);
        } else {
            this._setNativeValue(el, text);
        }
    }

    submit() {
        const sendBtn = document.querySelector('button[aria-label="Submit"]')
            || document.querySelector('button.bg-super')
            || document.querySelector('button[type="submit"]');

        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return;
        }

        const el = this.getInputElement();
        if (el) {
            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
            }));
        }
    }

    isResponseComplete() {
        // Check for active generation indicators
        const loading = document.querySelector('[class*="loading"]')
            || document.querySelector('.animate-spin')
            || document.querySelector('[class*="streaming"]');

        if (loading) return false;

        const answers = document.querySelectorAll('.prose, [class*="answer"]');
        return answers.length > 0;
    }

    getResponse() {
        const answers = document.querySelectorAll('.prose');
        if (answers.length === 0) return '';

        const lastAnswer = answers[answers.length - 1];
        return lastAnswer.innerText.trim();
    }
}
