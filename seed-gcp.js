/**
 * Dista Tools - GCP Test Data Seeder
 * Seeds mock BigQuery datasets/tables and Datastore entities for testing.
 */

const { execSync } = require('child_process');
const https = require('https');

const SRC_PROJECT = 'project-c0e231c7-2177-4eb0-979';
const TGT_PROJECT = 'second-project-16364';

// Helper to get active GCP access token
function getAccessToken() {
    try {
        return execSync('gcloud auth print-access-token').toString().trim();
    } catch (e) {
        console.error('❌ Failed to get access token from gcloud. Make sure you are logged in.', e.message);
        process.exit(1);
    }
}

// Helper to make HTTPS requests to GCP APIs
function makeRequest(url, method, headers, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOpts = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers
        };
        const req = https.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data || '{}'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Run BigQuery CLI command
function runBq(command) {
    try {
        execSync(`bq ${command}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        // Return false to indicate it already existed or failed
        return false;
    }
}

async function seedBigQuery() {
    console.log('📊 Resetting and Seeding BigQuery datasets and tables...');

    // Create datasets
    runBq(`mk --project_id=${SRC_PROJECT} -d --location=us dummy_dataset`);
    runBq(`mk --project_id=${TGT_PROJECT} -d --location=us dummy_dataset`);

    // Clean up/remove existing tables from target project so it resets
    console.log('- Cleaning up previous target tables...');
    try { execSync(`bq rm -f --project_id=${TGT_PROJECT} -t dummy_dataset.dummy_table_ident`, { stdio: 'ignore' }); } catch(e) {}
    try { execSync(`bq rm -f --project_id=${TGT_PROJECT} -t dummy_dataset.dummy_table_diff`, { stdio: 'ignore' }); } catch(e) {}
    try { execSync(`bq rm -f --project_id=${TGT_PROJECT} -t dummy_dataset.dummy_table_missing`, { stdio: 'ignore' }); } catch(e) {}

    // Clean up/remove existing tables from source project
    console.log('- Cleaning up previous source tables...');
    try { execSync(`bq rm -f --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_ident`, { stdio: 'ignore' }); } catch(e) {}
    try { execSync(`bq rm -f --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_diff`, { stdio: 'ignore' }); } catch(e) {}
    try { execSync(`bq rm -f --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_missing`, { stdio: 'ignore' }); } catch(e) {}

    // Create Identical Tables
    console.log('- Creating identical tables...');
    runBq(`mk --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_ident id:INTEGER,name:STRING,age:INTEGER`);
    runBq(`mk --project_id=${TGT_PROJECT} -t dummy_dataset.dummy_table_ident id:INTEGER,name:STRING,age:INTEGER`);

    // Create Different Tables
    console.log('- Creating tables with schema differences...');
    runBq(`mk --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_diff id:INTEGER,name:STRING,age:INTEGER`);
    runBq(`mk --project_id=${TGT_PROJECT} -t dummy_dataset.dummy_table_diff id:INTEGER,name:STRING,email:STRING`);

    // Create Missing Table (Only in Source)
    console.log('- Creating missing table (source only)...');
    runBq(`mk --project_id=${SRC_PROJECT} -t dummy_dataset.dummy_table_missing id:INTEGER,name:STRING`);

    console.log('✅ BigQuery seeding finished.');
}

async function seedDatastore(token) {
    console.log('\n🗄️ Seeding Cloud Datastore (Firestore in Datastore mode) entities...');
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    // Helper to generate 100 properties
    const generate100Properties = (prefix, diffIdx = null, diffVal = null) => {
        const props = {};
        for (let i = 1; i <= 100; i++) {
            const propName = `col_${String(i).padStart(3, '0')}`;
            if (diffIdx && i === diffIdx) {
                props[propName] = diffVal;
            } else if (i === 1) {
                props[propName] = { stringValue: `${prefix}_val_1` };
            } else if (i === 2) {
                props[propName] = { integerValue: '100' };
            } else if (i === 3) {
                props[propName] = { booleanValue: true };
            } else {
                props[propName] = { stringValue: `val_${i}` };
            }
        }
        return props;
    };

    // Source entities (Alice, Bob, and JobMaster job-1/job-2)
    const srcMutations = [
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'DummyKind', name: 'entity-1' }]
                },
                properties: {
                    name: { stringValue: 'Alice' },
                    age: { integerValue: '30' },
                    active: { booleanValue: true }
                }
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'DummyKind', name: 'entity-2' }]
                },
                properties: {
                    name: { stringValue: 'Bob' },
                    age: { integerValue: '25' },
                    active: { booleanValue: false }
                }
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'JobMaster', name: 'job-1' }]
                },
                properties: generate100Properties('source')
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'JobMaster', name: 'job-2' }]
                },
                properties: generate100Properties('source_job2')
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'DummyKind', name: 'entity-3' }]
                },
                properties: {
                    name: { stringValue: 'Charlie' },
                    age: { integerValue: '40' },
                    active: { booleanValue: true }
                }
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: SRC_PROJECT },
                    path: [{ kind: 'JobMaster', name: 'job-3' }]
                },
                properties: generate100Properties('source')
            }
        }
    ];

    // Target entities (Alice has different age, Bob is missing/deleted, JobMaster has diff/delete)
    const tgtMutations = [
        {
            upsert: {
                key: {
                    partitionId: { projectId: TGT_PROJECT },
                    path: [{ kind: 'DummyKind', name: 'entity-1' }]
                },
                properties: {
                    name: { stringValue: 'Alice' },
                    age: { integerValue: '31' }, // Different age (31 vs 30)
                    active: { booleanValue: true }
                }
            }
        },
        {
            delete: {
                partitionId: { projectId: TGT_PROJECT },
                path: [{ kind: 'DummyKind', name: 'entity-2' }]
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: TGT_PROJECT },
                    path: [{ kind: 'JobMaster', name: 'job-1' }]
                },
                properties: generate100Properties('source', 2, { integerValue: '200' }) // col_002 is different
            }
        },
        {
            delete: {
                partitionId: { projectId: TGT_PROJECT },
                path: [{ kind: 'JobMaster', name: 'job-2' }]
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: TGT_PROJECT },
                    path: [{ kind: 'DummyKind', name: 'entity-3' }]
                },
                properties: {
                    name: { stringValue: 'Charlie' },
                    age: { integerValue: '40' },
                    active: { booleanValue: true }
                }
            }
        },
        {
            upsert: {
                key: {
                    partitionId: { projectId: TGT_PROJECT },
                    path: [{ kind: 'JobMaster', name: 'job-3' }]
                },
                properties: generate100Properties('source')
            }
        }
    ];

    try {
        console.log(`- Upserting source entities to ${SRC_PROJECT}...`);
        await makeRequest(
            `https://datastore.googleapis.com/v1/projects/${SRC_PROJECT}:commit`,
            'POST',
            headers,
            { mode: 'NON_TRANSACTIONAL', mutations: srcMutations }
        );
        console.log('  ✅ Source entities upserted.');

        console.log(`- Upserting target entities to ${TGT_PROJECT}...`);
        await makeRequest(
            `https://datastore.googleapis.com/v1/projects/${TGT_PROJECT}:commit`,
            'POST',
            headers,
            { mode: 'NON_TRANSACTIONAL', mutations: tgtMutations }
        );
        console.log('  ✅ Target entities upserted.');
        console.log('✅ Datastore seeding finished.');

    } catch (e) {
        console.error('❌ Datastore seeding failed. Ensure Cloud Datastore API is enabled in both projects and you have Datastore Owner/User permissions.');
        console.error('   Error details:', e.message);
    }
}

async function seedScheduledQueries(token) {
    console.log('\n⏰ Seeding BigQuery Scheduled Queries...');
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const queryConfig = {
        displayName: 'Daily Dummy Query',
        dataSourceId: 'scheduled_query',
        schedule: 'every 24 hours',
        destinationDatasetId: 'dummy_dataset',
        params: {
            query: 'SELECT 1 AS dummy_val;'
        }
    };

    try {
        console.log(`- Creating scheduled query in source: ${SRC_PROJECT}...`);
        await makeRequest(
            `https://bigquerydatatransfer.googleapis.com/v1/projects/${SRC_PROJECT}/locations/us/transferConfigs`,
            'POST',
            headers,
            queryConfig
        );
        console.log('  ✅ Scheduled query created in source project.');
    } catch (e) {
        if (e.message.includes('ALREADY_EXISTS') || e.message.includes('AlreadyExists') || e.message.includes('already exists') || e.message.includes('409')) {
            console.log('  ✅ Scheduled query already exists in source project.');
        } else {
            console.error('❌ Scheduled queries seeding failed. Ensure BigQuery Data Transfer API is enabled in your project.');
            console.error('   Error details:', e.message);
        }
    }
}

async function main() {
    const token = getAccessToken();
    console.log(`🔑 Token verified for GCP session.`);

    await seedBigQuery();
    await seedScheduledQueries(token);
    await seedDatastore(token);

    console.log('\n🎉 Seeding complete! You can now run the tool and verify identical, different, and missing comparison cases.');
}

main();
