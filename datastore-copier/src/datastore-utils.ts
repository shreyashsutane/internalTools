export type DatastoreEditorType =
    | 'String'
    | 'Integer'
    | 'Double'
    | 'Boolean'
    | 'Null'
    | 'Timestamp'
    | 'Blob'
    | 'Key'
    | 'GeoPoint'
    | 'Array'
    | 'Map'
    | 'Entity';

export const cloneDatastoreValue = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const isJsonString = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
        return false;
    }
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return false;
    }
};

export const compressJsonToBase64 = async (data: any): Promise<string> => {
    const jsonStr = JSON.stringify(data);
    const bytes = new TextEncoder().encode(jsonStr);

    if (typeof CompressionStream !== 'undefined') {
        const stream = new Response(
            new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
        );
        const compressedBuffer = await stream.arrayBuffer();
        const compressedBytes = new Uint8Array(compressedBuffer);
        let binary = '';
        const len = compressedBytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(compressedBytes[i]);
        }
        return btoa(binary);
    }
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

export const decompressJsonFromBase64 = async (base64Str: string): Promise<any> => {
    const binary = atob(base64Str);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Response(
                new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
            );
            const text = await stream.text();
            return JSON.parse(text);
        } catch {
            const text = new TextDecoder().decode(bytes);
            return JSON.parse(text);
        }
    }
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
};

export const mapConcurrent = async <T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    const worker = async () => {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            results[index] = await fn(items[index], index);
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
};

export const deepEqual = (a: any, b: any): boolean => {
    if (Object.is(a, b)) return true;
    if (a === b) return true;

    // Fast-path for Datastore property wrappers with identical primitive values
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
        if ('stringValue' in a && 'stringValue' in b && a.stringValue === b.stringValue) return true;
        if ('integerValue' in a && 'integerValue' in b && a.integerValue === b.integerValue) return true;
        if ('booleanValue' in a && 'booleanValue' in b && a.booleanValue === b.booleanValue) return true;
        if ('timestampValue' in a && 'timestampValue' in b && a.timestampValue === b.timestampValue) return true;
        if ('doubleValue' in a && 'doubleValue' in b && a.doubleValue === b.doubleValue) return true;
        if ('nullValue' in a && 'nullValue' in b) return true;
    }

    // 1. Primitive string comparisons (semantic JSON, ISO timestamps, CRLF whitespace)
    if (typeof a === 'string' && typeof b === 'string') {
        if (a === b) return true;
        if (a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim()) return true;

        if (isJsonString(a) && isJsonString(b)) {
            try {
                return deepEqual(JSON.parse(a.trim()), JSON.parse(b.trim()));
            } catch {
                return false;
            }
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(a.trim()) &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(b.trim())) {
            const tA = Date.parse(a.trim());
            const tB = Date.parse(b.trim());
            if (!isNaN(tA) && !isNaN(tB)) return tA === tB;
        }
        return false;
    }

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((value, index) => deepEqual(value, b[index]));
    }

    // 2. Datastore REST Property Wrapper Normalization
    // Boolean wrapper
    if ('booleanValue' in a && 'booleanValue' in b) {
        return a.booleanValue === b.booleanValue;
    }

    // Null wrapper
    if ('nullValue' in a && 'nullValue' in b) {
        return true;
    }

    // Blob wrapper
    if ('blobValue' in a && 'blobValue' in b) {
        return String(a.blobValue).replace(/=+$/, '') === String(b.blobValue).replace(/=+$/, '');
    }

    // Array value normalization: { arrayValue: {} } vs { arrayValue: { values: [] } }
    if ('arrayValue' in a && 'arrayValue' in b) {
        const arrA = a.arrayValue?.values || [];
        const arrB = b.arrayValue?.values || [];
        return deepEqual(arrA, arrB);
    }

    // Map/Entity value normalization
    if (('mapValue' in a || 'entityValue' in a) && ('mapValue' in b || 'entityValue' in b)) {
        const propsA = a.mapValue?.properties || a.entityValue?.properties || {};
        const propsB = b.mapValue?.properties || b.entityValue?.properties || {};
        return deepEqual(propsA, propsB);
    }

    // Key value normalization (compare key path and ignore project partition if cross-project)
    if ('keyValue' in a && 'keyValue' in b) {
        const pathA = a.keyValue?.path || [];
        const pathB = b.keyValue?.path || [];
        return deepEqual(pathA, pathB);
    }

    // GeoPoint wrapper
    if ('geoPointValue' in a && 'geoPointValue' in b) {
        return deepEqual(a.geoPointValue, b.geoPointValue);
    }

    // String value wrapper containing JSON or string
    if ('stringValue' in a && 'stringValue' in b) {
        return deepEqual(a.stringValue, b.stringValue);
    }

    // Timestamp wrapper normalization
    if ('timestampValue' in a && 'timestampValue' in b) {
        const tA = Date.parse(a.timestampValue);
        const tB = Date.parse(b.timestampValue);
        if (!isNaN(tA) && !isNaN(tB)) return tA === tB;
        return a.timestampValue === b.timestampValue;
    }

    // Integer wrapper normalization
    if ('integerValue' in a && 'integerValue' in b) {
        return String(a.integerValue).trim() === String(b.integerValue).trim();
    }

    // Double wrapper normalization
    if ('doubleValue' in a && 'doubleValue' in b) {
        return Object.is(a.doubleValue, b.doubleValue) || Math.abs(a.doubleValue - b.doubleValue) < 1e-12;
    }

    // 3. Object property comparison ignoring metadata (excludeFromIndexes, meaning)
    const getSignificantKeys = (obj: any): string[] => {
        return Object.keys(obj).filter(k => {
            if (obj[k] === undefined) return false;
            if (k === 'excludeFromIndexes' || k === 'meaning') return false;
            return true;
        });
    };

    const keysA = getSignificantKeys(a);
    const keysB = getSignificantKeys(b);

    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
};

const minifyDatastoreValue = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.stringValue === 'string' && isJsonString(value.stringValue)) {
        value.stringValue = JSON.stringify(JSON.parse(value.stringValue));
    }
    if (Array.isArray(value.arrayValue?.values)) {
        value.arrayValue.values.forEach((nested: any) => minifyDatastoreValue(nested));
    }
    if (value.mapValue?.properties) minifyJsonProperties(value.mapValue.properties);
    if (value.entityValue?.properties) minifyJsonProperties(value.entityValue.properties);
};

export const minifyJsonProperties = (properties: Record<string, any> | null | undefined): void => {
    if (!properties || typeof properties !== 'object') return;
    Object.values(properties).forEach(value => minifyDatastoreValue(value));
};

export const datastoreToCleanJson = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if ('nullValue' in value) return null;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('stringValue' in value) return value.stringValue;
    if ('timestampValue' in value) return value.timestampValue;
    if ('blobValue' in value) return value.blobValue;
    if ('keyValue' in value) return value.keyValue;
    if ('geoPointValue' in value) return value.geoPointValue;
    if ('arrayValue' in value) {
        return (value.arrayValue.values || []).map((nested: any) => datastoreToCleanJson(nested));
    }
    const container = value.mapValue || value.entityValue;
    if (container) {
        const result: Record<string, any> = {};
        for (const [key, nested] of Object.entries(container.properties || {})) {
            result[key] = datastoreToCleanJson(nested);
        }
        return result;
    }
    return value;
};

export const cleanJsonToDatastore = (value: any): any => {
    if (value === null) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite.');
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(nested => cleanJsonToDatastore(nested)) } };
    }
    if (typeof value === 'object') {
        const properties: Record<string, any> = {};
        for (const [key, nested] of Object.entries(value)) {
            properties[key] = cleanJsonToDatastore(nested);
        }
        return { mapValue: { properties } };
    }
    throw new Error(`Unsupported JSON value type: ${typeof value}`);
};

export const getDatastoreEditorType = (value: any): DatastoreEditorType => {
    if (!value || typeof value !== 'object') return 'String';
    if ('integerValue' in value) return 'Integer';
    if ('doubleValue' in value) return 'Double';
    if ('booleanValue' in value) return 'Boolean';
    if ('nullValue' in value) return 'Null';
    if ('timestampValue' in value) return 'Timestamp';
    if ('blobValue' in value) return 'Blob';
    if ('keyValue' in value) return 'Key';
    if ('geoPointValue' in value) return 'GeoPoint';
    if ('arrayValue' in value) return 'Array';
    if ('mapValue' in value) return 'Map';
    if ('entityValue' in value) return 'Entity';
    return 'String';
};

export const datastoreValueToEditorText = (value: any): string => {
    if (!value || typeof value !== 'object') return '';
    const type = getDatastoreEditorType(value);
    if (type === 'Null') return 'null';
    if (type === 'Array') return JSON.stringify(value.arrayValue);
    if (type === 'Map') return JSON.stringify(value.mapValue);
    if (type === 'Entity') return JSON.stringify(value.entityValue);
    if (type === 'Key') return JSON.stringify(value.keyValue);
    if (type === 'GeoPoint') return JSON.stringify(value.geoPointValue);
    const fieldByType: Record<string, string> = {
        String: 'stringValue',
        Integer: 'integerValue',
        Double: 'doubleValue',
        Boolean: 'booleanValue',
        Timestamp: 'timestampValue',
        Blob: 'blobValue'
    };
    const raw = value[fieldByType[type]];
    return raw === undefined || raw === null ? '' : String(raw);
};

export const editorTextToDatastoreValue = (
    type: DatastoreEditorType,
    text: string,
    original?: any
): any => {
    switch (type) {
        case 'String': {
            const stringValue = isJsonString(text) ? JSON.stringify(JSON.parse(text)) : text;
            return { stringValue };
        }
        case 'Integer':
            if (!/^-?\d+$/.test(text.trim())) throw new Error(`"${text}" is not a valid integer.`);
            return { integerValue: text.trim().replace(/^\+/, '') };
        case 'Double': {
            const doubleValue = Number(text.trim());
            if (!Number.isFinite(doubleValue)) throw new Error(`"${text}" is not a valid finite double.`);
            return { doubleValue };
        }
        case 'Boolean':
            if (text !== 'true' && text !== 'false') throw new Error('Boolean values must be true or false.');
            return { booleanValue: text === 'true' };
        case 'Null':
            return { nullValue: null };
        case 'Timestamp':
            if (!text.trim()) throw new Error('Timestamp cannot be empty.');
            return { timestampValue: text.trim() };
        case 'Blob':
            return { blobValue: text };
        case 'Key': {
            const keyValue = JSON.parse(text);
            if (!keyValue || !Array.isArray(keyValue.path)) throw new Error('Key JSON must contain a path array.');
            return { keyValue };
        }
        case 'GeoPoint': {
            const geoPointValue = JSON.parse(text);
            if (typeof geoPointValue?.latitude !== 'number' || typeof geoPointValue?.longitude !== 'number') {
                throw new Error('GeoPoint JSON must contain numeric latitude and longitude.');
            }
            return { geoPointValue };
        }
        case 'Array': {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
                (parsed.values !== undefined && !Array.isArray(parsed.values))) {
                throw new Error('Array values must use native Datastore JSON such as {"values":[{"stringValue":"x"}]}.');
            }
            return { arrayValue: parsed };
        }
        case 'Map': {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Map values must use native Datastore JSON with a properties object.');
            }
            if (parsed.properties !== undefined &&
                (!parsed.properties || typeof parsed.properties !== 'object' || Array.isArray(parsed.properties))) {
                throw new Error('Map properties must be a JSON object.');
            }
            return { mapValue: parsed };
        }
        case 'Entity': {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Entity values must use native Datastore JSON.');
            }
            if (parsed.properties !== undefined &&
                (!parsed.properties || typeof parsed.properties !== 'object' || Array.isArray(parsed.properties))) {
                throw new Error('Entity properties must be a JSON object.');
            }
            return { entityValue: { ...(original?.entityValue || {}), ...parsed } };
        }
    }
};

export const replaceDatastoreStringValues = (value: any, target: string, replacement: string): number => {
    if (!value || typeof value !== 'object' || target === '') return 0;
    let replacements = 0;
    if (typeof value.stringValue === 'string') {
        const parts = value.stringValue.split(target);
        replacements += Math.max(0, parts.length - 1);
        value.stringValue = parts.join(replacement);
    }
    // Support 64-bit integer / long values in GCP Datastore REST
    if (typeof value.integerValue === 'string') {
        const trimmedTarget = target.trim();
        const trimmedReplacement = replacement.trim();
        if (value.integerValue === trimmedTarget && /^-?\d+$/.test(trimmedReplacement)) {
            value.integerValue = trimmedReplacement;
            replacements++;
        } else if (value.integerValue.includes(target)) {
            const parts = value.integerValue.split(target);
            const candidate = parts.join(replacement);
            if (/^-?\d+$/.test(candidate)) {
                replacements += Math.max(0, parts.length - 1);
                value.integerValue = candidate;
            }
        }
    }
    if (Array.isArray(value.arrayValue?.values)) {
        value.arrayValue.values.forEach((nested: any) => {
            replacements += replaceDatastoreStringValues(nested, target, replacement);
        });
    }
    for (const properties of [value.mapValue?.properties, value.entityValue?.properties]) {
        if (!properties) continue;
        Object.values(properties).forEach(nested => {
            replacements += replaceDatastoreStringValues(nested, target, replacement);
        });
    }
    return replacements;
};

const replaceAtPath = (
    properties: Record<string, any>,
    segments: string[],
    target: string,
    replacement: string
): number => {
    if (segments.length === 0) return 0;

    const exactPath = segments.join('.');
    if (Object.prototype.hasOwnProperty.call(properties, exactPath)) {
        return replaceDatastoreStringValues(properties[exactPath], target, replacement);
    }

    const [head, ...rest] = segments;
    const value = properties[head];
    if (!value) return 0;
    if (rest.length === 0) return replaceDatastoreStringValues(value, target, replacement);

    let replacements = 0;
    for (const nestedProperties of [value.mapValue?.properties, value.entityValue?.properties]) {
        if (nestedProperties) replacements += replaceAtPath(nestedProperties, rest, target, replacement);
    }
    if (Array.isArray(value.arrayValue?.values)) {
        value.arrayValue.values.forEach((nested: any) => {
            for (const nestedProperties of [nested.mapValue?.properties, nested.entityValue?.properties]) {
                if (nestedProperties) replacements += replaceAtPath(nestedProperties, rest, target, replacement);
            }
        });
    }
    return replacements;
};

export const replaceDatastoreField = (
    properties: Record<string, any>,
    fieldPath: string,
    target: string,
    replacement: string
): number => {
    if (!properties || !target) return 0;
    const targetObj = (properties.properties && typeof properties.properties === 'object')
        ? properties.properties
        : properties;

    const normalized = fieldPath.trim();
    if (!normalized || normalized === '*') {
        return Object.values(targetObj).reduce(
            (count: number, value: any): number => count + replaceDatastoreStringValues(value, target, replacement),
            0
        );
    }
    const segments = normalized.split('.').map(segment => segment.trim()).filter(Boolean);
    return replaceAtPath(targetObj, segments, target, replacement);
};

export interface FindReplaceRuleInput {
    field?: string;
    target?: string;
    replacement?: string;
}

export const replaceDatastoreRules = (
    properties: Record<string, any>,
    rules: FindReplaceRuleInput[]
): number => {
    if (!properties || !Array.isArray(rules) || rules.length === 0) return 0;
    let total = 0;
    for (const rule of rules) {
        if (!rule || !rule.target) continue;
        const field = rule.field || '*';
        const replacement = rule.replacement !== undefined ? rule.replacement : '';
        total += replaceDatastoreField(properties, field, rule.target, replacement);
    }
    return total;
};

export const isQueryKey = (key: string): boolean => {
    if (!key || typeof key !== 'string') return false;
    return /^(?:query|sql|querystring|sqlquery|customquery|customsql)$/i.test(key) || /query|sql/i.test(key);
};

export const normalizeSqlQuery = (
    sql: string,
    srcProject?: string | null,
    tgtProject?: string | null
): string => {
    if (!sql || typeof sql !== 'string') return '';

    let q = sql;

    // 1. Remove single-line comments (-- and //) and multi-line comments (/* ... */)
    q = q.replace(/--.*$/gm, '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // 2. Perform Source -> Target Project ID substitution
    if (srcProject && tgtProject && srcProject !== tgtProject) {
        q = q.split(srcProject).join(tgtProject);
    }

    // 3. Remove trailing semicolons and trailing whitespace
    q = q.trim().replace(/;+\s*$/, '');

    // 4. Normalize spaces around commas, parentheses, and comparison/arithmetic operators
    q = q.replace(/\s*([,()=><])\s*/g, '$1');

    // 5. Collapse all remaining whitespace (spaces, tabs, newlines) into a single space
    q = q.replace(/\s+/g, ' ').trim();

    return q;
};

export const minifySqlQuery = (sql: string): string => {
    if (!sql || typeof sql !== 'string') return '';
    const tokenRegex = /('(?:''|\\'|[^'])*'|"(?:""|\\"|[^"])*"|`[^`]*`|\{\{[^}]+\}\}|--.*$|\/\*[\s\S]*?\*\/|\d+(?:\.\d+)?|[A-Za-z_]\w*|\s+|[^\s\w'"`])/gm;
    const rawTokens = sql.match(tokenRegex) || [sql];
    let result = '';
    for (let i = 0; i < rawTokens.length; i++) {
        const tok = rawTokens[i];
        if (tok.startsWith('--') || tok.startsWith('/*')) continue;
        if (/^\s+$/.test(tok)) {
            if (result.length > 0 && !result.endsWith(' ')) result += ' ';
            continue;
        }
        result += tok;
    }
    return result.trim();
};


export const formatSqlQuery = (sql: string): string => {
    if (!sql || typeof sql !== 'string') return '';

    const rootKeywords = [
        'WITH',
        'SELECT',
        'FROM',
        'WHERE',
        'GROUP BY',
        'HAVING',
        'ORDER BY',
        'LIMIT',
        'OFFSET',
        'UNION ALL',
        'UNION',
        'LEFT JOIN',
        'RIGHT JOIN',
        'INNER JOIN',
        'FULL JOIN',
        'CROSS JOIN',
        'JOIN',
        'ON',
        'AND',
        'OR',
        'INSERT INTO',
        'VALUES',
        'UPDATE',
        'SET',
        'DELETE FROM'
    ];

    const tokenRegex = /('(?:''|\\'|[^'])*'|"(?:""|\\"|[^"])*"|`[^`]*`|\{\{[^}]+\}\}|--.*$|\/\*[\s\S]*?\*\/|\d+(?:\.\d+)?|[A-Za-z_]\w*|\s+|[^\s\w'"`])/gm;

    const keywordLookup = new Map<string, string>();
    rootKeywords.forEach(kw => keywordLookup.set(kw.toUpperCase(), kw.toUpperCase()));

    const rawTokens = sql.match(tokenRegex) || [sql];
    const cleanedTokens: string[] = [];

    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        if (/^\s+$/.test(t)) {
            if (cleanedTokens.length > 0 && cleanedTokens[cleanedTokens.length - 1] !== ' ') {
                cleanedTokens.push(' ');
            }
        } else {
            cleanedTokens.push(t);
        }
    }

    let formatted = '';
    let indentLevel = 0;
    const indent = () => '  '.repeat(Math.max(0, indentLevel));

    for (let i = 0; i < cleanedTokens.length; i++) {
        const tok = cleanedTokens[i];
        if (tok === ' ') {
            if (formatted.endsWith('\n') || formatted.endsWith('  ')) continue;
            formatted += ' ';
            continue;
        }

        const upperTok = tok.toUpperCase();
        const nextTok = (i + 2 < cleanedTokens.length && cleanedTokens[i + 1] === ' ') ? cleanedTokens[i + 2].toUpperCase() : '';
        const twoWord = `${upperTok} ${nextTok}`;

        if (keywordLookup.has(twoWord)) {
            if (!formatted.endsWith('\n') && formatted.trim().length > 0) formatted = formatted.trimEnd() + '\n';
            formatted += indent() + twoWord;
            i += 2;
            continue;
        }

        if (keywordLookup.has(upperTok)) {
            if (upperTok === 'AND' || upperTok === 'OR') {
                if (!formatted.endsWith('\n') && formatted.trim().length > 0) formatted = formatted.trimEnd() + '\n';
                formatted += indent() + '  ' + upperTok;
            } else {
                if (!formatted.endsWith('\n') && formatted.trim().length > 0) formatted = formatted.trimEnd() + '\n';
                formatted += indent() + upperTok;
            }
            continue;
        }

        if (tok === '(') {
            formatted += '(';
            indentLevel++;
            continue;
        }
        if (tok === ')') {
            indentLevel = Math.max(0, indentLevel - 1);
            formatted += ')';
            continue;
        }
        if (tok === ',') {
            formatted = formatted.trimEnd() + ', ';
            continue;
        }
        if (tok === ';') {
            formatted = formatted.trimEnd() + ';';
            continue;
        }

        formatted += tok;
    }

    return formatted.trim();
};

export type QueryEqualityResult = {
    match: boolean;
    type: 'identical' | 'project_mapped' | 'modified';
};

export const isQuerySemanticallyEqual = (
    srcQuery: string,
    tgtQuery: string,
    srcProject?: string | null,
    tgtProject?: string | null
): QueryEqualityResult => {
    if (typeof srcQuery !== 'string' || typeof tgtQuery !== 'string') {
        return { match: false, type: 'modified' };
    }

    if (srcQuery === tgtQuery) {
        return { match: true, type: 'identical' };
    }

    const normSrc = normalizeSqlQuery(srcQuery, srcProject, tgtProject);
    const normTgt = normalizeSqlQuery(tgtQuery, null, null);

    if (normSrc && normSrc === normTgt) {
        return { match: true, type: 'project_mapped' };
    }

    return { match: false, type: 'modified' };
};

export type EntityDisplayNameInfo = {
    fieldName: string;
    value: string;
};

export const extractEntityDisplayName = (entity: any): EntityDisplayNameInfo | null => {
    if (!entity || !entity.properties || typeof entity.properties !== 'object') {
        return null;
    }
    const props = entity.properties;

    const priorityFields = [
        'referenceName',
        'chainName',
        'name',
        'displayName',
        'title',
        'jobName',
        'taskName',
        'username',
        'email',
        'label',
        'code',
        'slug',
        'description'
    ];

    // 1. Exact Priority Match (Case-Insensitive)
    for (const field of priorityFields) {
        const key = Object.keys(props).find(k => k.toLowerCase() === field.toLowerCase());
        if (key && props[key]) {
            const rawVal = props[key].stringValue !== undefined ? props[key].stringValue
                : props[key].integerValue !== undefined ? props[key].integerValue
                : props[key].booleanValue !== undefined ? props[key].booleanValue
                : props[key].timestampValue !== undefined ? props[key].timestampValue
                : null;
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
                return { fieldName: key, value: String(rawVal) };
            }
        }
    }

    // 2. Any property ending in 'name' or 'title' or 'id'
    for (const key of Object.keys(props)) {
        const lower = key.toLowerCase();
        if ((lower.endsWith('name') || lower.endsWith('title') || lower.endsWith('label')) && props[key]) {
            const rawVal = props[key].stringValue !== undefined ? props[key].stringValue
                : props[key].integerValue !== undefined ? props[key].integerValue
                : props[key].booleanValue !== undefined ? props[key].booleanValue
                : null;
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
                return { fieldName: key, value: String(rawVal) };
            }
        }
    }

    return null;
};

export interface DatastoreKeyFilterResult {
    keyValue: {
        partitionId: {
            projectId: string;
            databaseId?: string;
        };
        path: Array<{ kind: string; id?: string; name?: string }>;
    };
}

export const parseTypedFilterVal = (v: string, type: string): any => {
    const trimmed = (v || '').trim();
    switch (type) {
        case 'string':
            return { stringValue: v };
        case 'integer':
            if (trimmed === '' || isNaN(Number(trimmed))) {
                throw new Error(`Invalid Integer value: "${v}"`);
            }
            return { integerValue: String(BigInt(parseInt(trimmed, 10))) };
        case 'double':
            if (trimmed === '' || isNaN(Number(trimmed))) {
                throw new Error(`Invalid Double value: "${v}"`);
            }
            return { doubleValue: parseFloat(trimmed) };
        case 'boolean':
            return { booleanValue: trimmed.toLowerCase() === 'true' };
        case 'timestamp': {
            if (!trimmed) throw new Error("Timestamp value cannot be empty");
            const date = new Date(trimmed);
            if (isNaN(date.getTime())) throw new Error(`Invalid ISO timestamp: "${v}"`);
            return { timestampValue: date.toISOString() };
        }
        case 'null':
            return { nullValue: null };
        case 'auto':
        default:
            if (trimmed === 'true') return { booleanValue: true };
            if (trimmed === 'false') return { booleanValue: false };
            if (!isNaN(Number(trimmed)) && trimmed !== '') {
                if (trimmed.includes('.')) return { doubleValue: parseFloat(trimmed) };
                return { integerValue: String(BigInt(parseInt(trimmed, 10))) };
            }
            return { stringValue: v };
    }
};

export const parseDatastoreKeyFilter = (
    valStr: string,
    defaultKind?: string,
    projectId: string = '',
    databaseId?: string
): DatastoreKeyFilterResult => {
    const trimmed = (valStr || '').trim();
    if (!trimmed) throw new Error("Key value cannot be empty.");

    // Support path separators: ' | ' or '/'
    let elements: string[] = [];
    if (trimmed.includes(' | ')) {
        elements = trimmed.split(' | ').map(x => x.trim()).filter(x => x !== '');
    } else if (trimmed.includes('/')) {
        elements = trimmed.split('/').map(x => x.trim()).filter(x => x !== '');
    } else {
        elements = [trimmed];
    }

    const path = elements.map(part => {
        let kind = defaultKind || '';
        let val = part;

        let sepIndex = part.indexOf(':');
        if (sepIndex === -1 && part.includes('/')) sepIndex = part.indexOf('/');

        if (sepIndex !== -1) {
            kind = part.substring(0, sepIndex).trim();
            val = part.substring(sepIndex + 1).trim();
        }

        if (!kind) {
            throw new Error(`Key filter "${part}" requires a Kind (e.g. "Kind:ID" or select a Kind in the filter dropdown).`);
        }

        // Check if val is wrapped in quotes: e.g. "user_008" -> strip quotes and treat as name
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            return { kind, name: val.slice(1, -1) };
        }

        // If string contains only digits and is non-empty -> numeric ID
        const isNum = /^\d+$/.test(val);
        return isNum ? { kind, id: val } : { kind, name: val };
    });

    const partitionId: any = { projectId };
    const dbClean = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
    if (dbClean) partitionId.databaseId = dbClean;

    return { keyValue: { path, partitionId } };
};

export const buildDatastoreFilterObject = (
    prop: string,
    op: string,
    val: string,
    type: string,
    currentKind: string,
    projectId: string,
    databaseId?: string
): any => {
    if (prop === '__key__') {
        if (op === 'HAS_ANCESTOR') {
            const keyVal = parseDatastoreKeyFilter(val, currentKind, projectId, databaseId);
            return { propertyFilter: { property: { name: '__key__' }, op: 'HAS_ANCESTOR', value: keyVal } };
        } else if (op === 'IN' || op === 'NOT_IN') {
            const vals = val.split(',').map(x => x.trim()).filter(x => x !== '');
            const keyVals = vals.map(v => parseDatastoreKeyFilter(v, currentKind, projectId, databaseId));
            return { propertyFilter: { property: { name: '__key__' }, op, value: { arrayValue: { values: keyVals } } } };
        } else {
            const keyVal = parseDatastoreKeyFilter(val, currentKind, projectId, databaseId);
            return { propertyFilter: { property: { name: '__key__' }, op, value: keyVal } };
        }
    }

    if (op === 'IN' || op === 'NOT_IN') {
        const vals = val.split(',').map(x => x.trim()).filter(x => x !== '');
        const arrayVal = { arrayValue: { values: vals.map(v => parseTypedFilterVal(v, type)) } };
        return { propertyFilter: { property: { name: prop }, op, value: arrayVal } };
    }

    return { propertyFilter: { property: { name: prop }, op, value: parseTypedFilterVal(val, type) } };
};

