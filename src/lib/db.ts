import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Lazy, deployment-safe Prisma client backed by libSQL.
 *
 * One code path for every environment:
 *   1. TURSO_DATABASE_URL set (Vercel)  -> remote Turso database, persists.
 *   2. DATABASE_URL=file:... (local)    -> plain SQLite file, zero setup.
 *   3. Neither set                      -> ./db/custom.db fallback.
 *
 * The client is created on first use, so a broken/missing database never
 * crashes the serverless function at import time — routes can catch the
 * initialization error and answer with a helpful message instead.
 */

const DEFAULT_FILE_URL = 'file:./db/custom.db'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** Connection target: remote libSQL/Turso URL, or a local SQLite file URL. */
export function databaseUrl(): string {
  const turso = process.env.TURSO_DATABASE_URL?.trim()
  if (turso) return turso

  const local = process.env.DATABASE_URL?.trim()
  if (local && local.startsWith('file:')) return local

  return DEFAULT_FILE_URL
}

/** Best-effort: libSQL cannot create missing parent directories itself. */
function ensureLocalFileDir(url: string): void {
  if (!url.startsWith('file:')) return
  const filePath = url.slice('file:'.length)
  if (!filePath || filePath.includes(':memory:')) return
  try {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
  } catch {
    // Read-only filesystem (e.g. misconfigured serverless) — the error the
    // client throws on first write is more actionable than anything here.
  }
}

function createPrismaClient(): PrismaClient {
  const url = databaseUrl()
  const isRemote = /^(libsql|https?|ws|wss):/.test(url)
  const authToken = isRemote ? process.env.TURSO_AUTH_TOKEN?.trim() : undefined
  if (!isRemote) ensureLocalFileDir(url)

  // The adapter builds the underlying @libsql/client from this config.
  return new PrismaClient({
    adapter: new PrismaLibSQL({ url, authToken: authToken || undefined }),
  })
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<
      string | symbol,
      unknown
    >
    const value = client[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
