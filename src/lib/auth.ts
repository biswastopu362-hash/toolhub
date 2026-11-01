import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'

/**
 * D76 Accounts — optional sign-in, guest mode default.
 *
 * Two paths:
 *  1. Google OAuth — activated automatically when GOOGLE_CLIENT_ID +
 *     GOOGLE_CLIENT_SECRET are present in the environment (Vercel).
 *  2. Local account — email-only credentials provider so the hub is
 *     usable in sandboxes / self-hosted installs without OAuth setup.
 *
 * Sessions are JWT (no database adapter): the sync API (D77) maps the
 * verified session email to a SyncAccount row on first use.
 *
 * Privacy stance unchanged: cloud sync is strictly opt-in. Guest users
 * (the default) never touch the server with their data.
 */
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? 'toolhub-dev-secret',
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: { params: { prompt: 'select_account' } },
          }),
        ]
      : []),
    CredentialsProvider({
      id: 'local',
      name: 'Local account',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
        name: { label: 'Name', type: 'text', placeholder: 'Optional display name' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
        return {
          id: email,
          email,
          name: credentials?.name?.trim() || email.split('@')[0],
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email
        if (user.name) token.name = user.name
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.email) {
        session.user.email = token.email as string
        if (token.name) session.user.name = token.name as string
      }
      return session
    },
  },
  pages: { signIn: '/' },
}

/** Providers available given the current environment (drives the UI). */
export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
