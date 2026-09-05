const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('copy modal template has sticky footer, scrollable body, and no orphaned numbering', () => {
    const htmlPath = path.join(__dirname, '../datastore-copier/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verify template exists
    assert.ok(html.includes('id="template-ds-copy-modal"'), 'template-ds-copy-modal should exist');

    // Extract template content
    const templateMatch = html.match(/<template id="template-ds-copy-modal">([\s\S]*?)<\/template>/);
    assert.ok(templateMatch, 'Should find template-ds-copy-modal block');
    const templateContent = templateMatch[1];

    // Verify orphaned "2." is removed
    assert.strictEqual(templateContent.includes('2. Operations that need to be enabled'), false, 'Should not contain orphaned "2. Operations that need to be enabled"');
    assert.ok(templateContent.includes('Operations that need to be enabled (Data Access Logs)'), 'Should contain clean title without stray "2."');

    // Verify collapsible details for audit logging instructions
    assert.ok(templateContent.includes('<details'), 'Should contain collapsible details for audit log instructions');
    assert.ok(templateContent.includes('How to enable Audit Logs in GCP Console'), 'Should include summary toggle');

    // Verify sticky footer with action buttons
    assert.ok(templateContent.includes('modal-copy-footer'), 'Should have dedicated modal-copy-footer');
    assert.ok(templateContent.includes('sticky bottom-0'), 'Footer must have sticky bottom-0 so action buttons are always accessible');
    assert.ok(templateContent.includes('btn-cancel'), 'Should have cancel button');
    assert.ok(templateContent.includes('btn-confirm'), 'Should have confirm button');

    // Verify scrollable body
    assert.ok(templateContent.includes('modal-copy-body') && templateContent.includes('overflow-y-auto'), 'Should have scrollable body container');
});

test('css contains scrollable modal-bg and wide modal styling', () => {
    const cssPath = path.join(__dirname, '../datastore-copier/css/app.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Verify modal-bg overflow-y auto
    assert.ok(css.includes('.modal-bg {') && css.includes('overflow-y: auto'), '.modal-bg must allow vertical scrolling');
    
    // Verify modal-wide width
    assert.ok(css.includes('.modal.modal-wide'), '.modal.modal-wide must exist');
    assert.ok(css.includes('840px'), 'modal-wide should specify comfortable 840px width');
});

test('app.ts invokes openModal with modal-wide and renders Option 2 sub-line for selected entities', () => {
    const appTsPath = path.join(__dirname, '../datastore-copier/src/app.ts');
    const code = fs.readFileSync(appTsPath, 'utf8');

    // Verify modal-wide passed to openModal
    assert.ok(code.includes("UI.openModal(fragment, 'modal-wide')"), 'openDsCopyModal should open with modal-wide');

    // Verify Option 2 sub-line styling in openDsCopyModal
    assert.ok(code.includes('fa-arrow-turn-up fa-rotate-90'), 'Should render arrow-turn-up icon for display name');
    assert.ok(code.includes('color:var(--accent2)'), 'Should use accent2 cyan color for display name');
    assert.ok(code.includes("querySelectorAll('.btn-cancel')"), 'Should bind all cancel button instances including header close button');
});
