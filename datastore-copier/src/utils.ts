import { QuotesManager } from './quotes';

export const Utils = {
    $: (id: string): HTMLElement | null => document.getElementById(id),

    getInput: (id: string): HTMLInputElement => {
        const el = document.getElementById(id);
        if (!el || !(el instanceof HTMLInputElement)) {
            throw new Error(`Critical input element missing: #${id}`);
        }
        return el;
    },
    getSelect: (id: string): HTMLSelectElement => {
        const el = document.getElementById(id);
        if (!el || !(el instanceof HTMLSelectElement)) {
            throw new Error(`Critical select element missing: #${id}`);
        }
        return el;
    },
    getButton: (id: string): HTMLButtonElement => {
        const el = document.getElementById(id);
        if (!el || !(el instanceof HTMLButtonElement)) {
            throw new Error(`Critical button element missing: #${id}`);
        }
        return el;
    },
    getHtml: (id: string): HTMLElement => {
        const el = document.getElementById(id);
        if (!el) {
            throw new Error(`Critical UI component missing: #${id}`);
        }
        return el;
    },

    show: (id: string): void => {
        const el = Utils.$(id);
        if (el) {
            if (id === 'sec-loading') {
                el.classList.add('active-overlay');
                el.style.display = 'flex';
                QuotesManager.startLoadingQuotes();
            } else {
                el.style.display = '';
            }
        }
    },
    hide: (id: string): void => {
        const el = Utils.$(id);
        if (el) {
            if (id === 'sec-loading') {
                el.classList.remove('active-overlay');
                QuotesManager.stopLoadingQuotes();
            }
            el.style.display = 'none';
        }
    },
    toast: (msg: string, type: 'info' | 'ok' | 'warn' | 'err' = 'info'): void => {
        const c = Utils.$('toast-container');
        if (!c) return;
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { info: 'info', ok: 'circle-check', warn: 'triangle-exclamation', err: 'triangle-exclamation' };
        el.innerHTML = `<i class="fa-solid fa-${icons[type]}"></i><span>${Utils.escapeHtml(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.classList.add('on'), 10);
        setTimeout(() => {
            el.classList.remove('on');
            setTimeout(() => el.remove(), 400);
        }, 4000);
    },
    escapeHtml: (str: string): string => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },
    copyText: (text: string): void => {
        navigator.clipboard.writeText(text).then(() => {
            Utils.toast("Copied to clipboard!", "ok");
        }).catch(err => {
            console.error("Clipboard copy failed:", err);
            Utils.toast("Copy failed", "err");
        });
    },
    Crypto: {
        encrypt: (data: string, key: string): string => {
            return btoa(unescape(encodeURIComponent(data + "::" + key)));
        },
        decrypt: (hash: string, key: string): string => {
            try {
                const dec = decodeURIComponent(escape(atob(hash)));
                const parts = dec.split("::");
                if (parts[1] === key) return parts[0];
                return "";
            } catch (e) {
                return "";
            }
        }
    },
    Storage: {
        get: (key: 'access_token' | 'auth_email'): string | null => {
            return localStorage.getItem(key);
        },
        set: (key: 'access_token' | 'auth_email', val: string): void => {
            localStorage.setItem(key, val);
        }
    }
};

export const ErrorBoundary = {
    handle: async (error: Error, context: string, stateMode = 'general'): Promise<void> => {
        console.error(`[${context}] Error occurred:`, error);
        Utils.toast(error.message, 'err');

        try {
            const { AuditLog } = await import('./audit');
            const { State } = await import('./state');
            if (State.token) {
                await AuditLog.addLog(
                    `ERROR_EXCEPT_${context.toUpperCase()}`,
                    "—",
                    "—",
                    `Exception in ${context}: ${error.message}`,
                    "FAILED"
                );
            }
        } catch(auditErr) {
            console.error("Failed to write to audit log in ErrorBoundary", auditErr);
        }
    }
};
