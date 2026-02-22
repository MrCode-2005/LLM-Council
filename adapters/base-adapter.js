/**
 * LLM Council — Base Adapter Interface
 *
 * Each AI site adapter must extend this class and implement
 * all methods to handle DOM interaction for that specific site.
 */

export class BaseAdapter {
    constructor(modelId) {
        this.modelId = modelId;
        this._observer = null;
    }

    /**
     * Get the input element (textarea or contenteditable div).
     * @returns {HTMLElement|null}
     */
    getInputElement() {
        throw new Error(`${this.modelId}: getInputElement() not implemented`);
    }

    /**
     * Set the prompt text into the input element.
     * @param {string} text
     */
    setPrompt(text) {
        throw new Error(`${this.modelId}: setPrompt() not implemented`);
    }

    /**
     * Submit the prompt (click send button or trigger Enter).
     */
    submit() {
        throw new Error(`${this.modelId}: submit() not implemented`);
    }

    /**
     * Check whether the model has finished generating its response.
     * @returns {boolean}
     */
    isResponseComplete() {
        throw new Error(`${this.modelId}: isResponseComplete() not implemented`);
    }

    /**
     * Extract the latest response text from the page.
     * @returns {string}
     */
    getResponse() {
        throw new Error(`${this.modelId}: getResponse() not implemented`);
    }

    // ── Shared Utilities ────────────────────────────────────────────────────

    /**
     * Simulate realistic typing into an input element.
     */
    _setNativeValue(element, value) {
        // For textarea / input elements
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter && (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')) {
            nativeInputValueSetter.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }

        // For contenteditable divs
        element.focus();
        element.textContent = '';

        // Use execCommand for contenteditable (triggers React/framework handlers)
        document.execCommand('insertText', false, value);

        // Fallback: set directly
        if (!element.textContent || element.textContent.trim() !== value.trim()) {
            element.textContent = value;
            element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
        }
    }

    /**
     * Wait for an element matching a selector to appear in the DOM.
     * @param {string} selector
     * @param {number} timeoutMs
     * @returns {Promise<HTMLElement>}
     */
    _waitForElement(selector, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);

            const timeout = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for: ${selector}`));
            }, timeoutMs);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    clearTimeout(timeout);
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    /**
     * Simulate pressing Enter on an element.
     */
    _pressEnter(element) {
        element.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
    }

    /**
     * Poll until a condition is true.
     * @param {Function} conditionFn - Returns boolean
     * @param {number} intervalMs
     * @param {number} timeoutMs
     * @returns {Promise<void>}
     */
    _pollUntil(conditionFn, intervalMs = 2000, timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (conditionFn()) return resolve();
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error('Polling timed out'));
                }
                setTimeout(check, intervalMs);
            };
            check();
        });
    }
}
