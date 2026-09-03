export const extractVariables = (sql: string): string[] => {
    if (!sql || typeof sql !== 'string') return [];
    const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
        if (match[1]) matches.add(match[1].trim());
    }
    return Array.from(matches);
};

export const resolveSqlVariables = (sql: string, values: Record<string, string>): string => {
    if (!sql || typeof sql !== 'string') return '';
    return sql.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, varName) => {
        const val = values[varName.trim()];
        return val !== undefined ? val : '';
    });
};

export const formatEmailToDisplayName = (email: string): string => {
    if (!email || typeof email !== 'string') return '';
    const localPart = email.split('@')[0] || '';
    if (!localPart) return email;
    
    // Replace dots, underscores, hyphens, pluses with spaces
    const words = localPart.replace(/[._\-+]/g, ' ').trim().split(/\s+/);
    return words
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
};

export interface BigQuerySqlSafety {
    requiresDestructiveConfirmation: boolean;
    keyword: string | null;
}

const MUTATING_BIGQUERY_KEYWORDS = new Set([
    'ALTER', 'CALL', 'CREATE', 'DELETE', 'DROP', 'EXECUTE', 'EXPORT',
    'GRANT', 'INSERT', 'LOAD', 'MERGE', 'RENAME', 'REVOKE', 'TRUNCATE', 'UPDATE'
]);

const sqlCodeOnly = (sql: string): string => {
    let output = '';
    let index = 0;
    let mode: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'backtick' = 'code';

    while (index < sql.length) {
        const char = sql[index];
        const next = sql[index + 1];
        if (mode === 'code') {
            if (char === '-' && next === '-') {
                mode = 'line-comment'; output += '  '; index += 2; continue;
            }
            if (char === '/' && next === '*') {
                mode = 'block-comment'; output += '  '; index += 2; continue;
            }
            if (char === "'") mode = 'single';
            else if (char === '"') mode = 'double';
            else if (char === '`') mode = 'backtick';
            output += mode === 'code' ? char : ' ';
            index++;
            continue;
        }
        if (mode === 'line-comment') {
            if (char === '\n') { mode = 'code'; output += '\n'; } else output += ' ';
            index++;
            continue;
        }
        if (mode === 'block-comment') {
            if (char === '*' && next === '/') {
                mode = 'code'; output += '  '; index += 2;
            } else {
                output += char === '\n' ? '\n' : ' '; index++;
            }
            continue;
        }
        const quote = mode === 'single' ? "'" : (mode === 'double' ? '"' : '`');
        if (char === quote) {
            if (next === quote) {
                output += '  '; index += 2; continue;
            }
            mode = 'code';
        }
        output += char === '\n' ? '\n' : ' ';
        index++;
    }
    return output;
};

export const classifyBigQuerySql = (sql: string): BigQuerySqlSafety => {
    const tokens = sqlCodeOnly(sql).toUpperCase().match(/[A-Z_]+/g) || [];
    const keyword = tokens.find(token => MUTATING_BIGQUERY_KEYWORDS.has(token)) || null;
    return {
        requiresDestructiveConfirmation: keyword !== null,
        keyword
    };
};

const SQL_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'ON', 'AS',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS',
    'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
    'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'OVER',
    'PARTITION', 'WINDOW', 'QUALIFY', 'EXCEPT', 'INTERSECT', 'CREATE',
    'OR', 'REPLACE', 'TABLE', 'VIEW', 'FUNCTION', 'DECLARE', 'SET',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'DELETE', 'UNNEST', 'STRUCT',
    'ARRAY', 'INTERVAL', 'TRUE', 'FALSE', 'NULL', 'IS', 'LIKE', 'BETWEEN',
    'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'CAST', 'SAFE_CAST', 'COALESCE',
    'IFNULL', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'ARRAY_AGG'
]);

export const formatBigQuerySql = (sql: string): string => {
    if (!sql || typeof sql !== 'string') return '';
    
    const lines = sql.split(/\r?\n/);
    const formattedLines: string[] = [];
    let indentLevel = 0;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            formattedLines.push('');
            continue;
        }

        // Adjust indent level based on parenthesis
        const openParen = (trimmed.match(/\(/g) || []).length;
        const closeParen = (trimmed.match(/\)/g) || []).length;

        if (trimmed.startsWith(')')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        const indent = '  '.repeat(indentLevel);
        
        // Tokenize and format keywords while preserving strings and {{variables}}
        const tokens = trimmed.split(/(\{\{[^}]+\}\}|`[^`]+`|'[^']*'|"[^"]*"|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[(),;])/g);
        const formattedTokenLine = tokens.map(tok => {
            if (!tok) return '';
            if (tok.startsWith('{{') || tok.startsWith('`') || tok.startsWith("'") || tok.startsWith('"')) {
                return tok;
            }
            const upper = tok.toUpperCase();
            if (SQL_KEYWORDS.has(upper)) {
                return upper;
            }
            return tok;
        }).join('');

        formattedLines.push(indent + formattedTokenLine);

        if (openParen > closeParen) {
            indentLevel += (openParen - closeParen);
        } else if (closeParen > openParen && !trimmed.startsWith(')')) {
            indentLevel = Math.max(0, indentLevel - (closeParen - openParen));
        }
    }

    return formattedLines.join('\n').trim();
};
