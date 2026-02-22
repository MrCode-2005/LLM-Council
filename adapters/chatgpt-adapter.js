/**
 * LLM Council — ChatGPT Adapter
 * Handles DOM interaction for chatgpt.com / chat.openai.com
 */

import { BaseAdapter } from './base-adapter.js';

export class ChatGPTAdapter extends BaseAdapter {
    constructor() {
        super('chatgpt');
    }

    getInputElement() {
        // ChatGPT uses a contenteditable div with id="prompt-textarea" or a <textarea>
        return document.querySelector('#prompt-textarea')
            || document.querySelector('textarea[data-id="root"]')
            || document.querySelector('div[contenteditable="true"]');
    }

    setPrompt(text) {
        const el = this.getInputElement();
        if (!el) throw new Error('ChatGPT input element not found');

        el.focus();

        if (el.tagName === 'TEXTAREA') {
            this._setNativeValue(el, text);
        } else {
            // contenteditable <div> — ChatGPT's ProseMirror editor
            const paragraph = el.querySelector('p');
            if (paragraph) {
                paragraph.textContent = text;
            } else {
                el.textContent = text;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        }
    }

    submit() {
        // ChatGPT has a send button with data-testid="send-button" or aria-label
        const sendBtn = document.querySelector('[data-testid="send-button"]')
            || document.querySelector('button[aria-label="Send prompt"]')
            || document.querySelector('form button[type="submit"]');

        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return;
        }

        // Fallback: press Enter in the input
        const el = this.getInputElement();
        if (el) this._pressEnter(el);
    }

    isResponseComplete() {
        // When ChatGPT is generating, the send button becomes a "stop" button
        const stopBtn = document.querySelector('[data-testid="stop-button"]')
            || document.querySelector('[aria-label="Stop generating"]');

        // No stop button visible means generation is complete
        if (!stopBtn) {
            // Also check that at least one assistant message exists
            const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
            return messages.length > 0;
        }
        return false;
    }

    getResponse() {
        // Get the last assistant message
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (messages.length === 0) return '';

        const lastMsg = messages[messages.length - 1];
        const markdown = lastMsg.querySelector('.markdown');
        return (markdown || lastMsg).innerText.trim();
    }
}
