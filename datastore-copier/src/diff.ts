import { Utils } from './utils';
import {
    cleanJsonToDatastore,
    datastoreToCleanJson,
    deepEqual,
    formatSqlQuery,
    isJsonString,
    isQueryKey,
    isQuerySemanticallyEqual,
    minifyJsonProperties,
    minifySqlQuery,
    normalizeSqlQuery
} from './datastore-utils';

export const Diff = {
    isJsonString,
    isQueryKey,
    normalizeSqlQuery,
    formatSqlQuery,
    minifySqlQuery,
    isQuerySemanticallyEqual,
    areValuesEqual: deepEqual,
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

    openJsonEditorModal: async (
        row: HTMLElement,
        propKey: string,
        srcInput: HTMLInputElement | HTMLTextAreaElement | null,
        tgtInput: HTMLInputElement | HTMLTextAreaElement | null,
        srcProject?: string | null,
        tgtProject?: string | null
    ) => {
        let srcRaw = srcInput ? srcInput.value : '';
        let tgtRaw = tgtInput ? tgtInput.value : '';

        const isQuery = isQueryKey(propKey);
        const isJson = !isQuery && (isJsonString(srcRaw) || isJsonString(tgtRaw));
        const mode: 'sql' | 'json' | 'text' = isQuery ? 'sql' : isJson ? 'json' : 'text';

        if (isJson) {
            if (isJsonString(srcRaw)) {
                try { srcRaw = JSON.stringify(JSON.parse(srcRaw.trim()), null, 2); } catch(e) {}
            }
            if (isJsonString(tgtRaw)) {
                try { tgtRaw = JSON.stringify(JSON.parse(tgtRaw.trim()), null, 2); } catch(e) {}
            }
        }

        const tmpl = Utils.$('template-json-editor-modal') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        // Set property key & dynamic modal title
        const propKeySpan = fragment.querySelector('.prop-key-span') as HTMLElement;
        if (propKeySpan) propKeySpan.textContent = propKey;

        const titlePrefix = fragment.querySelector('.modal-title-prefix') as HTMLElement;
        const titleIcon = fragment.querySelector('.modal-title-icon') as HTMLElement;
        const srcColHeader = fragment.querySelector('.src-col-header') as HTMLElement;
        const tgtColHeader = fragment.querySelector('.tgt-col-header') as HTMLElement;

        if (mode === 'sql') {
            if (titlePrefix) titlePrefix.textContent = 'SQL Query Diff & Editor';
            if (titleIcon) titleIcon.className = 'modal-title-icon fa-solid fa-terminal text-cyan-400';
            if (srcColHeader) srcColHeader.textContent = 'SOURCE QUERY (SQL)';
            if (tgtColHeader) tgtColHeader.textContent = 'TARGET QUERY (SQL)';
        } else if (mode === 'json') {
            if (titlePrefix) titlePrefix.textContent = 'JSON Diff & Editor';
            if (titleIcon) titleIcon.className = 'modal-title-icon fa-solid fa-code text-indigo-400';
            if (srcColHeader) srcColHeader.textContent = 'SOURCE VALUE (JSON)';
            if (tgtColHeader) tgtColHeader.textContent = 'TARGET VALUE (JSON)';
        } else {
            if (titlePrefix) titlePrefix.textContent = 'Text Diff & Editor';
            if (titleIcon) titleIcon.className = 'modal-title-icon fa-solid fa-file-lines text-amber-400';
            if (srcColHeader) srcColHeader.textContent = 'SOURCE VALUE (Text)';
            if (tgtColHeader) tgtColHeader.textContent = 'TARGET VALUE (Text)';
        }

        const srcArea = fragment.querySelector('.json-src-area') as HTMLTextAreaElement;
        const tgtArea = fragment.querySelector('.json-tgt-area') as HTMLTextAreaElement;
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
            const rawSrc = liveSrcArea.value;
            const rawTgt = liveTgtArea.value;

            if (mode === 'sql') {
                const queryEquality = isQuerySemanticallyEqual(rawSrc, rawTgt, srcProject, tgtProject);
                if (queryEquality.type === 'identical') {
                    liveSrcStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Exact Query Match';
                    liveSrcStatus.style.color = 'var(--ok)';
                    liveTgtStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Exact Query Match';
                    liveTgtStatus.style.color = 'var(--ok)';
                    liveDiffCont.innerHTML = `<div class="p-2 text-xs font-semibold" style="color:var(--ok)"><i class="fa-solid fa-circle-check"></i> Queries are fully identical.</div>`;
                } else if (queryEquality.type === 'project_mapped') {
                    liveSrcStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Source Project Query';
                    liveSrcStatus.style.color = 'var(--ok)';
                    liveTgtStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Project ID Mapped (Semantic Match)';
                    liveTgtStatus.style.color = 'var(--ok)';
                    liveDiffCont.innerHTML = `
                        <div class="p-2 mb-2 text-xs font-semibold rounded" style="background:var(--ok-dim); border-left: 3px solid var(--ok); color:var(--ok);">
                            <i class="fa-solid fa-circle-check mr-1"></i> Semantic Match: Query logic and {{variables}} match perfectly after Project ID substitution.
                        </div>
                        <div class="text-xs mono" style="color:var(--muted)">
                            <div><strong>Source (${Utils.escapeHtml(srcProject || 'Source')}):</strong> ${Utils.escapeHtml(rawSrc)}</div>
                            <div class="mt-1"><strong>Target (${Utils.escapeHtml(tgtProject || 'Target')}):</strong> ${Utils.escapeHtml(rawTgt)}</div>
                        </div>
                    `;
                } else {
                    liveSrcStatus.innerHTML = '<i class="fa-solid fa-terminal"></i> Source Query';
                    liveSrcStatus.style.color = 'var(--muted)';
                    liveTgtStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Query Differs';
                    liveTgtStatus.style.color = 'var(--warn)';
                    liveDiffCont.innerHTML = `
                        <div class="p-2 mb-2 text-xs font-semibold rounded" style="background:var(--warn-dim); border-left: 3px solid var(--warn); color:var(--warn);">
                            <i class="fa-solid fa-triangle-exclamation mr-1"></i> Query Differences: Columns, conditions, or {{variables}} differ between Source and Target.
                        </div>
                        <div class="text-xs mono" style="color:var(--fg)">
                            <div style="background:var(--danger-dim); padding: 4px 8px; border-radius: 4px; margin-bottom: 4px;">
                                <strong style="color:var(--danger)">- Source:</strong> ${Utils.escapeHtml(rawSrc)}
                            </div>
                            <div style="background:var(--ok-dim); padding: 4px 8px; border-radius: 4px;">
                                <strong style="color:var(--ok)">+ Target:</strong> ${Utils.escapeHtml(rawTgt)}
                            </div>
                        </div>
                    `;
                }
                applyBtn.removeAttribute('disabled');
                return;
            }

            let srcVal: any = null, tgtVal: any = null;
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
                if (rawSrc.trim()) {
                    srcVal = parseInput(rawSrc);
                    liveSrcStatus.innerHTML = isJsonString(rawSrc) ? '<i class="fa-solid fa-circle-check"></i> Valid JSON' : 'Plain Text';
                    liveSrcStatus.style.color = isJsonString(rawSrc) ? 'var(--ok)' : 'var(--muted)';
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
                if (rawTgt.trim()) {
                    tgtVal = parseInput(rawTgt);
                    liveTgtStatus.innerHTML = isJsonString(rawTgt) ? '<i class="fa-solid fa-circle-check"></i> Valid JSON' : 'Plain Text';
                    liveTgtStatus.style.color = isJsonString(rawTgt) ? 'var(--ok)' : 'var(--muted)';
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

        // 150ms debounced live diffing for smooth 5000+ lines editing
        let debounceTimer: any = null;
        const debouncedValidateAndDiff = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                validateAndDiff();
            }, 150);
        };

        liveSrcArea.oninput = debouncedValidateAndDiff;
        liveTgtArea.oninput = debouncedValidateAndDiff;

        const globalQuery = (sel: string) => document.querySelector(sel) as HTMLElement;

        // Configure format / minify action handlers
        globalQuery('.btn-fmt-src').onclick = () => {
            if (mode === 'sql') {
                liveSrcArea.value = formatSqlQuery(liveSrcArea.value);
                validateAndDiff();
            } else {
                try {
                    liveSrcArea.value = JSON.stringify(JSON.parse(liveSrcArea.value), null, 2);
                    validateAndDiff();
                } catch(e) { alert("Invalid Source JSON"); }
            }
        };
        globalQuery('.btn-min-src').onclick = () => {
            if (mode === 'sql') {
                liveSrcArea.value = minifySqlQuery(liveSrcArea.value);
                validateAndDiff();
            } else {
                try {
                    liveSrcArea.value = JSON.stringify(JSON.parse(liveSrcArea.value));
                    validateAndDiff();
                } catch(e) { alert("Invalid Source JSON"); }
            }
        };

        globalQuery('.btn-fmt-tgt').onclick = () => {
            if (mode === 'sql') {
                liveTgtArea.value = formatSqlQuery(liveTgtArea.value);
                validateAndDiff();
            } else {
                try {
                    liveTgtArea.value = JSON.stringify(JSON.parse(liveTgtArea.value), null, 2);
                    validateAndDiff();
                } catch(e) { alert("Invalid Target JSON"); }
            }
        };
        globalQuery('.btn-min-tgt').onclick = () => {
            if (mode === 'sql') {
                liveTgtArea.value = minifySqlQuery(liveTgtArea.value);
                validateAndDiff();
            } else {
                try {
                    liveTgtArea.value = JSON.stringify(JSON.parse(liveTgtArea.value));
                    validateAndDiff();
                } catch(e) { alert("Invalid Target JSON"); }
            }
        };

        // Copy utilities
        const labelType = mode === 'sql' ? 'Query' : mode === 'json' ? 'JSON' : 'Text';
        globalQuery('.btn-copy-src').onclick = () => {
            navigator.clipboard.writeText(liveSrcArea.value);
            Utils.toast(`Copied Source ${labelType} to clipboard`, "ok");
        };
        globalQuery('.btn-copy-tgt').onclick = () => {
            navigator.clipboard.writeText(liveTgtArea.value);
            Utils.toast(`Copied Target ${labelType} to clipboard`, "ok");
        };

        globalQuery('.btn-json-close').onclick = () => UI.closeModal();
        globalQuery('.btn-json-cancel').onclick = () => UI.closeModal();

        applyBtn.onclick = () => {
            try {
                const getAppliedVal = (val: string) => {
                    if (mode === 'json') {
                        val = val.trim();
                        try {
                            return JSON.stringify(JSON.parse(val));
                        } catch(e) {
                            return val;
                        }
                    }
                    return val;
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
                Utils.toast(`Applied ${labelType} edits to properties table.`, "ok");
            } catch(e) {
                alert(`Please ensure the values are valid before applying changes.`);
            }
        };

        validateAndDiff();
    },

    datastoreToCleanJson,
    cleanJsonToDatastore,
    minifyJsonProperties
};

