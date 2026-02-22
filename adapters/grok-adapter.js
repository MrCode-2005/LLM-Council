/**
 * LLM Council — Grok Adapter
 * Handles DOM interaction for grok.com / x.com/i/grok
 */

import { BaseAdapter } from './base-adapter.js';

export class GrokAdapter extends BaseAdapter {
    constructor() {
        super('grok');
    }

    getInputElement() {
        return document.querySelector('textarea[placeholder*="Ask"]')
            || document.querySelector('textarea')
            || document.querySelector('div[contenteditable="true"]');
    }

    setPrompt(text) {
        const el = this.getInputElement();
        if (!el) throw new Error('Grok input element not found');

        el.focus();

        if (el.tagName === 'TEXTAREA') {
            this._setNativeValue(el, text);
        } else {
            this._setNativeValue(el, text);
        }
    }

    submit() {
        const sendBtn = document.querySelector('button[aria-label="Send"]')
            || document.querySelector('button[aria-label="Submit"]')
            || document.querySelector('button[type="submit"]');

        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return;
        }

        const el = this.getInputElement();
        if (el) this._pressEnter(el);
    }

    isResponseComplete() {
        const stopBtn = document.querySelector('[aria-label*="Stop"]')
            || document.querySelector('button[class*="stop"]');

        if (stopBtn) return false;

        const responses = document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body');
        return responses.length > 0;
    }

    getResponse() {
        const responses = document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body');
        if (responses.length === 0) return '';

        const last = responses[responses.length - 1];
        return last.innerText.trim();
    }
}
