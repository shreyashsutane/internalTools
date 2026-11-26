import { DsResult } from './state';
import { datastoreValueToEditorText } from './datastore-utils';

export interface HtmlReportMeta {
    srcProject: string;
    tgtProject: string;
    srcDb: string;
    tgtDb: string;
    operatorEmail: string;
    generatedAt: string;
    stats: {
        total: number;
        identical: number;
        mapped: number;
        different: number;
        missing: number;
    };
}

interface DiffLine {
    type: 'ctx' | 'del' | 'add' | 'skip';
    oldLine?: number;
    newLine?: number;
    text: string;
    skippedCount?: number;
}

const escapeHtml = (str: string): string =>
    String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Computes a compact line-by-line diff with surrounding context lines,
 * trimming common prefix/suffix first so 4,000+ line queries diff in milliseconds.
 */
export const computeLineDiffHunks = (srcText: string, tgtText: string, contextLines = 3): DiffLine[] => {
    const a = srcText.replace(/\r\n/g, '\n').split('\n');
    const b = tgtText.replace(/\r\n/g, '\n').split('\n');

    let prefix = 0;
    const minLen = Math.min(a.length, b.length);
    while (prefix < minLen && a[prefix] === b[prefix]) prefix++;

    let suffix = 0;
    while (
        suffix < minLen - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) {
        suffix++;
    }

    const midA = a.slice(prefix, a.length - suffix);
    const midB = b.slice(prefix, b.length - suffix);

    const rawOps: Array<{ type: 'ctx' | 'del' | 'add'; oldLine?: number; newLine?: number; text: string }> = [];

    for (let i = 0; i < prefix; i++) {
        rawOps.push({ type: 'ctx', oldLine: i + 1, newLine: i + 1, text: a[i] });
    }

    if (midA.length * midB.length <= 250000) {
        const m = midA.length;
        const n = midB.length;
        const dp = new Int32Array((m + 1) * (n + 1));
        const stride = n + 1;
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                if (midA[i] === midB[j]) {
                    dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)] + 1;
                } else {
                    const down = dp[(i + 1) * stride + j];
                    const right = dp[i * stride + (j + 1)];
                    dp[i * stride + j] = down >= right ? down : right;
                }
            }
        }
        let i = 0;
        let j = 0;
        while (i < m && j < n) {
            if (midA[i] === midB[j]) {
                rawOps.push({ type: 'ctx', oldLine: prefix + i + 1, newLine: prefix + j + 1, text: midA[i] });
                i++;
                j++;
            } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
                rawOps.push({ type: 'del', oldLine: prefix + i + 1, text: midA[i] });
                i++;
            } else {
                rawOps.push({ type: 'add', newLine: prefix + j + 1, text: midB[j] });
                j++;
            }
        }
        while (i < m) {
            rawOps.push({ type: 'del', oldLine: prefix + i + 1, text: midA[i] });
            i++;
        }
        while (j < n) {
            rawOps.push({ type: 'add', newLine: prefix + j + 1, text: midB[j] });
            j++;
        }
    } else {
        for (let i = 0; i < midA.length; i++) {
            rawOps.push({ type: 'del', oldLine: prefix + i + 1, text: midA[i] });
        }
        for (let j = 0; j < midB.length; j++) {
            rawOps.push({ type: 'add', newLine: prefix + j + 1, text: midB[j] });
        }
    }

    const sufStartA = a.length - suffix;
    const sufStartB = b.length - suffix;
    for (let i = 0; i < suffix; i++) {
        rawOps.push({ type: 'ctx', oldLine: sufStartA + i + 1, newLine: sufStartB + i + 1, text: a[sufStartA + i] });
    }

    // Keep only changed lines + contextLines around them; collapse unchanged runs
    const keep = new Uint8Array(rawOps.length);
    for (let idx = 0; idx < rawOps.length; idx++) {
        if (rawOps[idx].type !== 'ctx') {
            const start = Math.max(0, idx - contextLines);
            const end = Math.min(rawOps.length - 1, idx + contextLines);
            for (let k = start; k <= end; k++) keep[k] = 1;
        }
    }

    const result: DiffLine[] = [];
    let skipped = 0;
    for (let idx = 0; idx < rawOps.length; idx++) {
        if (keep[idx]) {
            if (skipped > 0) {
                result.push({ type: 'skip', text: `... ${skipped} unchanged line${skipped === 1 ? '' : 's'} ...`, skippedCount: skipped });
                skipped = 0;
            }
            result.push(rawOps[idx]);
        } else {
            skipped++;
        }
    }
    if (skipped > 0) {
        result.push({ type: 'skip', text: `... ${skipped} unchanged line${skipped === 1 ? '' : 's'} ...`, skippedCount: skipped });
    }
    return result;
};

const extractFullPropertyString = (entity: any, propName: string): string => {
    const propVal = entity?.properties?.[propName];
    if (!propVal) return '';
    if (typeof propVal.stringValue === 'string') return propVal.stringValue;
    return datastoreValueToEditorText(propVal);
};

const renderPropertyDiffBlock = (result: DsResult, diffItem: any, idx: number): string => {
    const propName = String(diffItem.prop || '');
    const diffType = String(diffItem.type || 'modified');
    const srcFull = result.srcEntity ? extractFullPropertyString(result.srcEntity, propName) : String(diffItem.src ?? '');
    const tgtFull = result.tgtEntity ? extractFullPropertyString(result.tgtEntity, propName) : String(diffItem.tgt ?? '');

    const isMultiline = srcFull.includes('\n') || tgtFull.includes('\n') || srcFull.length > 240 || tgtFull.length > 240;

    if (isMultiline) {
        const hunks = computeLineDiffHunks(srcFull, tgtFull, 3);
        const hunkRows = hunks.length > 0
            ? hunks.map(h => {
                if (h.type === 'skip') {
                    return `<div class="diff-line diff-skip"><span class="ln"></span><span class="ln"></span><span class="sig">···</span><span class="code">${escapeHtml(h.text)}</span></div>`;
                }
                const cls = h.type === 'del' ? 'diff-del' : h.type === 'add' ? 'diff-add' : 'diff-ctx';
                const sig = h.type === 'del' ? '-' : h.type === 'add' ? '+' : ' ';
                return `<div class="diff-line ${cls}"><span class="ln">${h.oldLine ?? ''}</span><span class="ln">${h.newLine ?? ''}</span><span class="sig">${sig}</span><span class="code">${escapeHtml(h.text)}</span></div>`;
            }).join('')
            : `<div class="diff-line diff-skip"><span class="ln"></span><span class="ln"></span><span class="sig"></span><span class="code">No line differences</span></div>`;

        const fullId = `full-${idx}-${escapeHtml(propName).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const srcLines = srcFull ? srcFull.split('\n').length : 0;
        const tgtLines = tgtFull ? tgtFull.split('\n').length : 0;

        return `
            <div class="prop-card">
                <div class="prop-header">
                    <div>
                        <span class="mono prop-name">${escapeHtml(propName)}</span>
                        <span class="badge badge-${escapeHtml(diffType)}">${escapeHtml(diffType)}</span>
                        <span class="meta-dim">Src: ${srcLines} lines · Tgt: ${tgtLines} lines</span>
                    </div>
                    <button type="button" class="btn-toggle-full" onclick="toggleFull('${fullId}', this)">Show Full Values</button>
                </div>
                <div class="diff-box">${hunkRows}</div>
                <div id="${fullId}" class="full-box" style="display:none">
                    <div class="full-grid">
                        <div>
                            <div class="full-label">Source Full Value</div>
                            <pre class="full-pre">${escapeHtml(srcFull || '—')}</pre>
                        </div>
                        <div>
                            <div class="full-label">Target Full Value</div>
                            <pre class="full-pre">${escapeHtml(tgtFull || '—')}</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="prop-card">
            <div class="prop-header">
                <div>
                    <span class="mono prop-name">${escapeHtml(propName)}</span>
                    <span class="badge badge-${escapeHtml(diffType)}">${escapeHtml(diffType)}</span>
                </div>
            </div>
            <div class="kv-grid">
                <div><span class="kv-lbl">Source:</span> <code class="mono val-src">${escapeHtml(srcFull || '—')}</code></div>
                <div><span class="kv-lbl">Target:</span> <code class="mono val-tgt">${escapeHtml(tgtFull || '—')}</code></div>
            </div>
        </div>
    `;
};

export const generateComparisonHtmlReport = (results: DsResult[], meta: HtmlReportMeta): string => {
    const kinds = [...new Set(results.map(r => r.kind || 'Unknown'))].sort();

    const entityCardsHtml = results.map((r, idx) => {
        const kind = r.kind || 'Unknown';
        const displayName = r.displayName || '';
        const diffCount = Array.isArray(r.diff) ? r.diff.length : 0;
        const searchBlob = `${kind} ${r.keyStr} ${displayName} ${r.diffSum || ''}`.toLowerCase();

        const bodyHtml = r.status === 'missing'
            ? `<div class="empty-msg">Entity exists in Source (<code>${escapeHtml(meta.srcProject)}</code>) and is missing in Target (<code>${escapeHtml(meta.tgtProject)}</code>).</div>`
            : r.status === 'identical'
                ? `<div class="empty-msg">All properties are identical between Source and Target.</div>`
                : (r.diff || []).map((d: any) => renderPropertyDiffBlock(r, d, idx)).join('');

        return `
            <div class="entity-card" data-status="${escapeHtml(r.status)}" data-kind="${escapeHtml(kind)}" data-search="${escapeHtml(searchBlob)}">
                <div class="entity-head" onclick="toggleEntity(this)">
                    <div class="entity-left">
                        <span class="chev">▶</span>
                        <span class="kind-pill">${escapeHtml(kind)}</span>
                        <span class="mono entity-key">${escapeHtml(r.keyStr)}</span>
                        ${displayName ? `<span class="entity-name">${escapeHtml(displayName)}</span>` : ''}
                    </div>
                    <div class="entity-right">
                        <span class="diff-summary">${escapeHtml(r.diffSum || '—')}</span>
                        ${diffCount > 0 ? `<span class="count-pill">${diffCount} diff${diffCount === 1 ? '' : 's'}</span>` : ''}
                        <span class="status-pill status-${escapeHtml(r.status)}">${escapeHtml(r.status.toUpperCase())}</span>
                    </div>
                </div>
                <div class="entity-body" style="display:none">${bodyHtml}</div>
            </div>
        `;
    }).join('\n');

    const kindOptions = kinds.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Datastore Comparison Report — ${escapeHtml(meta.srcProject)} vs ${escapeHtml(meta.tgtProject)}</title>
<style>
  :root { --bg:#080c17; --card:#0f1629; --card2:#141d35; --brd:#1e293b; --fg:#e2e8f0; --muted:#94a3b8; --cyan:#22d3ee; --ok:#34d399; --warn:#fbbf24; --err:#fb7185; --info:#60a5fa; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); line-height:1.45; }
  .wrap { max-width:1320px; margin:0 auto; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .header { background:var(--card); border:1px solid var(--brd); border-radius:12px; padding:20px 24px; margin-bottom:16px; }
  .title { font-size:20px; font-weight:700; margin:0 0 8px; }
  .meta { display:flex; flex-wrap:wrap; gap:16px; font-size:12px; color:var(--muted); }
  .meta code { color:var(--cyan); }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:16px; }
  .stat-card { background:var(--card); border:1px solid var(--brd); border-radius:10px; padding:12px 14px; cursor:pointer; transition:border-color .15s; text-align:left; }
  .stat-card:hover, .stat-card.active { border-color:var(--cyan); }
  .stat-lbl { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .stat-val { font-size:22px; font-weight:700; margin-top:2px; }
  .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--brd); border-radius:10px; padding:12px 14px; margin-bottom:16px; }
  .toolbar-group { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  input, select, button { background:var(--card2); color:var(--fg); border:1px solid var(--brd); border-radius:7px; padding:6px 10px; font-size:12px; }
  button { cursor:pointer; }
  button:hover { border-color:var(--cyan); }
  .entity-card { background:var(--card); border:1px solid var(--brd); border-radius:10px; margin-bottom:10px; overflow:hidden; }
  .entity-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; padding:11px 14px; cursor:pointer; }
  .entity-head:hover { background:rgba(255,255,255,0.02); }
  .entity-left { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .entity-right { display:flex; align-items:center; gap:8px; }
  .chev { font-size:10px; color:var(--muted); transition:transform .15s; }
  .entity-card.open .chev { transform:rotate(90deg); }
  .kind-pill { background:rgba(34,211,238,0.12); color:var(--cyan); border:1px solid rgba(34,211,238,0.28); padding:2px 7px; border-radius:5px; font-size:11px; font-weight:600; }
  .entity-key { font-size:12px; font-weight:600; }
  .entity-name { font-size:12px; color:var(--muted); }
  .diff-summary { font-size:11px; color:var(--muted); max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .count-pill { font-size:11px; color:var(--warn); background:rgba(251,191,36,0.12); padding:2px 7px; border-radius:5px; }
  .status-pill { font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; }
  .status-identical { background:rgba(52,211,153,0.12); color:var(--ok); }
  .status-mapped { background:rgba(96,165,250,0.12); color:var(--info); }
  .status-different { background:rgba(251,191,36,0.14); color:var(--warn); }
  .status-missing { background:rgba(251,113,133,0.14); color:var(--err); }
  .entity-body { border-top:1px solid var(--brd); padding:12px 14px; background:#0b1020; }
  .empty-msg { font-size:12px; color:var(--muted); }
  .prop-card { border:1px solid var(--brd); border-radius:8px; margin-bottom:10px; overflow:hidden; background:var(--card); }
  .prop-card:last-child { margin-bottom:0; }
  .prop-header { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--brd); background:rgba(255,255,255,0.02); }
  .prop-name { font-size:12px; font-weight:700; color:var(--cyan); margin-right:8px; }
  .badge { font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(251,191,36,0.15); color:var(--warn); text-transform:uppercase; }
  .badge-mapped { background:rgba(96,165,250,0.15); color:var(--info); }
  .meta-dim { font-size:11px; color:var(--muted); margin-left:8px; }
  .btn-toggle-full { font-size:11px; padding:3px 8px; }
  .diff-box { font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:11px; overflow-x:auto; }
  .diff-line { display:flex; white-space:pre; min-width:max-content; padding:1px 8px; }
  .diff-line .ln { width:44px; flex:none; color:#64748b; text-align:right; padding-right:8px; user-select:none; }
  .diff-line .sig { width:18px; flex:none; font-weight:700; user-select:none; }
  .diff-line .code { flex:1; }
  .diff-del { background:rgba(244,63,94,0.14); color:#fecdd3; }
  .diff-add { background:rgba(16,185,129,0.14); color:#bbf7d0; }
  .diff-skip { background:rgba(148,163,184,0.06); color:#94a3b8; font-style:italic; }
  .full-box { border-top:1px solid var(--brd); padding:10px; background:#070a14; }
  .full-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @media (max-width:900px) { .full-grid { grid-template-columns:1fr; } }
  .full-label { font-size:11px; font-weight:600; color:var(--muted); margin-bottom:4px; }
  .full-pre { margin:0; max-height:360px; overflow:auto; background:var(--card); border:1px solid var(--brd); border-radius:6px; padding:8px; font-size:11px; white-space:pre-wrap; word-break:break-word; }
  .kv-grid { padding:8px 12px; display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:12px; }
  .kv-lbl { color:var(--muted); font-size:11px; }
  .val-src { color:#fecdd3; }
  .val-tgt { color:#bbf7d0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1 class="title">Datastore Comparison Report</h1>
    <div class="meta">
      <span>Source: <code class="mono">${escapeHtml(meta.srcProject)}</code> (${escapeHtml(meta.srcDb || '(default)')})</span>
      <span>Target: <code class="mono">${escapeHtml(meta.tgtProject)}</code> (${escapeHtml(meta.tgtDb || '(default)')})</span>
      <span>Operator: <strong>${escapeHtml(meta.operatorEmail || '—')}</strong></span>
      <span>Generated: ${escapeHtml(meta.generatedAt)}</span>
    </div>
  </div>

  <div class="stats">
    <button type="button" class="stat-card active" onclick="setStatus('all', this)"><div class="stat-lbl">Total</div><div class="stat-val">${meta.stats.total}</div></button>
    <button type="button" class="stat-card" onclick="setStatus('different', this)"><div class="stat-lbl">Different</div><div class="stat-val" style="color:var(--warn)">${meta.stats.different}</div></button>
    <button type="button" class="stat-card" onclick="setStatus('missing', this)"><div class="stat-lbl">Missing</div><div class="stat-val" style="color:var(--err)">${meta.stats.missing}</div></button>
    <button type="button" class="stat-card" onclick="setStatus('mapped', this)"><div class="stat-lbl">Mapped</div><div class="stat-val" style="color:var(--info)">${meta.stats.mapped}</div></button>
    <button type="button" class="stat-card" onclick="setStatus('identical', this)"><div class="stat-lbl">Identical</div><div class="stat-val" style="color:var(--ok)">${meta.stats.identical}</div></button>
  </div>

  <div class="toolbar">
    <div class="toolbar-group">
      <select id="f-kind" onchange="applyFilters()"><option value="all">All Kinds</option>${kindOptions}</select>
      <input id="f-search" type="search" placeholder="Search key, name, property..." oninput="applyFilters()" style="width:240px">
      <span id="visible-count" class="meta-dim"></span>
    </div>
    <div class="toolbar-group">
      <button type="button" onclick="expandAll(true)">Expand All</button>
      <button type="button" onclick="expandAll(false)">Collapse All</button>
    </div>
  </div>

  <div id="entities-list">${entityCardsHtml}</div>
</div>
<script>
  var currentStatus = 'all';
  function toggleEntity(head) {
    var card = head.parentElement;
    var body = card.querySelector('.entity-body');
    var open = card.classList.toggle('open');
    body.style.display = open ? 'block' : 'none';
  }
  function toggleFull(id, btn) {
    var el = document.getElementById(id);
    if (!el) return;
    var show = el.style.display === 'none';
    el.style.display = show ? 'block' : 'none';
    btn.textContent = show ? 'Hide Full Values' : 'Show Full Values';
  }
  function setStatus(status, btn) {
    currentStatus = status;
    document.querySelectorAll('.stat-card').forEach(function(c){ c.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    applyFilters();
  }
  function expandAll(open) {
    document.querySelectorAll('.entity-card').forEach(function(card){
      if (card.style.display === 'none') return;
      card.classList.toggle('open', open);
      card.querySelector('.entity-body').style.display = open ? 'block' : 'none';
    });
  }
  function applyFilters() {
    var kind = document.getElementById('f-kind').value;
    var q = (document.getElementById('f-search').value || '').trim().toLowerCase();
    var shown = 0, total = 0;
    document.querySelectorAll('.entity-card').forEach(function(card){
      total++;
      var okStatus = currentStatus === 'all' || card.dataset.status === currentStatus;
      var okKind = kind === 'all' || card.dataset.kind === kind;
      var okSearch = !q || (card.dataset.search || '').indexOf(q) !== -1;
      var vis = okStatus && okKind && okSearch;
      card.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    document.getElementById('visible-count').textContent = 'Showing ' + shown + ' of ' + total + ' entities';
  }
  applyFilters();
</script>
</body>
</html>`;
};
