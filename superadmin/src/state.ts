export interface QuestionEntity {
    key: any;
    keyStr: string;
    referenceName: string;
    queryField: 'queryString' | 'query';
    queryString: string;
    properties: Record<string, any>;
}

export interface BigQuerySchemaField {
    name: string;
    type: string;
    mode?: string;
    fields?: BigQuerySchemaField[];
}

export interface BigQueryResults {
    schema: BigQuerySchemaField[];
    rows: any[][];
    totalRows: number;
    executionTimeMs: number;
    totalBytesBilled: string;
    cacheHit?: boolean;
}

export interface SuperadminState {
    token: string;
    userEmail: string;
    userName: string;
    projectId: string;
    databaseId: string;
    accessibleProjects: { projectId: string; name: string }[];
    questions: QuestionEntity[];
    filteredQuestions: QuestionEntity[];
    searchQuery: string;
    selectedQuestion: QuestionEntity | null;
    rawSql: string;
    variables: string[];
    variableValues: Record<string, string>;
    modifiedProperties: Record<string, any>;
    bqResults: BigQueryResults | null;
    resultsFilter: string;
    currentPage: number;
    rowsPerPage: number;
    isExecuting: boolean;
    isSaving: boolean;
    isLoadingQuestions: boolean;
}

export const State: SuperadminState = {
    token: '',
    userEmail: '',
    userName: '',
    projectId: '',
    databaseId: '(default)',
    accessibleProjects: [],
    questions: [],
    filteredQuestions: [],
    searchQuery: '',
    selectedQuestion: null,
    rawSql: '',
    variables: [],
    variableValues: {},
    modifiedProperties: {},
    bqResults: null,
    resultsFilter: '',
    currentPage: 1,
    rowsPerPage: 50,
    isExecuting: false,
    isSaving: false,
    isLoadingQuestions: false
};
