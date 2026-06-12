// =============================================================================
// SQL test runner - executes the Phase 1 SQL against a throwaway in-process
// Postgres (PGlite, real Postgres compiled to WASM). Nothing touches Supabase.
//
//   npm run test:sql
//
// Order: local_shim.sql (fake Supabase env) -> schema.sql -> rls_policies.sql
// -> seed.sql -> smoke_test.sql (role-by-role RLS assertions).
// Exits non-zero on the first failure and prints the offending error.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.error('PGlite is not installed. Run:  npm install --save-dev @electric-sql/pglite');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const steps = [
  ['supabase/tests/local_shim.sql', 'local Supabase shim (roles + auth schema)'],
  ['supabase/schema.sql',           'schema: tables, constraints, triggers'],
  ['supabase/rls_policies.sql',     'RLS policies + privilege hardening'],
  ['supabase/seed.sql',             'seed: baseline template, 22 items, 23 boxes'],
  ['supabase/tests/smoke_test.sql', 'RLS smoke tests (all roles, all tables)'],
];

const db = new PGlite();
const { rows: [v] } = await db.query('select version()');
console.log(`PGlite ready: ${v.version.split(' on ')[0]}\n`);

let ok = true;
for (const [rel, label] of steps) {
  const sql = readFileSync(join(root, rel), 'utf8');
  const started = Date.now();
  try {
    await db.exec(sql);
    console.log(`PASS  ${label}  [${rel}] (${Date.now() - started} ms)`);
  } catch (err) {
    ok = false;
    console.error(`FAIL  ${label}  [${rel}]`);
    console.error(`      ${err.message}`);
    break;
  }
}

if (ok) {
  const summary = await db.query(`
    select
      (select count(*) from public.first_aid_kit_templates)      as templates,
      (select count(*) from public.first_aid_kit_template_items) as template_items,
      (select count(*) from public.boxes)                        as boxes,
      (select count(*) from public.box_items)                    as box_items,
      (select count(*) from public.box_assignments)              as assignments,
      (select count(*) from pg_policies where schemaname = 'public') as rls_policies
  `);
  const s = summary.rows[0];
  console.log('\nPost-run state:');
  console.log(`  templates=${s.templates} template_items=${s.template_items} boxes=${s.boxes}`);
  console.log(`  box_items=${s.box_items} assignments=${s.assignments} rls_policies=${s.rls_policies}`);
  console.log('\nAll SQL files executed cleanly and every RLS assertion held.');
}

await db.close();
process.exit(ok ? 0 : 1);
