/**
 * LLM Council — Gemini Adapter
 * Handles DOM interaction for gemini.google.com
 */

import { BaseAdapter } from './base-adapter.js';

export class GeminiAdapter extends BaseAdapter {
    constructor() {
        super('gemini');
    }

    getInputElement() {
        // Gemini uses a rich text editor or a contenteditable div
        return document.querySelector('.ql-editor[contenteditable="true"]')
            || document.querySelector('div[contenteditable="true"][aria-label*="prompt"]')
            || document.querySelector('.text-input-field_textarea')
            || document.querySelector('rich-textarea .ql-editor')
            || document.querySelector('div[contenteditable="true"]');
    }

    setPrompt(text) {
        const el = this.getInputElement();
        if (!el) throw new Error('Gemini input element not found');

        el.focus();

        if (el.classList.contains('ql-editor')) {
            // Quill editor — set paragraph content
            el.innerHTML = `<p>${text}</p>`;
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        } else {
            this._setNativeValue(el, text);
        }
    }

    submit() {
        // Gemini's send button
        const sendBtn = document.querySelector('button.send-button')
            || document.querySelector('[aria-label="Send message"]')
            || document.querySelector('button[mattooltip="Send message"]')
            || document.querySelector('.send-button-container button');

        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return;
        }

        const el = this.getInputElement();
        if (el) this._pressEnter(el);
    }

    isResponseComplete() {
        // When Gemini is generating, there's usually a loading indicator or streaming class
        const loading = document.querySelector('.loading-indicator')
            || document.querySelector('.response-streaming')
            || document.querySelector('mat-progress-bar');

        if (loading) return false;

        // Check if send button is re-enabled (not showing stop)
        const stopBtn = document.querySelector('[aria-label="Stop response"]')
            || document.querySelector('button.stop-button');

        if (stopBtn) return false;

        // Verify at least one model response exists
        const responses = document.querySelectorAll('.model-response-text, .response-container-content');
        return responses.length > 0;
    }

    getResponse() {
        const responses = document.querySelectorAll('.model-response-text, .response-container-content, message-content');
        if (responses.length === 0) return '';

        const lastResponse = responses[responses.length - 1];
        return lastResponse.innerText.trim();
    }
}
