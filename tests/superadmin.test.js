const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'superadmin', 'src', 'sql-formatter.ts');
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

const {
    extractVariables,
    resolveSqlVariables,
    formatEmailToDisplayName,
    formatBigQuerySql
} = compiled.exports;

test('extractVariables parses single and multiple variables without duplicates', () => {
    const query = `
        SELECT * FROM \`project.dataset.table\`
        WHERE user_id = '{{user_id}}'
          AND created_at >= '{{ start_date }}'
          AND updated_by = '{{user_id}}'
          AND region = '{{region_code}}'
    `;
    const vars = extractVariables(query);
    assert.deepEqual(vars, ['user_id', 'start_date', 'region_code']);
});

test('extractVariables returns empty array when query has no variables', () => {
    assert.deepEqual(extractVariables('SELECT 1'), []);
    assert.deepEqual(extractVariables(''), []);
});

test('resolveSqlVariables replaces all matching {{variables}} with user input', () => {
    const query = `SELECT * FROM \`prod.users\` WHERE id = '{{user_id}}' AND env = '{{env}}'`;
    const values = {
        user_id: 'usr_12345',
        env: 'production'
    };
    const resolved = resolveSqlVariables(query, values);
    assert.equal(resolved, `SELECT * FROM \`prod.users\` WHERE id = 'usr_12345' AND env = 'production'`);
});

test('resolveSqlVariables replaces missing variables with empty string safely', () => {
    const query = `SELECT * FROM \`prod.orders\` WHERE code = '{{code}}'`;
    const resolved = resolveSqlVariables(query, {});
    assert.equal(resolved, `SELECT * FROM \`prod.orders\` WHERE code = ''`);
});

test('formatEmailToDisplayName parses Gmail and enterprise email addresses to clean Title Case names', () => {
    assert.equal(formatEmailToDisplayName('shreyash.sutane@gmail.com'), 'Shreyash Sutane');
    assert.equal(formatEmailToDisplayName('john_doe@company.org'), 'John Doe');
    assert.equal(formatEmailToDisplayName('alice-smith+test@domain.com'), 'Alice Smith Test');
    assert.equal(formatEmailToDisplayName('admin@gcp.com'), 'Admin');
    assert.equal(formatEmailToDisplayName(''), '');
});

test('formatBigQuerySql capitalizes keywords and indents while preserving {{variables}} and strings', () => {
    const rawSql = `
select id, name, status from \`project.dataset.users\`
where status = 'active' and created_at >= '{{start_date}}'
order by id desc
`;
    const formatted = formatBigQuerySql(rawSql);
    assert.match(formatted, /SELECT id, name, status FROM `project.dataset.users`/);
    assert.match(formatted, /WHERE status = 'active' AND created_at >= '{{start_date}}'/);
    assert.match(formatted, /ORDER BY id DESC/);
    assert.ok(formatted.includes('{{start_date}}'), 'Variables must be preserved verbatim');
});
