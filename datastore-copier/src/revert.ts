import { cloneDatastoreValue, decompressJsonFromBase64, minifyJsonProperties } from './datastore-utils';

export interface DatastoreCommitApi {
    commitDatastore: (
        projectId: string,
        mutations: any[],
        databaseId?: string
    ) => Promise<any>;
}

export interface DatastoreRevertPlan {
    databaseId?: string;
    upserts: any[];
    deletes: any[];
}

export interface DatastoreRevertResult {
    restored: number;
    deleted: number;
    skippedDeletes: number;
}

export interface ScheduledQueryApi {
    deleteQuery: (name: string) => Promise<any>;
    createQuery: (projectId: string, location: string, config: any) => Promise<any>;
}

export interface ScheduledQueryRevertResult {
    restored: number;
    deleted: number;
    failed: number;
    errors: string[];
}

const cleanDatabaseId = (databaseId?: string): string =>
    databaseId === '(default)' || !databaseId ? '' : databaseId;

const targetPartition = (projectId: string, databaseId?: string): any => {
    const partitionId: any = { projectId };
    const cleanId = cleanDatabaseId(databaseId);
    if (cleanId) partitionId.databaseId = cleanId;
    return partitionId;
};

const retargetKey = (key: any, projectId: string, databaseId?: string): any => {
    if (!key || !Array.isArray(key.path) || key.path.length === 0) {
        throw new Error('Revert backup contains an invalid Datastore key.');
    }
    const copy = cloneDatastoreValue(key);
    copy.partitionId = targetPartition(projectId, databaseId);
    return copy;
};

const retargetEntity = (entity: any, projectId: string, databaseId?: string): any => {
    if (!entity?.key) throw new Error('Revert backup contains an entity without a key.');
    const copy = cloneDatastoreValue(entity);
    copy.key = retargetKey(copy.key, projectId, databaseId);
    minifyJsonProperties(copy.properties);
    return copy;
};

export interface BackupFileSummary {
    type: string;
    targetProject: string;
    sourceProject?: string;
    databaseId?: string;
    kinds: string[];
    timestamp?: string;
    totalEntities: number;
    upsertCount: number;
    deleteCount: number;
    partNumber?: number;
    isMultiPart?: boolean;
}

export const validateBackupPayload = (payload: any): { valid: boolean; summary?: BackupFileSummary; error?: string } => {
    if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Backup file does not contain a valid JSON object.' };
    }

    const backupData = Array.isArray(payload) ? payload : (payload.backupData || payload.data?.backupData);
    if (!Array.isArray(backupData) || backupData.length === 0) {
        return { valid: false, error: 'Backup file contains no backup entities or items.' };
    }

    let upsertCount = 0;
    let deleteCount = 0;
    const kindsSet = new Set<string>();

    for (let i = 0; i < backupData.length; i++) {
        const item = backupData[i];
        if (!item || typeof item !== 'object') {
            return { valid: false, error: `Invalid backup item at index ${i}.` };
        }
        const action = String(item.action || '').toLowerCase();
        const isUpsert = action === 'upsert' || action === 'restore' || action === 'update';
        const isDelete = action === 'delete' || action === 'create' || action === 'created';

        if (isUpsert) {
            upsertCount++;
            const entity = item.prevEntity || item.entity;
            if (!entity?.key) {
                return { valid: false, error: `Backup item at index ${i} is missing an entity key for restore.` };
            }
            const kind = entity.key?.path?.[entity.key.path.length - 1]?.kind;
            if (kind) kindsSet.add(kind);
        } else if (isDelete) {
            deleteCount++;
            const key = item.prevEntity?.key || item.key;
            if (!key) {
                return { valid: false, error: `Backup item at index ${i} is missing an entity key for deletion.` };
            }
            const kind = key?.path?.[key.path.length - 1]?.kind;
            if (kind) kindsSet.add(kind);
        } else {
            return { valid: false, error: `Unsupported backup action "${item.action}" at index ${i}.` };
        }
    }

    const kinds = Array.isArray(payload.kinds) && payload.kinds.length > 0
        ? payload.kinds
        : (payload.kind ? [payload.kind] : [...kindsSet]);

    const targetProject = payload.targetProject || payload.tgtProject || payload.projectId || '';
    const sourceProject = payload.sourceProject || payload.srcProject || '';
    const databaseId = payload.databaseId || payload.tgtDb || payload.targetDb || '(default)';
    const timestamp = payload.timestamp || payload.created || payload.date;
    const partNumber = typeof payload.partNumber === 'number' ? payload.partNumber : undefined;
    const isMultiPart = Boolean(payload.isMultiPart || payload.partNumber);

    return {
        valid: true,
        summary: {
            type: payload.type || 'DATASTORE_COPY',
            targetProject,
            sourceProject,
            databaseId,
            kinds,
            timestamp,
            totalEntities: backupData.length,
            upsertCount,
            deleteCount,
            partNumber,
            isMultiPart
        }
    };
};

export const sortBackupFiles = <T extends { name: string }>(files: T[]): T[] => {
    return [...files].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
};

export const buildDatastoreRevertPlan = (
    state: any,
    targetProject: string
): DatastoreRevertPlan => {
    if (state?.type === 'DATASTORE_COPY' || state?.type === 'DATASTORE_BACKUP') {
        const targetDb = state.tgtDb || state.targetDb || state.databaseId;
        const upserts: any[] = [];
        const deletes: any[] = [];
        for (const item of state.backupData || []) {
            const action = String(item.action || '').toLowerCase();
            const isUpsert = action === 'upsert' || action === 'restore' || action === 'update';
            const isDelete = action === 'delete' || action === 'create' || action === 'created';

            if (isUpsert) {
                const entity = item.prevEntity || item.entity;
                upserts.push({
                    upsert: retargetEntity(entity, targetProject, targetDb)
                });
            } else if (isDelete) {
                const key = item.prevEntity?.key || item.key;
                deletes.push({
                    delete: retargetKey(key, targetProject, targetDb)
                });
            } else {
                throw new Error(`Unsupported Datastore revert action: ${item.action}`);
            }
        }
        return { databaseId: targetDb, upserts, deletes };
    }

    if (state?.type === 'DATASTORE_EDIT') {
        if (state.prevEntity) {
            return {
                databaseId: state.dbId,
                upserts: [{
                    upsert: retargetEntity(state.prevEntity, targetProject, state.dbId)
                }],
                deletes: []
            };
        }
        return {
            databaseId: state.dbId,
            upserts: [],
            deletes: [{
                delete: retargetKey(state.rawKey, targetProject, state.dbId)
            }]
        };
    }

    throw new Error(`Unsupported Datastore revert type: ${state?.type || 'unknown'}`);
};

export const isPermissionDenied = (error: any): boolean =>
    error?.status === 403
    || error?.code === 'PERMISSION_DENIED'
    || /permission[_ ]?denied|not authorized|insufficient permission/i.test(String(error?.message || ''));

const commitChunks = async (
    api: DatastoreCommitApi,
    projectId: string,
    databaseId: string | undefined,
    mutations: any[],
    chunkSize: number
): Promise<number> => {
    let committed = 0;
    for (let offset = 0; offset < mutations.length; offset += chunkSize) {
        const chunk = mutations.slice(offset, offset + chunkSize);
        await api.commitDatastore(projectId, chunk, databaseId);
        committed += chunk.length;
    }
    return committed;
};

export const executeDatastoreRevert = async (
    api: DatastoreCommitApi,
    targetProject: string,
    state: any,
    chunkSize = 400
): Promise<DatastoreRevertResult> => {
    const rawState = state?.compressed && state?.data
        ? await decompressJsonFromBase64(state.data)
        : state;
    const plan = buildDatastoreRevertPlan(rawState, targetProject);
    const restored = await commitChunks(
        api,
        targetProject,
        plan.databaseId,
        plan.upserts,
        chunkSize
    );

    let deleted = 0;
    let skippedDeletes = 0;
    for (let offset = 0; offset < plan.deletes.length; offset += chunkSize) {
        const chunk = plan.deletes.slice(offset, offset + chunkSize);
        try {
            await api.commitDatastore(targetProject, chunk, plan.databaseId);
            deleted += chunk.length;
        } catch (error) {
            if (!isPermissionDenied(error)) throw error;
            skippedDeletes = plan.deletes.length - offset;
            break;
        }
    }

    return { restored, deleted, skippedDeletes };
};

const getTransferLocation = (name: string): string => {
    const match = String(name || '').match(/\/locations\/([^/]+)\//);
    if (!match) throw new Error(`Invalid scheduled-query resource name: ${name}`);
    return match[1];
};

export const executeScheduledQueryRevert = async (
    api: ScheduledQueryApi,
    targetProject: string,
    backupData: any[]
): Promise<ScheduledQueryRevertResult> => {
    let restored = 0;
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of backupData || []) {
        try {
            if (item.action === 'create' || !item.action) {
                await api.deleteQuery(item.name);
                deleted++;
                continue;
            }
            if (item.action !== 'update' || !item.prevQuery) {
                throw new Error(`Invalid scheduled-query revert action: ${item.action}`);
            }

            const location = getTransferLocation(item.name);
            await api.deleteQuery(item.name);
            try {
                await api.createQuery(targetProject, location, item.prevQuery);
                restored++;
            } catch (restoreError: any) {
                if (item.newQuery) {
                    try {
                        await api.createQuery(targetProject, location, item.newQuery);
                    } catch (rollbackError: any) {
                        throw new Error(
                            `Previous query restore failed (${restoreError.message}); `
                            + `recovery of the copied query also failed (${rollbackError.message}).`
                        );
                    }
                }
                throw restoreError;
            }
        } catch (error: any) {
            failed++;
            errors.push(String(error?.message || error));
        }
    }

    return { restored, deleted, failed, errors };
};
