import { formatAuditUserName } from './datastore-utils';

export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mzdlzbdk';
export const FORMSPREE_ENTITY_CHUNK_SIZE = 500;

export interface EmailEntityItem {
    keyStr: string;
    name?: string;
    status?: string;
}

export interface OperationEmailOptions {
    operation: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    operatorEmail: string;
    srcProject?: string;
    tgtProject?: string;
    srcDb?: string;
    tgtDb?: string;
    kinds?: string[];
    summary: string;
    filters?: string[];
    rules?: string[];
    errorMessage?: string;
    entities?: EmailEntityItem[];
}

export const formatEmailEntityLine = (item: EmailEntityItem, index: number): string => {
    const namePart = item.name ? ` — "${item.name}"` : '';
    const statusPart = item.status ? ` [${item.status.toUpperCase()}]` : '';
    return `${index + 1}. ${item.keyStr}${namePart}${statusPart}`;
};

export const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
    if (items.length === 0) return [[]];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
};

export const buildOperationEmailPayloads = (opts: OperationEmailOptions): any[] => {
    const operatorEmail = opts.operatorEmail || 'unknown@dista.ai';
    const operatorName = formatAuditUserName(operatorEmail);
    const timestamp = new Date().toISOString();
    const entities = opts.entities || [];
    const entityChunks = chunkArray(entities, FORMSPREE_ENTITY_CHUNK_SIZE);
    const totalParts = entityChunks.length;

    const filtersText = opts.filters && opts.filters.length > 0
        ? opts.filters.join('\n  - ')
        : 'None';
    const rulesText = opts.rules && opts.rules.length > 0
        ? opts.rules.join('\n  - ')
        : 'None';

    return entityChunks.map((chunk, partIdx) => {
        const partNum = partIdx + 1;
        const partLabel = totalParts > 1 ? ` [Part ${partNum}/${totalParts}]` : '';
        const startOffset = partIdx * FORMSPREE_ENTITY_CHUNK_SIZE;

        const entityLines = chunk.length > 0
            ? chunk.map((item, i) => formatEmailEntityLine(item, startOffset + i)).join('\n')
            : 'None';

        const message = [
            `-------------------------------------------------------------`,
            `OPERATION: ${opts.operation} (${opts.status})${partLabel}`,
            `-------------------------------------------------------------`,
            `Operator: ${operatorEmail} (${operatorName})`,
            `Timestamp: ${timestamp}`,
            `Source: ${opts.srcProject || '—'} (DB: ${opts.srcDb || '(default)'})`,
            `Target: ${opts.tgtProject || '—'} (DB: ${opts.tgtDb || '(default)'})`,
            `Kinds: ${opts.kinds && opts.kinds.length > 0 ? opts.kinds.join(', ') : '—'}`,
            `Summary: ${opts.summary}`,
            `Filters Used:\n  - ${filtersText}`,
            `Find & Replace Rules:\n  - ${rulesText}`,
            opts.errorMessage ? `Error:\n${opts.errorMessage}` : '',
            ``,
            `Entities (${chunk.length} in this part, ${entities.length} total):`,
            entityLines
        ].filter(Boolean).join('\n');

        return {
            email: operatorEmail,
            _subject: `[GCP Portal] ${opts.operation} (${opts.status})${partLabel} by ${operatorEmail}`,
            operator: operatorEmail,
            operatorName,
            operation: opts.operation,
            status: opts.status,
            sourceProject: opts.srcProject || '—',
            targetProject: opts.tgtProject || '—',
            kinds: opts.kinds?.join(', ') || '—',
            totalEntities: entities.length,
            part: `${partNum}/${totalParts}`,
            timestamp,
            message
        };
    });
};

export const sendFormspreeOperationEmail = async (opts: OperationEmailOptions): Promise<void> => {
    const payloads = buildOperationEmailPayloads(opts);
    for (let i = 0; i < payloads.length; i++) {
        try {
            await fetch(FORMSPREE_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payloads[i]),
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            });
            if (i < payloads.length - 1) {
                await new Promise(r => setTimeout(r, 350));
            }
        } catch (err) {
            console.warn(`Formspree notification part ${i + 1}/${payloads.length} failed:`, err);
        }
    }
};
