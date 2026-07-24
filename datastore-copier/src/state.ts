export interface BqTable {
    dataset: string;
    table: string;
    srcSchema: any[] | null;
    tgtSchema: any[] | null;
    status: 'different' | 'source_only' | 'target_only' | 'identical' | 'checking';
    diffs?: any[];
}

export interface QueryComparison {
    name: string;
    displayName: string;
    status: 'different' | 'source_only' | 'target_only' | 'identical';
    srcQuery: any | null;
    tgtQuery: any | null;
    diffFields: string[];
}

export interface DsResult {
    keyStr: string;
    rawKey: any;
    status: 'different' | 'missing' | 'identical';
    diff?: any[];
    diffSum: string;
    srcEntity: any | null;
    tgtEntity: any | null;
}

export interface StateType {
    token: string | null;
    authEmail: string;
    projects: any[];
    mode: string;
    cancelDs: boolean;
    bq: {
        src: string;
        tgt: string;
        srcDs: string;
        tgtDs: string;
        tables: BqTable[];
        filtered: BqTable[];
        page: number;
        perPage: number;
        search: string;
        datasetsSrc: string[];
        datasetsTgt: string[];
    };
    query: {
        src: string;
        tgt: string;
        srcLoc: string;
        tgtLoc: string;
        queries: QueryComparison[];
        selected: Set<string>;
    };
    ds: {
        src: string;
        tgt: string;
        srcDb: string;
        tgtDb: string;
        kind: string;
        modField: string;
        modTarget: string;
        modReplace: string;
        results: DsResult[];
        filtered: DsResult[];
        stats: {
            identical: number;
            different: number;
            missing: number;
            total: number;
        };
        page: number;
        perPage: number;
        filterStatus: string;
        selected: Set<string>;
        kinds: string[];
        properties: string[];
        databasesSrc: string[];
        databasesTgt: string[];
    };
    subscribe: (event: string, cb: () => void) => void;
    notify: (event: string) => void;
}

const observers = new Map<string, Array<() => void>>();

export const State: StateType = {
    token: null,
    authEmail: '',
    projects: [],
    mode: 'bq',
    cancelDs: false,
    bq: {
        src: '',
        tgt: '',
        srcDs: '',
        tgtDs: '',
        tables: [],
        filtered: [],
        page: 1,
        perPage: 50,
        search: '',
        datasetsSrc: [],
        datasetsTgt: []
    },
    query: {
        src: '',
        tgt: '',
        srcLoc: 'us',
        tgtLoc: 'us',
        queries: [],
        selected: new Set<string>()
    },
    ds: {
        src: '',
        tgt: '',
        srcDb: '(default)',
        tgtDb: '(default)',
        kind: '',
        modField: '',
        modTarget: '',
        modReplace: '',
        results: [],
        filtered: [],
        stats: { identical: 0, different: 0, missing: 0, total: 0 },
        page: 1,
        perPage: 50,
        filterStatus: 'all',
        selected: new Set<string>(),
        kinds: [],
        properties: [],
        databasesSrc: [],
        databasesTgt: []
    },
    subscribe: (event: string, cb: () => void): void => {
        if (!observers.has(event)) {
            observers.set(event, []);
        }
        observers.get(event)!.push(cb);
    },
    notify: (event: string): void => {
        const list = observers.get(event);
        if (list) {
            list.forEach(cb => cb());
        }
    }
};
