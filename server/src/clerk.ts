// The Clerk boundary — the only place in this process that talks to Clerk.
//
// Deliberately narrow: it verifies a request's session token and reports who it belongs to.
// It touches no database and knows nothing about allowlists, provisioning or `users.id` —
// that is `identity.ts`, which is where the SQL invariants live and which the route tests
// therefore exercise for real. This file is the network edge, so it is the piece the tests
// replace (`mock.module("./clerk", …)`), the same split the R2 client already has.
//
// Verification is local: a Clerk session token is a JWT and the SDK caches the instance's
// JWKS, so the per-request cost is a signature check rather than a round trip. What is *not*
// in the token is an email address — Clerk's default session claims carry `sub`, not identity
// — so the email is fetched from Clerk's API, and returned behind a thunk so a caller that
// already knows this user never pays for it. See `identity.ts` for the cache that makes that
// the common case.

import { createClerkClient, type ClerkClient } from "@clerk/backend";

/** Who a verified request belongs to. `email()` is a thunk on purpose: resolving it is the
 *  one part of this that costs a network call, and most requests can answer from a cache
 *  keyed on `clerkId` alone. */
export type ClerkIdentity = { clerkId: string; email: () => Promise<string | null> };

const SECRET_KEY = process.env.CLERK_SECRET_KEY;
const PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;

/** Origins allowed to have minted the token (`azp`). Left unset the check is skipped, which
 *  is the right default for local development — a Vite dev server on :5174 is a different
 *  origin from `APP_URL` — and worth setting in production, where it stops a token issued to
 *  another application on the same Clerk instance from being replayed here. */
const AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const clerk: ClerkClient | null = SECRET_KEY
  ? createClerkClient({ secretKey: SECRET_KEY, publishableKey: PUBLISHABLE_KEY })
  : null;

if (!clerk) {
  // Not fatal: the public gallery, the schema and the health check all work without it. But
  // nobody can sign in, and that is worth one loud line at boot rather than a 401 nobody can
  // explain.
  console.warn("[clerk] CLERK_SECRET_KEY is unset — no one can sign in to this deployment.");
}

/** Whether this deployment can authenticate anyone at all. */
export const clerkConfigured = (): boolean => clerk !== null;

/** A `tsk_` personal API token is this application's own credential, not a Clerk one. Handing
 *  it to Clerk would fail as a malformed JWT and log noise for every agent request, so the
 *  bearer is inspected before the SDK is. */
const isOwnToken = (req: Request): boolean =>
  /^Bearer\s+tsk_/i.test(req.headers.get("authorization") ?? "");

/** How long a resolved email is remembered per Clerk user. Only ever reached after the
 *  request's JWT verified, so this can never keep a signed-out caller in. */
const EMAIL_CACHE_MS = 5 * 60_000;
const emails = new Map<string, { email: string | null; at: number }>();

async function emailOf(clerkId: string): Promise<string | null> {
  const hit = emails.get(clerkId);
  if (hit && Date.now() - hit.at < EMAIL_CACHE_MS) return hit.email;
  try {
    const user = await clerk!.users.getUser(clerkId);
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
    emails.set(clerkId, { email, at: Date.now() });
    return email;
  } catch (err) {
    // Not cached: a transient Clerk outage must not pin this user to "no email" for five
    // minutes, which would read to them as being locked out of their own account.
    console.warn("[clerk] could not read user", clerkId, err);
    return null;
  }
}

/** Verifies the request's Clerk session — the `__session` cookie the browser holds
 *  same-origin, or an `Authorization: Bearer <jwt>` — and reports whose it is.
 *
 *  Returns null for anything unverified, including the `handshake` state: that status exists
 *  for server-rendered page requests that can redirect, and this is a JSON API. A client whose
 *  token has gone stale gets a 401 and clerk-js refreshes it, which is the loop that already
 *  keeps the cookie fresh while a tab is open. */
export async function verifyClerkRequest(req: Request): Promise<ClerkIdentity | null> {
  if (!clerk || isOwnToken(req)) return null;
  try {
    const state = await clerk.authenticateRequest(req, {
      ...(AUTHORIZED_PARTIES.length > 0 ? { authorizedParties: AUTHORIZED_PARTIES } : {}),
    });
    if (!state.isAuthenticated) return null;
    const { userId } = state.toAuth();
    if (!userId) return null;
    return { clerkId: userId, email: () => emailOf(userId) };
  } catch (err) {
    console.warn("[clerk] verification failed", err);
    return null;
  }
}
