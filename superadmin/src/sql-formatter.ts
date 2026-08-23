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
