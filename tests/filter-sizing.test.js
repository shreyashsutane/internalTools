const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '../datastore-copier/css/app.css');
const htmlPath = path.join(__dirname, '../datastore-copier/index.html');
const uiTsPath = path.join(__dirname, '../datastore-copier/src/ui.ts');

test('CSS rules ensure responsive and content-adaptive sizing without rigid truncation', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // .filter-row should allow wrapping and top alignment for multiline values
    assert.match(css, /\.filter-row\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(css, /\.filter-row\s*\{[^}]*align-items:\s*flex-start/);

    // .filter-prop-width should have min-width at least 200px to accommodate "__key__ (ID / Name)"
    assert.match(css, /\.filter-prop-width\s*\{[^}]*min-width:\s*210px/);
    assert.match(css, /\.filter-prop-width\s*\{[^}]*field-sizing:\s*content/);

    // .filter-op-width should be compact
    assert.match(css, /\.filter-op-width\s*\{[^}]*min-width:\s*58px/);

    // .filter-type-width should be compact
    assert.match(css, /\.filter-type-width\s*\{[^}]*min-width:\s*78px/);

    // .filter-val-width should support field-sizing: content and auto-height multiline styling
    assert.match(css, /\.filter-val-width\s*\{[^}]*field-sizing:\s*content/);
    assert.match(css, /\.filter-val-width\s*\{[^}]*min-height:\s*32px/);
    assert.match(css, /\.filter-val-width\s*\{[^}]*resize:\s*none/);

    // .filter-kind-width should not have rigid 200px cap, max-width is 100%
    assert.match(css, /\.filter-kind-width\s*\{[^}]*max-width:\s*100%/);
    assert.doesNotMatch(css, /\.filter-kind-width\s*\{[^}]*max-width:\s*200px/);

    // Find & Replace adaptive styles
    assert.match(css, /\.ds-rule-grid\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(css, /\.inp-rule-target[^}]*field-sizing:\s*content/);
});

test('HTML template uses textarea for filter-val and sections have expanded widths', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const templateMatch = html.match(/<template id="template-ds-filter-row">([\s\S]*?)<\/template>/);
    assert.ok(templateMatch, 'template-ds-filter-row must exist');
    
    const templateContent = templateMatch[1];
    assert.doesNotMatch(templateContent, /class="[^"]*filter-kind[^"]*"[^>]*style="width:130px"/, 'filter-kind must not have hardcoded width:130px');
    assert.match(templateContent, /<textarea[^>]*class="[^"]*filter-val[^"]*"/, 'filter-val in template must be a textarea for vertical growth');

    // Section width should be expanded to max-w-7xl
    assert.match(html, /id="sec-forms"[^>]*class="[^"]*max-w-7xl/);
    assert.match(html, /id="sec-modes"[\s\S]*?class="card max-w-7xl/);
});

test('UI implementation in ui.ts applies dynamic auto-sizing to inputs and Find & Replace textareas', () => {
    const uiTs = fs.readFileSync(uiTsPath, 'utf8');

    // Check that adjustValSizing adjusts height based on scrollHeight
    assert.match(uiTs, /adjustValSizing/);
    assert.match(uiTs, /valInput\.style\.height\s*=\s*Math\.max\(32,\s*Math\.min\(valInput\.scrollHeight/);

    // Check that propSelect and kindSelect have dynamic width expansion without hardcoded caps
    assert.match(uiTs, /propSelect\.style\.minWidth/);
    assert.match(uiTs, /adjustKindSelectWidth/);
    assert.match(uiTs, /kindSelect\.style\.minWidth\s*=\s*Math\.max\(txt\.length \+ 5,\s*14\)\s*\+\s*'ch'/);

    // Check that renderDsRules uses ds-rule-grid and updateRuleSizing
    assert.match(uiTs, /ds-rule-grid/);
    assert.match(uiTs, /updateRuleSizing/);
    assert.match(uiTs, /colFind\.style\.flex\s*=\s*'1 1 100%'/);
});
