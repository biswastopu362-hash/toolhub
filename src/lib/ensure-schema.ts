import { db } from './db'

/**
 * Serverless-safe database bootstrapping for Linked Platforms.
 *
 * The app can deploy before the database has any tables (e.g. the moment a
 * fresh Postgres database gets connected in Vercel). These helpers make the
 * external-apps APIs self-heal: the first request creates the schema if it
 * is missing, and every database failure maps to a message that tells the
 * owner exactly what to do.
 */

let schemaPromise: Promise<void> | null = null

const CREATE_EXTERNAL_APP_SQL = `
CREATE TABLE IF NOT EXISTS "ExternalApp" (
  "id"          TEXT         NOT NULL PRIMARY KEY,
  "slug"        TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "url"         TEXT         NOT NULL,
  "description" TEXT         NOT NULL,
  "tagline"     TEXT         NOT NULL DEFAULT '',
  "category"    TEXT         NOT NULL DEFAULT 'utilities',
  "icon"        TEXT         NOT NULL DEFAULT 'Globe',
  "gradient"    TEXT         NOT NULL DEFAULT 'from-emerald-400 via-teal-500 to-cyan-600',
  "glow"        TEXT         NOT NULL DEFAULT '#10b981',
  "developer"   TEXT         NOT NULL DEFAULT 'Linked platform',
  "keywords"    TEXT         NOT NULL DEFAULT '',
  "featured"    BOOLEAN      NOT NULL DEFAULT false,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalApp_slug_key"
  ON "ExternalApp"("slug");
CREATE INDEX IF NOT EXISTS "ExternalApp_active_createdAt_idx"
  ON "ExternalApp"("active", "createdAt");
`

/** Create the Linked Platforms schema once per serverless instance. */
export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = db.$executeRawUnsafe(CREATE_EXTERNAL_APP_SQL).then(
      () => undefined,
      (err) => {
        schemaPromise = null // allow a retry once the database is reachable
        throw err
      }
    )
  }
  return schemaPromise
}

/**
 * Translate a raw Prisma failure into a message the owner can act on.
 * Returns null when the error is not a database-availability problem
 * (callers then fall back to their own wording).
 */
export function describeDbError(err: unknown): string | null {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''

  if (
    code === 'P1001' || // can't reach the database server
    code === 'P1002' || // timed out
    code === 'P1012' || // invalid URL / env missing
    raw.includes('Environment variable not found') ||
    raw.includes("Can't reach database server") ||
    raw.includes('database server has closed the connection')
  ) {
    return (
      'The platform database is not connected on this deployment. ' +
      'In Vercel open your project → Storage → Create Database → Postgres, ' +
      'connect it to this project, then redeploy.'
    )
  }
  if (code === 'P2021' || raw.includes('does not exist in the current database')) {
    return (
      'The platform table is missing in the connected database. ' +
      'Retry once — the app creates it automatically on the first request.'
    )
  }
  return null
}
