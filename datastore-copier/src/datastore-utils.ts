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

export const deepEqual = (a: any, b: any): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((value, index) => deepEqual(value, b[index]));
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
};

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
    const normalized = fieldPath.trim();
    if (!normalized || normalized === '*') {
        return Object.values(properties).reduce(
            (count, value) => count + replaceDatastoreStringValues(value, target, replacement),
            0
        );
    }
    const segments = normalized.split('.').map(segment => segment.trim()).filter(Boolean);
    return replaceAtPath(properties, segments, target, replacement);
};
