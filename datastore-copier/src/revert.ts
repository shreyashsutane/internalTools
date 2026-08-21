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

export const buildDatastoreRevertPlan = (
    state: any,
    targetProject: string
): DatastoreRevertPlan => {
    if (state?.type === 'DATASTORE_COPY') {
        const upserts: any[] = [];
        const deletes: any[] = [];
        for (const item of state.backupData || []) {
            if (item.action === 'upsert') {
                upserts.push({
                    upsert: retargetEntity(item.prevEntity, targetProject, state.tgtDb)
                });
            } else if (item.action === 'delete') {
                deletes.push({
                    delete: retargetKey(item.prevEntity?.key, targetProject, state.tgtDb)
                });
            } else {
                throw new Error(`Unsupported Datastore revert action: ${item.action}`);
            }
        }
        return { databaseId: state.tgtDb, upserts, deletes };
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
