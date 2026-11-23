import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const migration = '20261115100000_ingestion_create_offer';
const editsMigration = '20261123100000_ingestion_apply_edits';
const populated = 'stdu_r1_009b_populated';
const restored = 'stdu_r1_009b_restored';

async function connected(url, work) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function transaction(client, work) {
  await client.query('BEGIN');
  try {
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function legacyFixture(client) {
  const actor = randomUUID();
  const supplier = randomUUID();
  const supplierRevision = randomUUID();
  const source = randomUUID();
  const run = randomUUID();
  await transaction(client, async () => {
    await client.query(
      `INSERT INTO staff_user(id,email,email_normalized,display_name,password_hash,state)
       VALUES ($1,'upgrade@example.invalid','upgrade@example.invalid','TEST upgrade','$argon2id$fixture','ACTIVE')`,
      [actor],
    );
    await client.query(
      `INSERT INTO supplier(id,legal_name,state,current_revision_id,created_by_staff_user_id,updated_by_staff_user_id)
       VALUES ($1,'TEST upgrade','ACTIVE',$2,$3,$3)`,
      [supplier, supplierRevision, actor],
    );
    await client.query(
      `INSERT INTO supplier_revision(id,supplier_id,revision_no,legal_name,recorded_by_staff_user_id)
       VALUES ($1,$2,1,'TEST upgrade',$3)`,
      [supplierRevision, supplier, actor],
    );
    await client.query(
      `INSERT INTO ingestion_source(id,supplier_id,adapter_version,fixture_key,state,max_rows,max_attempts,timeout_ms,actor_id)
       VALUES ($1,$2,'fixture-json/1','offers-v1','ENABLED',5,2,500,$3)`,
      [source, supplier, actor],
    );
    await client.query(
      `INSERT INTO ingestion_source_revision(id,source_id,version,snapshot,actor_id)
       VALUES ($1,$2,1,'{}',$3)`,
      [randomUUID(), source, actor],
    );
    await client.query(
      `INSERT INTO ingestion_run(id,source_id,source_version,source_snapshot,actor_id,request_id,state,processed,candidate_count,finished_at,raw_snapshot,source_hash)
       VALUES ($1,$2,1,'{}',$3,$4,'COMPLETE',5,5,clock_timestamp(),'[]'::bytea,encode(sha256('[]'::bytea),'hex'))`,
      [run, source, actor, randomUUID()],
    );
  });
  return { actor, supplier, source, run };
}

async function appliedFixture(client, fixture, index, operation, options = {}) {
  const { actor, supplier, source, run } = fixture;
  const row = String(index).padStart(64, '0');
  const decision = randomUUID();
  const offer = randomUUID();
  const base = randomUUID();
  const revision = randomUUID();
  const isCreate = operation === 'CREATE';
  const version = isCreate ? 1 : 2;
  const id = randomUUID();

  await transaction(client, async () => {
    await client.query(
      `INSERT INTO ingestion_row(id,run_id,row_number,source_hash,normalized,warnings,modification_evidence,review_state)
       SELECT $1,id,$2,source_hash,'{}','[]','SPECIFIED','PENDING' FROM ingestion_run WHERE id=$3`,
      [row, index, run],
    );
    await client.query(
      `INSERT INTO ingestion_decision(id,row_id,actor_id,decision,reason) VALUES ($1,$2,$3,'ACCEPT','TEST upgrade')`,
      [decision, row, actor],
    );
    await client.query(
      `UPDATE ingestion_row SET review_state='ACCEPTED',version=2 WHERE id=$1`,
      [row],
    );
    await client.query(
      `INSERT INTO supplier_offer(id,supplier_id,state,current_revision_id,version,created_by_staff_user_id,updated_by_staff_user_id)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$5)`,
      [offer, supplier, revision, version, actor],
    );
    if (!isCreate)
      await client.query(
        `INSERT INTO supplier_offer_revision(id,offer_id,revision_no,modification_evidence,origin,recorded_by_staff_user_id)
         VALUES ($1,$2,1,'UNKNOWN','MANUAL',$3)`,
        [base, offer, actor],
      );
    await client.query(
      `INSERT INTO supplier_offer_revision(id,offer_id,revision_no,modification_evidence,origin,recorded_by_staff_user_id)
       VALUES ($1,$2,$3,'UNKNOWN','MANUAL',$4)`,
      [revision, offer, version, actor],
    );

    const columns =
      'id,source_id,run_id,row_id,decision_id,actor_id,offer_id,base_revision_id,revision_id,source_hash,version';
    const values = [
      id,
      source,
      run,
      row,
      decision,
      actor,
      offer,
      options.wrongBase ?? (isCreate ? null : base),
      revision,
      version,
    ];
    if (isCreate) {
      await client.query(
        `INSERT INTO ingestion_application(${columns},operation)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,source_hash,$10,'CREATE' FROM ingestion_run WHERE id=$3`,
        values,
      );
    } else {
      // The existing writer does not know about the operation column.
      await client.query(
        `INSERT INTO ingestion_application(${columns})
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,source_hash,$10 FROM ingestion_run WHERE id=$3`,
        values,
      );
    }
    if (options.edits) {
      await client.query(
        'INSERT INTO ingestion_application_edits(application_id,edits,evidence) VALUES ($1,$2,$3)',
        [id, options.edits, { sourceVersion: 1, rowNumber: index }],
      );
    }
  });
  return { id, revision };
}

async function history(client) {
  const result = await client.query(
    `SELECT to_jsonb(a)-'operation' AS legacy FROM ingestion_application a ORDER BY row_id`,
  );
  return result.rows;
}

export async function runCreateMigrationProof({
  ownerUrl,
  migrationsRoot,
  prisma,
  execPostgres,
}) {
  // Both names are inside the caller's fresh, run-owned PostgreSQL container.
  const url = new URL(ownerUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/stdu_r1_008b_test');
  await connected(ownerUrl, async (client) => {
    await client.query('CREATE DATABASE stdu_r1_009b_populated');
    await client.query('CREATE DATABASE stdu_r1_009b_restored');
  });
  url.pathname = `/${populated}`;
  const names = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < migration)
    .map((entry) => entry.name)
    .sort();
  assert.equal(names.at(-1), '20261108090000_ingestion_manual_apply');
  let fixture;
  let old;
  await connected(url.href, async (client) => {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'),
      );
    fixture = await legacyFixture(client);
    old = await appliedFixture(client, fixture, 1, 'UPDATE');
  });
  for (const name of names)
    await prisma(url.href, ['migrate', 'resolve', '--applied', name]);
  const beforeExpansion = await connected(url.href, history);
  await connected(url.href, async (client) => {
    await client.query(
      await readFile(
        resolve(migrationsRoot, migration, 'migration.sql'),
        'utf8',
      ),
    );
    assert.deepEqual(await history(client), beforeExpansion);
    await appliedFixture(client, fixture, 2, 'CREATE');
    await appliedFixture(client, fixture, 3, 'UPDATE');
  });
  await prisma(url.href, ['migrate', 'resolve', '--applied', migration]);
  const baseline = await connected(url.href, history);
  await prisma(url.href, ['migrate', 'deploy']);
  await prisma(url.href, ['migrate', 'deploy']);

  const upgraded = await connected(url.href, async (client) => {
    assert.deepEqual(await history(client), baseline);
    assert.equal(
      (
        await client.query(
          'SELECT operation FROM ingestion_application WHERE id=$1',
          [old.id],
        )
      ).rows[0]?.operation,
      'UPDATE',
    );
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM _prisma_migrations
       WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
          [migration],
        )
      ).rows[0]?.count,
      1,
    );
    await assert.rejects(
      appliedFixture(client, fixture, 4, 'UPDATE', { wrongBase: old.revision }),
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
          [editsMigration],
        )
      ).rows[0]?.count,
      1,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO ingestion_application_edits(application_id,edits,evidence) VALUES ($1,'{}','{}')",
        [old.id],
      ),
      /same transaction/,
    );
    const edited = await appliedFixture(client, fixture, 4, 'UPDATE', {
      edits: {
        availabilityText: { op: 'CLEAR', reason: 'TEST retained edit' },
      },
    });
    await assert.rejects(
      client.query(
        'DELETE FROM ingestion_application_edits WHERE application_id=$1',
        [edited.id],
      ),
      /immutable history/i,
    );

    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM pg_constraint WHERE
       conrelid='ingestion_application'::regclass AND convalidated AND conname IN
       ('ingestion_application_base_offer_fk','ingestion_application_result_offer_fk')`,
        )
      ).rows[0]?.count,
      2,
    );
    await assert.rejects(
      client.query(
        `UPDATE ingestion_application SET version=version+1 WHERE id=$1`,
        [old.id],
      ),
      /immutable history/i,
    );
    await assert.rejects(
      client.query(`DELETE FROM ingestion_application WHERE id=$1`, [old.id]),
      /immutable history/i,
    );
    // Exercise the documented precondition before any reverse DDL.
    await assert.rejects(
      transaction(client, async () => {
        await client.query(
          'LOCK TABLE ingestion_application IN ACCESS EXCLUSIVE MODE',
        );
        await client.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM public.ingestion_application WHERE operation='CREATE') THEN
            RAISE EXCEPTION 'CREATE history exists: retain expanded schema';
          END IF;
        END $$;
        ALTER TABLE ingestion_application ALTER COLUMN base_revision_id SET NOT NULL;
      `);
      }),
      /CREATE history exists/,
    );
    return history(client);
  });

  const dump = '/tmp/stdu-r1-009b-populated.dump';
  await execPostgres([
    'pg_dump',
    '--username=postgres',
    '--format=custom',
    '--no-owner',
    '--file',
    dump,
    populated,
  ]);
  await execPostgres([
    'pg_restore',
    '--username=postgres',
    '--no-owner',
    '--exit-on-error',
    '--dbname',
    restored,
    dump,
  ]);
  url.pathname = `/${restored}`;
  await connected(url.href, async (client) => {
    assert.deepEqual(await history(client), upgraded);
    const rows = await client.query(
      'SELECT operation FROM ingestion_application ORDER BY row_id',
    );
    assert.deepEqual(
      rows.rows.map((row) => row.operation),
      ['UPDATE', 'CREATE', 'UPDATE', 'UPDATE'],
    );
    const details = await client.query(
      'SELECT edits FROM ingestion_application_edits',
    );
    assert.deepEqual(details.rows, [
      {
        edits: {
          availabilityText: { op: 'CLEAR', reason: 'TEST retained edit' },
        },
      },
    ]);
    await appliedFixture(client, fixture, 5, 'CREATE');
  });
  console.log(
    'PASS CREATE-01 and CLEAR populated upgrades, repeated deploy, legacy ledger writes, composite integrity, guarded rollback and pg_dump/restore.',
  );
}
