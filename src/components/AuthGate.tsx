// Authentication gate. Wraps the whole editor and decides which of three visitors is at the
// door before the app's mount/hydration/autosave effects are allowed to run:
//
//   • the owner, signed in with Google — the editor exactly as it has always worked;
//   • a guest, who gets the same editor over a read-only session: they can open any published
//     design and push it around, but nothing they do reaches the backend;
//   • nobody yet — the sign-in card.
//
// **Clerk holds the credential** (Google is the only strategy enabled on the instance), and the
// backend still holds the row: `/auth/me` is what turns a Clerk session into this workspace's
// user, and the only thing that knows whether the account is allowed here at all. So the gate
// asks two questions in order — Clerk first ("is anyone signed in"), the API second ("are they
// allowed, and who are they to us") — and a "yes, but denied" is its own state, because a
// signed-in visitor with no access needs to be told that rather than shown an editor whose
// every save fails.
//
// A guest has **no server-side identity**: no session, no cookie, no token, and Clerk never
// sees them. Guest is a client state, which is why the server never has to tell a guest apart
// from a stranger with curl — they are the same caller, and neither can reach a route that
// writes.
//
// The gate is also where the two storage decisions are made, once, before the editor mounts:
// `setScope` picks which IndexedDB key namespace this visitor autosaves into (so a guest's
// canvas can never overwrite the owner's on a shared browser) and, with it, whether remote
// writes are permitted at all.

import { AuthenticateWithRedirectCallback, useClerk, useSignIn, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiGet } from "../lib/api";
import { clearWorking, setScope } from "../lib/storage";
import { DuckSpinner } from "./ui/duck-spinner";
import { HoloSeparator } from "./ui/holo-separator";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerCard } from "./ui/sticker-card";

type User = { id: string; email: string };

/** Remembers that this browser chose to browse as a guest, so a reload doesn't dump them back
 *  on the sign-in card — their local canvas is still there and would otherwise look lost. */
const GUEST_FLAG = "thumb-guest";

/** Where Google sends the browser back to. Not a route — this app has no router — but a
 *  pathname the gate recognises before it does anything else, served `index.html` by the SPA
 *  fallback like every other unknown path. It exists because completing an OAuth handshake is
 *  Clerk's work and it needs somewhere to do it. */
const SSO_CALLBACK = "/sso-callback";

type AuthCtx = {
  /** Null in guest mode. Every consumer must handle that. */
  user: User | null;
  isGuest: boolean;
  /** The single question the UI should ask before showing anything that saves. */
  canWrite: boolean;
  logout: () => Promise<void>;
  /** Leave guest mode and go back to the sign-in card. */
  signIn: () => void;
};
const Ctx = createContext<AuthCtx | null>(null);

/** Access the current visitor + session actions. Only valid inside the gate's subtree.
 *  `user` is null for a guest — check `canWrite`, not `user`, when gating an action. */
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const clerk = useClerk();
  const [status, setStatus] = useState<"loading" | "in" | "guest" | "out" | "denied">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // A Clerk session always wins over a remembered guest choice, which is why this branch is
      // only reached once Clerk has said there isn't one.
      if (localStorage.getItem(GUEST_FLAG) === "1") enterGuest();
      else setStatus("out");
      return;
    }
    // Signed in with Google — but this workspace decides whether that account is served, and
    // it is the only thing that knows our own user id. The 403 is a real answer, not a failure.
    apiGet<User>("/auth/me")
      .then(enterOwner)
      .catch((err) => setStatus(err instanceof ApiError && err.status === 403 ? "denied" : "out"));
  }, [isLoaded, isSignedIn]);

  function enterOwner(u: User) {
    localStorage.removeItem(GUEST_FLAG);
    // Whatever a guest left on this browser goes now. It's someone else's scratch canvas and
    // it has no reason to sit in the owner's storage; a guest starting fresh is the right
    // outcome anyway.
    void clearWorking("guest").catch(() => {});
    setScope("owner");
    setUser(u);
    setStatus("in");
  }

  function enterGuest() {
    localStorage.setItem(GUEST_FLAG, "1");
    setScope("guest");
    setUser(null);
    setStatus("guest");
  }

  async function logout() {
    await clearWorking("owner").catch(() => {}); // don't leak the previous user's canvas to the next sign-in
    localStorage.removeItem(GUEST_FLAG);
    setScope("owner");
    setUser(null);
    setStatus("out");
    // Last, and unawaited by anything above it: Clerk's sign-out is a network call, and the
    // local canvas must be gone before the next visitor can possibly be at the keyboard.
    await clerk.signOut().catch(() => {});
  }

  // Google's redirect lands here. Rendered before anything else, and outside the state machine
  // above: this pathname is a handshake in progress, not a visitor to classify.
  if (window.location.pathname === SSO_CALLBACK) {
    return (
      <div className="grid h-full place-items-center bg-background">
        <DuckSpinner label="Signing you in" />
        <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
      </div>
    );
  }

  if (status === "loading" || !isLoaded) {
    return (
      <div className="grid h-full place-items-center bg-background">
        <DuckSpinner label="Checking your session" />
      </div>
    );
  }
  if (status === "out" || status === "denied") {
    return <AuthForm denied={status === "denied"} onGuest={enterGuest} onSignOut={logout} />;
  }
  const isGuest = status === "guest";
  return (
    <Ctx.Provider
      value={{
        user,
        isGuest,
        canWrite: !isGuest && user !== null,
        logout,
        signIn: () => { localStorage.removeItem(GUEST_FLAG); setStatus("out"); },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

function AuthForm({ denied, onGuest, onSignOut }: { denied: boolean; onGuest: () => void; onSignOut: () => Promise<void> }) {
  const { isLoaded, signIn } = useSignIn();
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Asked rather than assumed: a deployment with no CLERK_SECRET_KEY can't sign anyone in,
    // and a button that silently does nothing reads as a broken product rather than an
    // unconfigured one.
    apiGet<{ clerk: boolean }>("/auth/status")
      .then(({ clerk }) => setConfigured(clerk))
      .catch(() => {});
  }, []);

  async function google() {
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: SSO_CALLBACK,
        // Back to wherever they were, not to `/`: the editor mirrors the open project into
        // `?project=<id>`, so a deep link that prompted a sign-in has to survive the round trip.
        redirectUrlComplete: window.location.href,
      });
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage || err?.message || "Sign-in failed");
      setBusy(false);
    }
  }

  // The whole product's holo budget is spent here: the front door is the one screen
  // with a single object on it, so the iridescent ring has nothing to compete with.
  // Every other viewport in the editor is lime-only — see the note in styles.css.
  return (
    <div className="grid h-full place-items-center bg-background p-4">
      <StickerCard holo className="w-[min(380px,92vw)]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
            <span className="size-2.5 rounded-full bg-primary duck-glow-primary" />
          </span>
          <div className="leading-tight">
            <div className="font-display text-sm font-bold tracking-tight">Thumb Studio</div>
            <HudLabel size="sm" tracking="tight">
              Sign in
            </HudLabel>
          </div>
        </div>

        {/* A verified Google account that this workspace won't serve. Distinct from a failed
            sign-in, and the only useful thing to offer is the door back out — trying the same
            account again cannot produce a different answer. */}
        {denied ? (
          <>
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              That Google account doesn't have access to this workspace.
            </p>
            <QuackButton type="button" variant="outline" className="w-full" onClick={() => void onSignOut()}>
              Use a different account
            </QuackButton>
          </>
        ) : (
          <>
            <QuackButton
              type="button"
              className="w-full"
              state={busy ? "loading" : "idle"}
              loadingLabel="Redirecting…"
              disabled={!configured}
              onClick={() => void google()}
            >
              Continue with Google
            </QuackButton>
            {!configured && (
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Sign-in isn't configured on this deployment.
              </p>
            )}
            {/* One provider, one verdict: this failure belongs to the card rather than to any
                field, so it stays in the card — never in a toast. */}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </>
        )}

        <HoloSeparator label="or" />

        {/* No account needed and no request made: this only flips a client-side state. */}
        <QuackButton type="button" variant="outline" className="w-full" onClick={onGuest}>
          Continue as a guest
        </QuackButton>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Browse the published designs and edit them freely. Nothing a guest changes is saved.
        </p>
      </StickerCard>
    </div>
  );
}
