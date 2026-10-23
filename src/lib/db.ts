import { PrismaClient } from '@prisma/client'

/**
 * Lazy, deployment-safe Prisma client.
 *
 * - The client is created on first use, so a missing database URL never
 *   crashes the serverless function at import time — routes can catch the
 *   initialization error and answer with a helpful message instead.
 * - Connection string resolution order matches what Vercel's Postgres
 *   (Neon) integration injects: POSTGRES_PRISMA_URL (pooled, pgbouncer
 *   ready), then DATABASE_URL, then the plain POSTGRES_URL.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export function databaseUrl(): string | undefined {
  // Only Postgres URLs are valid for this schema. A stale non-postgres
  // value (e.g. a leftover file: SQLite path exported on a machine) is
  // ignored so it can never poison the connection.
  const candidates = [
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ]
  return candidates.find((u) => u && /^postgres(ql)?:\/\//.test(u))
}

function createClient(): PrismaClient {
  const url = databaseUrl()
  return url
    ? new PrismaClient({ datasources: { db: { url } } })
    : new PrismaClient()
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
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
