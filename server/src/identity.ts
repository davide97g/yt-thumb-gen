// Who is allowed in, and which row they are.
//
// Clerk answers "which Google account is this" (see `clerk.ts`). This file answers the two
// questions that belong to the application:
//
//   1. **is this address allowed here at all** — `ALLOWED_EMAILS`. A password login was its own
//      gate: you could not sign in without a credential someone had created for you. A Google
//      button has no such property — every Google account on earth can press it — so the gate
//      has to be stated somewhere, and an env var is the one place an operator can change it
//      without a deploy. Unset, it falls back to the rule this replaced (the first account
//      claims the instance), so a fresh deployment is still usable and an established one still
//      admits nobody new.
//
//   2. **which `users` row** — every project, blob, campaign, favourite and version is keyed by
//      `users.id`, a uuid this application minted. So Clerk's id is a *link* (`users.clerk_id`),
//      not a replacement: making `user_xxx` the primary key would have meant rewriting six
//      foreign keys to change nothing observable. A first sign-in matches an existing row **by
//      email** and claims it, which is what carries an account created under password auth —
//      and everything it owns — across to Clerk without touching a single project row.
//
// The resolution is cached per Clerk id, because it is on the path of every authenticated
// request including every image byte. What is *not* cached is the token check: `clerk.ts`
// verifies the JWT every time, so a revoked session stops working within the token's lifetime
// (~60s) regardless of what this holds.

import type { ClerkIdentity } from "./clerk";
import { sql } from "./db";

export type User = { id: string; email: string };

/** Addresses permitted to hold an account. Empty means "fall back to first-user-wins".
 *
 *  Read per call rather than captured at import, the same reason `gcMode()` is: a rule that only
 *  exists at module-load time can be tested in exactly one configuration per process, and this
 *  one has two arms that both matter — who is admitted and who is refused. An operator still
 *  gets the restart-to-apply behaviour they'd expect from a constant, since nothing rereads the
 *  environment mid-life. */
const allowlist = (): Set<string> =>
  new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

/** `"denied"` is distinct from `null` on purpose. Null is "no credential" — the ordinary 401
 *  that a signed-out browser gets. Denied is "a verified identity this deployment will not
 *  serve", which the front door has to be able to *say*: the alternative is a signed-in user
 *  staring at an editor whose every save 401s. */
export type Resolution = User | "denied";

const CACHE_MS = 5 * 60_000;
const resolved = new Map<string, { user: User; at: number }>();

/** Whether an address may hold an account. With no allowlist configured this is the old rule:
 *  the first account is free and every one after it is refused. `EXISTS` rather than a count —
 *  the question is whether the table is empty. */
async function admissible(email: string): Promise<boolean> {
  const allowed = allowlist();
  if (allowed.size > 0) return allowed.has(email);
  const [{ any: taken }] = await sql<{ any: boolean }[]>`SELECT EXISTS(SELECT 1 FROM users) AS any`;
  return !taken;
}

/** Maps a verified Clerk identity to this application's user row, creating or claiming one the
 *  first time. Returns `"denied"` when the address isn't allowed here. */
export async function resolveClerkUser(identity: ClerkIdentity): Promise<Resolution> {
  const hit = resolved.get(identity.clerkId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;

  // Already linked. Asked first and by clerk_id, not by email: a user who changes the address
  // on their Google account must keep the row that owns their designs, not be handed a new one.
  const [linked] = await sql<User[]>`SELECT id, email FROM users WHERE clerk_id = ${identity.clerkId}`;
  if (linked) {
    resolved.set(identity.clerkId, { user: linked, at: Date.now() });
    return linked;
  }

  // First sign-in for this Clerk user. The email decides both questions — whether they may be
  // here, and which existing row (if any) is theirs.
  const email = (await identity.email())?.toLowerCase();
  if (!email) return "denied"; // a Clerk user with no primary address; nothing to match on
  if (!(await admissible(email))) {
    console.warn(`[identity] refused ${email} — not in ALLOWED_EMAILS`);
    return "denied";
  }

  // `ON CONFLICT (email)` is the migration path: an account that already exists under this
  // address is claimed rather than duplicated, so its projects, blobs, campaigns, favourites
  // and version history all carry over untouched. `password_hash` is left null — migration 008
  // dropped its NOT NULL, because there is no longer any such thing as a password here.
  const [user] = await sql<User[]>`
    INSERT INTO users (email, clerk_id) VALUES (${email}, ${identity.clerkId})
    ON CONFLICT (email) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
    RETURNING id, email`;
  console.log(`[identity] linked ${email} to ${identity.clerkId}`);
  resolved.set(identity.clerkId, { user, at: Date.now() });
  return user;
}

/** Boot-time sanity check on the allowlist against what is actually in the table.
 *
 *  The failure this exists to make visible: an allowlist that doesn't contain the address an
 *  existing account was created under. Nothing breaks loudly — the owner signs in with Google,
 *  is refused, and their designs appear to have vanished. Or, worse with a permissive
 *  allowlist, they are handed a *new empty row* and the old one is orphaned. Both are one
 *  `UPDATE users SET email = …` away from fixed, but only if someone knows to look. */
export async function auditAllowlist(): Promise<void> {
  const allowed = allowlist();
  if (allowed.size === 0) return;
  const rows = await sql<{ email: string; clerk_id: string | null }[]>`SELECT email, clerk_id FROM users`;
  for (const row of rows) {
    if (!allowed.has(row.email.toLowerCase())) {
      console.warn(
        `[identity] user "${row.email}" owns data but is not in ALLOWED_EMAILS — they cannot sign in, ` +
          `and a permitted address will be given a new empty account instead of this one.`
      );
    }
  }
}
