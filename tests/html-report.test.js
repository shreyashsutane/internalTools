const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'html-report.ts');
const build = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
    write: false
});
const compiled = new Module(entry, module);
compiled.filename = entry;
compiled.paths = module.paths;
compiled._compile(build.outputFiles[0].text, entry);
const { computeLineDiffHunks, generateComparisonHtmlReport } = compiled.exports;

test('computeLineDiffHunks handles 4,000-line queries quickly and collapses unchanged lines', () => {
    const baseLines = Array.from({ length: 4000 }, (_, i) => `SELECT col_${i} FROM \`src-proj.ds.tbl\``);
    const tgtLines = [...baseLines];
    tgtLines[2500] = 'SELECT col_2500_updated FROM `tgt-proj.ds.tbl`';

    const t0 = Date.now();
    const hunks = computeLineDiffHunks(baseLines.join('\n'), tgtLines.join('\n'), 3);
    const elapsedMs = Date.now() - t0;

    assert.ok(elapsedMs < 500, `Expected <500ms, took ${elapsedMs}ms`);
    assert.ok(hunks.some(h => h.type === 'skip'), 'Unchanged prefix/suffix should collapse');
    assert.ok(hunks.some(h => h.type === 'del' && h.oldLine === 2501));
    assert.ok(hunks.some(h => h.type === 'add' && h.newLine === 2501));
});

test('generateComparisonHtmlReport produces standalone HTML with full query toggle and XSS escaping', () => {
    const longQuerySrc = Array.from({ length: 100 }, (_, i) => `line_${i}`).join('\n');
    const longQueryTgt = longQuerySrc.replace('line_50', 'line_50_changed');

    const html = generateComparisonHtmlReport(
        [
            {
                kind: 'Questions',
                keyStr: 'Questions:1001',
                rawKey: {},
                status: 'different',
                diffSum: 'query',
                diff: [{ prop: 'query', type: 'modified', src: '...', tgt: '...' }],
                srcEntity: { properties: { query: { stringValue: longQuerySrc } } },
                tgtEntity: { properties: { query: { stringValue: longQueryTgt } } },
                displayName: '<script>alert(1)</script>'
            }
        ],
        {
            srcProject: 'src-proj',
            tgtProject: 'tgt-proj',
            srcDb: '(default)',
            tgtDb: '(default)',
            operatorEmail: 'user@dista.ai',
            generatedAt: '2026-11-26T00:00:00Z',
            stats: { total: 1, identical: 0, mapped: 0, different: 1, missing: 0 }
        }
    );

    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /Show Full Values/);
    assert.match(html, /line_50_changed/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
