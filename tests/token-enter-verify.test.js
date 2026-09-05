const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dsAppPath = path.join(__dirname, '../datastore-copier/src/app.ts');
const dsUiPath = path.join(__dirname, '../datastore-copier/src/ui.ts');
const saAppPath = path.join(__dirname, '../superadmin/src/app.ts');

test('Datastore Copier triggers verify on Enter in inp-token', () => {
    const code = fs.readFileSync(dsAppPath, 'utf8');
    assert.match(code, /verifyInp\.addEventListener\('keydown',\s*\(e:\s*KeyboardEvent\)\s*=>/);
    assert.match(code, /if\s*\(e\.key\s*===\s*'Enter'\)/);
    assert.match(code, /App\.verify\(\)/);
});

test('Datastore Copier token renewal modal triggers verify on Enter', () => {
    const code = fs.readFileSync(dsUiPath, 'utf8');
    assert.match(code, /inp\.addEventListener\('keydown',\s*\(e:\s*KeyboardEvent\)\s*=>/);
    assert.match(code, /submitBtn\.click\(\)/);
});

test('SuperAdmin triggers verify on Enter in inp-token', () => {
    const code = fs.readFileSync(saAppPath, 'utf8');
    assert.match(code, /Utils\.\$\('inp-token'\)\?\.addEventListener\('keydown',\s*\(e:\s*KeyboardEvent\)\s*=>/);
    assert.match(code, /App\.handleVerifyToken\(\)/);
});
