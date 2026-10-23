import { Client } from 'pg';

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const runtimePassword = process.env.STDU_RUNTIME_PASSWORD;
if (!migrationUrl || !runtimePassword || runtimePassword.length < 32) {
  throw new Error(
    'MIGRATION_DATABASE_URL and a generated STDU_RUNTIME_PASSWORD are required.',
  );
}

const client = new Client({
  connectionString: migrationUrl,
  application_name: 'stdu-runtime-role-provisioner',
  connectionTimeoutMillis: 3000,
  query_timeout: 5000,
  statement_timeout: 5000,
});
client.on('error', () => {});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('stdu.runtime_password', $1, true)", [
    runtimePassword,
  ]);
  await client.query(`
    DO $role$
    DECLARE
      runtime_role_oid oid;
    BEGIN
      SELECT oid INTO runtime_role_oid FROM pg_roles WHERE rolname = 'stdu_runtime';
      IF runtime_role_oid IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM pg_auth_members
          WHERE member = runtime_role_oid OR roleid = runtime_role_oid
        ) THEN
          RAISE EXCEPTION 'stdu_runtime has role memberships; review and remove them explicitly before provisioning';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM pg_shdepend
          WHERE refclassid = 'pg_authid'::regclass
            AND refobjid = runtime_role_oid
            AND deptype IN ('a', 'i', 'o', 'r')
        ) THEN
          RAISE EXCEPTION 'stdu_runtime has object ownership or privileges; review and remove them explicitly before provisioning';
        END IF;
        EXECUTE format(
          'ALTER ROLE stdu_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('stdu.runtime_password')
        );
      ELSE
        EXECUTE format(
          'CREATE ROLE stdu_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('stdu.runtime_password')
        );
      END IF;
    END;
    $role$;
  `);
  await client.query('COMMIT');
  const role = await client.query(`
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = 'stdu_runtime'
  `);
  const memberships = await client.query(`
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'stdu_runtime')
       OR roleid = (SELECT oid FROM pg_roles WHERE rolname = 'stdu_runtime')
    LIMIT 1
  `);
  const attributes = role.rows[0];
  if (
    !attributes ||
    attributes.rolsuper ||
    attributes.rolcreatedb ||
    attributes.rolcreaterole ||
    attributes.rolinherit ||
    attributes.rolreplication ||
    attributes.rolbypassrls ||
    memberships.rowCount !== 0
  )
    throw new Error(
      'stdu_runtime did not reach the required restricted role state.',
    );
  console.log(
    'PASS stdu_runtime role prepared without elevated database privileges.',
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  if (
    error instanceof Error &&
    (error.message.includes('stdu_runtime has role memberships') ||
      error.message.includes('stdu_runtime has object ownership or privileges'))
  ) {
    console.error(
      'Runtime role provisioning refused existing membership, ownership, or privileges. Review and remove that state explicitly before retrying.',
    );
    process.exitCode = 1;
  } else {
    console.error(
      'Runtime role preparation failed; check migration credentials and database availability.',
    );
    process.exitCode = 1;
  }
} finally {
  await client.end().catch(() => undefined);
}
