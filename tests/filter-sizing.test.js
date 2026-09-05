const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '../datastore-copier/css/app.css');
const htmlPath = path.join(__dirname, '../datastore-copier/index.html');
const uiTsPath = path.join(__dirname, '../datastore-copier/src/ui.ts');

test('CSS rules ensure responsive and content-adaptive sizing without rigid truncation', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // .filter-row should allow wrapping
    assert.match(css, /\.filter-row\s*\{[^}]*flex-wrap:\s*wrap/);

    // .filter-prop-width should have min-width at least 200px to accommodate "__key__ (ID / Name)"
    assert.match(css, /\.filter-prop-width\s*\{[^}]*min-width:\s*210px/);
    assert.match(css, /\.filter-prop-width\s*\{[^}]*field-sizing:\s*content/);

    // .filter-op-width should be compact
    assert.match(css, /\.filter-op-width\s*\{[^}]*min-width:\s*58px/);

    // .filter-type-width should be compact
    assert.match(css, /\.filter-type-width\s*\{[^}]*min-width:\s*78px/);

    // .filter-val-width should support field-sizing: content
    assert.match(css, /\.filter-val-width\s*\{[^}]*field-sizing:\s*content/);

    // Find & Replace adaptive styles
    assert.match(css, /\.ds-rule-grid\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(css, /\.inp-rule-target[^}]*field-sizing:\s*content/);
});

test('HTML template removes hardcoded inline width on filter-kind', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const templateMatch = html.match(/<template id="template-ds-filter-row">([\s\S]*?)<\/template>/);
    assert.ok(templateMatch, 'template-ds-filter-row must exist');
    
    const templateContent = templateMatch[1];
    assert.doesNotMatch(templateContent, /class="[^"]*filter-kind[^"]*"[^>]*style="width:130px"/, 'filter-kind must not have hardcoded width:130px');
});

test('UI implementation in ui.ts applies dynamic auto-sizing to inputs and Find & Replace textareas', () => {
    const uiTs = fs.readFileSync(uiTsPath, 'utf8');

    // Check that adjustValWidth is present in addDsFilter
    assert.match(uiTs, /adjustValWidth/);
    assert.match(uiTs, /valInput\.style\.minWidth/);

    // Check that propSelect has minWidth dynamic expansion
    assert.match(uiTs, /propSelect\.style\.minWidth/);

    // Check that renderDsRules uses ds-rule-grid and updateRuleSizing
    assert.match(uiTs, /ds-rule-grid/);
    assert.match(uiTs, /updateRuleSizing/);
    assert.match(uiTs, /colFind\.style\.flex\s*=\s*'1 1 100%'/);
});
