import { Utils } from './utils';

export const Diff = {
    isJsonString: (str: string): boolean => {
        if (!str || typeof str !== 'string') return false;
        const trimmed = str.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                JSON.parse(trimmed);
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    },
    areValuesEqual: (a: any, b: any): boolean => {
        if (a === b) return true;
        if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
        
        const isArrA = Array.isArray(a);
        const isArrB = Array.isArray(b);
        if (isArrA !== isArrB) return false;
        
        if (isArrA) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!Diff.areValuesEqual(a[i], b[i])) return false;
            }
            return true;
        }
        
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        
        for (const k of keysA) {
            if (!(k in b)) return false;
            if (!Diff.areValuesEqual(a[k], b[k])) return false;
        }
        return true;
    },
    getJsonDiffHtml: (obj1: any, obj2: any): string => {
        if (Diff.areValuesEqual(obj1, obj2)) {
            if (typeof obj1 !== 'object' || obj1 === null) {
                return `<span style="color:var(--ok)">${Utils.escapeHtml(JSON.stringify(obj1))}</span>`;
            }
            if (Array.isArray(obj1)) {
                return `<span style="color:var(--ok)">[Array of ${obj1.length} items] (identical)</span>`;
            }
            return `<span style="color:var(--ok)">{Object of ${Object.keys(obj1).length} keys} (identical)</span>`;
        }

        if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
            return `<span style="color:var(--danger)">${Utils.escapeHtml(JSON.stringify(obj1))}</span> &rarr; <span style="color:var(--ok)">${Utils.escapeHtml(JSON.stringify(obj2))}</span>`;
        }

        const isArray1 = Array.isArray(obj1);
        const isArray2 = Array.isArray(obj2);

        if (isArray1 !== isArray2) {
            return `<span style="color:var(--danger)">${Utils.escapeHtml(JSON.stringify(obj1))}</span> &rarr; <span style="color:var(--ok)">${Utils.escapeHtml(JSON.stringify(obj2))}</span>`;
        }

        if (isArray1) {
            let html = '<span style="color:var(--muted)">[</span><div style="padding-left: 16px;">';
            const maxLen = Math.max(obj1.length, obj2.length);
            for (let i = 0; i < maxLen; i++) {
                const has1 = i < obj1.length;
                const has2 = i < obj2.length;
                if (has1 && !has2) {
                    html += `<div style="background:var(--danger-dim); border-left: 2px solid var(--danger); padding-left: 4px; margin-bottom: 2px;">`;
                    html += `<span style="color:var(--danger); font-weight:600;">[Index ${i}]:</span> ${Utils.escapeHtml(JSON.stringify(obj1[i]))} <span style="color:var(--muted)">(removed)</span></div>`;
                } else if (!has1 && has2) {
                    html += `<div style="background:var(--ok-dim); border-left: 2px solid var(--ok); padding-left: 4px; margin-bottom: 2px;">`;
                    html += `<span style="color:var(--ok); font-weight:600;">[Index ${i}]:</span> ${Utils.escapeHtml(JSON.stringify(obj2[i]))} <span style="color:var(--muted)">(added)</span></div>`;
                } else {
                    const diffHtml = Diff.getJsonDiffHtml(obj1[i], obj2[i]);
                    if (Diff.areValuesEqual(obj1[i], obj2[i])) {
                        html += `<div><span style="color:var(--muted)">[Index ${i}]:</span> ${diffHtml}</div>`;
                    } else {
                        html += `<div style="background:var(--warn-dim); border-left: 2px solid var(--warn); padding-left: 4px; margin-bottom: 2px;">`;
                        html += `<span style="color:var(--warn); font-weight:600;">[Index ${i}]:</span> ${diffHtml}</div>`;
                    }
                }
            }
            html += '</div><span style="color:var(--muted)">]</span>';
            return html;
        }

        const allKeys = Array.from(new Set([...Object.keys(obj1), ...Object.keys(obj2)])).sort();
        let html = '<span style="color:var(--muted)">{</span><div style="padding-left: 16px;">';
        allKeys.forEach(k => {
            const has1 = k in obj1;
            const has2 = k in obj2;
            if (has1 && !has2) {
                html += `<div style="background:var(--danger-dim); border-left: 2px solid var(--danger); padding-left: 4px; margin-bottom: 2px; word-break: break-all;">`;
                html += `<span style="color:var(--danger); font-weight:600;">"${Utils.escapeHtml(k)}":</span> ${Utils.escapeHtml(JSON.stringify(obj1[k]))} <span style="color:var(--muted)">(removed)</span></div>`;
            } else if (!has1 && has2) {
                html += `<div style="background:var(--ok-dim); border-left: 2px solid var(--ok); padding-left: 4px; margin-bottom: 2px; word-break: break-all;">`;
                html += `<span style="color:var(--ok); font-weight:600;">"${Utils.escapeHtml(k)}":</span> ${Utils.escapeHtml(JSON.stringify(obj2[k]))} <span style="color:var(--muted)">(added)</span></div>`;
            } else {
                const diffHtml = Diff.getJsonDiffHtml(obj1[k], obj2[k]);
                if (Diff.areValuesEqual(obj1[k], obj2[k])) {
                    html += `<div style="word-break: break-all;"><span style="color:var(--muted)">"${Utils.escapeHtml(k)}":</span> ${diffHtml}</div>`;
                } else {
                    html += `<div style="background:var(--warn-dim); border-left: 2px solid var(--warn); padding-left: 4px; margin-bottom: 2px; word-break: break-all;">`;
                    html += `<span style="color:var(--warn); font-weight:600;">"${Utils.escapeHtml(k)}":</span> ${diffHtml}</div>`;
                }
            }
        });
        html += '</div><span style="color:var(--muted)">}</span>';
        return html;
    },

    openJsonEditorModal: async (row: HTMLElement, propKey: string, srcInput: HTMLInputElement | HTMLTextAreaElement | null, tgtInput: HTMLInputElement | HTMLTextAreaElement | null) => {
        let srcRaw = srcInput ? srcInput.value.trim() : '';
        let tgtRaw = tgtInput ? tgtInput.value.trim() : '';

        if (!srcRaw) srcRaw = '{}';
        if (!tgtRaw) tgtRaw = '{}';

        try { srcRaw = JSON.stringify(JSON.parse(srcRaw), null, 2); } catch(e) {}
        try { tgtRaw = JSON.stringify(JSON.parse(tgtRaw), null, 2); } catch(e) {}

        const tmpl = Utils.$('template-json-editor-modal') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        // Set property key
        const propKeySpan = fragment.querySelector('.prop-key-span') as HTMLElement;
        if (propKeySpan) propKeySpan.textContent = propKey;

        const srcArea = fragment.querySelector('.json-src-area') as HTMLTextAreaElement;
        const tgtArea = fragment.querySelector('.json-tgt-area') as HTMLTextAreaElement;
        const srcStatus = fragment.querySelector('.json-src-status') as HTMLElement;
        const tgtStatus = fragment.querySelector('.json-tgt-status') as HTMLElement;
        const diffCont = fragment.querySelector('.json-diff-container') as HTMLElement;

        srcArea.value = srcRaw;
        tgtArea.value = tgtRaw;

        const { UI } = await import('./ui');
        UI.openModal(fragment, true);

        // Re-fetch attached DOM elements under modal root
        const liveSrcArea = document.querySelector('.json-src-area') as HTMLTextAreaElement;
        const liveTgtArea = document.querySelector('.json-tgt-area') as HTMLTextAreaElement;
        const liveSrcStatus = document.querySelector('.json-src-status') as HTMLElement;
        const liveTgtStatus = document.querySelector('.json-tgt-status') as HTMLElement;
        const liveDiffCont = document.querySelector('.json-diff-container') as HTMLElement;
        const applyBtn = document.querySelector('.btn-json-save-apply') as HTMLButtonElement;

        const validateAndDiff = () => {
            let srcVal = null, tgtVal = null;
            let srcOk = true, tgtOk = true;

            const parseInput = (valStr: string) => {
                const trimmed = valStr.trim();
                if (!trimmed) return null;
                const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
                if (looksLikeJson) {
                    return JSON.parse(trimmed);
                }
                try {
                    return JSON.parse(trimmed);
                } catch(e) {
                    if (trimmed === 'true') return true;
                    if (trimmed === 'false') return false;
                    if (!isNaN(Number(trimmed))) return Number(trimmed);
                    return trimmed;
                }
            };

            try {
                const raw = liveSrcArea.value;
                if (raw.trim()) {
                    srcVal = parseInput(raw);
                    liveSrcStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Valid JSON';
                    liveSrcStatus.style.color = 'var(--ok)';
                } else {
                    liveSrcStatus.innerHTML = 'Empty Value';
                    liveSrcStatus.style.color = 'var(--muted)';
                }
            } catch(e: any) {
                srcOk = false;
                liveSrcStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Invalid JSON: ${Utils.escapeHtml(e.message)}`;
                liveSrcStatus.style.color = 'var(--danger)';
            }

            try {
                const raw = liveTgtArea.value;
                if (raw.trim()) {
                    tgtVal = parseInput(raw);
                    liveTgtStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Valid JSON';
                    liveTgtStatus.style.color = 'var(--ok)';
                } else {
                    liveTgtStatus.innerHTML = 'Empty Value';
                    liveTgtStatus.style.color = 'var(--muted)';
                }
            } catch(e: any) {
                tgtOk = false;
                liveTgtStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Invalid JSON: ${Utils.escapeHtml(e.message)}`;
                liveTgtStatus.style.color = 'var(--danger)';
            }

            if (srcOk && tgtOk) {
                liveDiffCont.innerHTML = Diff.getJsonDiffHtml(srcVal, tgtVal);
                applyBtn.removeAttribute('disabled');
            } else {
                liveDiffCont.innerHTML = '<span style="color:var(--muted)">Resolve syntax errors above to display differences...</span>';
                applyBtn.setAttribute('disabled', 'true');
            }
        };

        liveSrcArea.oninput = validateAndDiff;
        liveTgtArea.oninput = validateAndDiff;

        const globalQuery = (sel: string) => document.querySelector(sel) as HTMLElement;
        
        globalQuery('.btn-fmt-src').onclick = () => {
            try {
                liveSrcArea.value = JSON.stringify(JSON.parse(liveSrcArea.value), null, 2);
                validateAndDiff();
            } catch(e) { alert("Invalid Source JSON"); }
        };
        globalQuery('.btn-min-src').onclick = () => {
            try {
                liveSrcArea.value = JSON.stringify(JSON.parse(liveSrcArea.value));
                validateAndDiff();
            } catch(e) { alert("Invalid Source JSON"); }
        };

        globalQuery('.btn-fmt-tgt').onclick = () => {
            try {
                liveTgtArea.value = JSON.stringify(JSON.parse(liveTgtArea.value), null, 2);
                validateAndDiff();
            } catch(e) { alert("Invalid Target JSON"); }
        };
        globalQuery('.btn-min-tgt').onclick = () => {
            try {
                liveTgtArea.value = JSON.stringify(JSON.parse(liveTgtArea.value));
                validateAndDiff();
            } catch(e) { alert("Invalid Target JSON"); }
        };

        // Copy utilities
        globalQuery('.btn-copy-src').onclick = () => {
            navigator.clipboard.writeText(liveSrcArea.value);
            Utils.toast("Copied Source JSON to clipboard", "ok");
        };
        globalQuery('.btn-copy-tgt').onclick = () => {
            navigator.clipboard.writeText(liveTgtArea.value);
            Utils.toast("Copied Target JSON to clipboard", "ok");
        };

        globalQuery('.btn-json-close').onclick = () => UI.closeModal();
        globalQuery('.btn-json-cancel').onclick = () => UI.closeModal();

        applyBtn.onclick = () => {
            try {
                const getAppliedVal = (val: string) => {
                    val = val.trim();
                    try {
                        return JSON.stringify(JSON.parse(val));
                    } catch(e) {
                        return val;
                    }
                };
                
                const cleanSrc = getAppliedVal(liveSrcArea.value);
                const cleanTgt = getAppliedVal(liveTgtArea.value);
                
                if (srcInput) {
                    srcInput.value = cleanSrc;
                    if (srcInput.classList.contains('raw-val-src')) {
                        const visibleInp = row.querySelector('.val-src') as HTMLInputElement | null;
                        if (visibleInp) {
                            visibleInp.value = cleanSrc.includes('\n') ? cleanSrc.split('\n')[0] + '...' : cleanSrc;
                        }
                    }
                }
                if (tgtInput) {
                    tgtInput.value = cleanTgt;
                    if (tgtInput.classList.contains('raw-val-tgt')) {
                        const visibleInp = row.querySelector('.val-tgt') as HTMLInputElement | null;
                        if (visibleInp) {
                            visibleInp.value = cleanTgt.includes('\n') ? cleanTgt.split('\n')[0] + '...' : cleanTgt;
                        }
                    }
                }
                
                UI.closeModal();
                Utils.toast("Applied JSON edits to properties table.", "ok");
            } catch(e) {
                alert("Please ensure both JSONs are syntax-valid before applying changes.");
            }
        };

        validateAndDiff();
    },

    datastoreToCleanJson: (val: any): any => {
        if (!val || typeof val !== 'object') return val;
        const k = Object.keys(val)[0];
        if (k === 'nullValue') return null;
        if (k === 'booleanValue') return val.booleanValue;
        if (k === 'integerValue') return parseInt(val.integerValue, 10);
        if (k === 'doubleValue') return val.doubleValue;
        if (k === 'stringValue') return val.stringValue;
        if (k === 'timestampValue') return val.timestampValue;
        if (k === 'blobValue') return val.blobValue;
        if (k === 'arrayValue') {
            return (val.arrayValue.values || []).map((v: any) => Diff.datastoreToCleanJson(v));
        }
        if (k === 'mapValue') {
            const res: any = {};
            const props = val.mapValue.properties || {};
            for (const key in props) {
                res[key] = Diff.datastoreToCleanJson(props[key]);
            }
            return res;
        }
        if (k === 'entityValue') {
            const res: any = {};
            const props = val.entityValue.properties || {};
            for (const key in props) {
                res[key] = Diff.datastoreToCleanJson(props[key]);
            }
            return res;
        }
        return val[k];
    },
    cleanJsonToDatastore: (val: any): any => {
        if (val === null) return { nullValue: null };
        if (typeof val === 'boolean') return { booleanValue: val };
        if (typeof val === 'number') {
            if (Number.isInteger(val)) return { integerValue: String(val) };
            return { doubleValue: val };
        }
        if (typeof val === 'string') return { stringValue: val };
        if (Array.isArray(val)) {
            return { arrayValue: { values: val.map(v => Diff.cleanJsonToDatastore(v)) } };
        }
        if (typeof val === 'object') {
            const props: any = {};
            for (const k in val) {
                props[k] = Diff.cleanJsonToDatastore(val[k]);
            }
            return { mapValue: { properties: props } };
        }
        return { stringValue: String(val) };
    },
    minifyJsonProperties: (props: any): void => {
        if (!props || typeof props !== 'object') return;
        for (const k in props) {
            const p = props[k];
            if (!p || typeof p !== 'object') continue;
            
            if ('stringValue' in p) {
                const str = p.stringValue;
                if (str && typeof str === 'string' && (str.trim().startsWith('{') || str.trim().startsWith('['))) {
                    try {
                        const parsed = JSON.parse(str);
                        p.stringValue = JSON.stringify(parsed);
                    } catch(e) {}
                }
            } else if (p.arrayValue && Array.isArray(p.arrayValue.values)) {
                p.arrayValue.values.forEach((subVal: any) => {
                    const subProps = subVal.entityValue?.properties || subVal.mapValue?.properties;
                    if (subProps) Diff.minifyJsonProperties(subProps);
                });
            } else if (p.entityValue && p.entityValue.properties) {
                Diff.minifyJsonProperties(p.entityValue.properties);
            } else if (p.mapValue && p.mapValue.properties) {
                Diff.minifyJsonProperties(p.mapValue.properties);
            }
        }
    }
};
