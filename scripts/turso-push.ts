/**
 * Push the ToolHub Prisma schema to a remote Turso (libSQL) database.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://your-db-yourorg.turso.io \
 *   TURSO_AUTH_TOKEN=your-token \
 *   bun run db:turso
 *
 * Generates the SQLite DDL from prisma/schema.prisma completely offline
 * (`prisma migrate diff --from-empty`) and applies it over HTTPS — no Turso
 * CLI or local database needed. Safe to re-run: the DDL uses IF NOT EXISTS.
 */
import { spawnSync } from 'node:child_process'
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (!url) {
  console.error(
    'Missing TURSO_DATABASE_URL.\n' +
      'Create a free database at https://turso.tech, then run:\n' +
      '  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run db:turso'
  )
  process.exit(1)
}

console.log('Generating schema from prisma/schema.prisma ...')
const diff = spawnSync(
  'bunx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8' }
)

if (diff.error || diff.status !== 0) {
  console.error(diff.stderr?.trim() ?? String(diff.error))
  process.exit(1)
}

const sql = diff.stdout?.trim() ?? ''
if (!sql) {
  console.error('Prisma produced no SQL — check prisma/schema.prisma.')
  process.exit(1)
}

console.log(`Connecting to ${url} ...`)
const client = createClient({ url, authToken: authToken || undefined })

try {
  await client.executeMultiple(sql)
  console.log('✅ Schema applied to Turso successfully.')
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  )
  console.log(
    'Tables:',
    tables.rows.map((r) => String(r.name)).join(', ')
  )
} catch (err) {
  console.error('❌ Failed to apply schema:', err)
  console.error(
    'Hints: the URL must start with libsql:// (or https://) and the token ' +
      'must be valid. Regenerate tokens in the Turso dashboard.'
  )
  process.exit(1)
}
