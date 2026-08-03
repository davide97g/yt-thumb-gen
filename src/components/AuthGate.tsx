// Authentication gate. Wraps the whole editor and decides which of three visitors is at the
// door before the app's mount/hydration/autosave effects are allowed to run:
//
//   • the owner, signed in — the editor exactly as it has always worked;
//   • a guest, who gets the same editor over a read-only session: they can open any published
//     design and push it around, but nothing they do reaches the backend;
//   • nobody yet — the login form.
//
// A guest has **no server-side identity**: no session row, no cookie, no token. Guest is a
// client state, which is why the server never has to tell a guest apart from a stranger with
// curl — they are the same caller, and neither can reach a route that writes.
//
// The gate is also where the two storage decisions are made, once, before the editor mounts:
// `setScope` picks which IndexedDB key namespace this visitor autosaves into (so a guest's
// canvas can never overwrite the owner's on a shared browser) and, with it, whether remote
// writes are permitted at all.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiSend } from "../lib/api";
import { clearWorking, setScope } from "../lib/storage";
import { DuckSpinner } from "./ui/duck-spinner";
import { GlowField, GlowInput } from "./ui/glow-input";
import { HoloSeparator } from "./ui/holo-separator";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerCard } from "./ui/sticker-card";

type User = { id: string; email: string };

/** Remembers that this browser chose to browse as a guest, so a reload doesn't dump them back
 *  on the login form — their local canvas is still there and would otherwise look lost. */
const GUEST_FLAG = "thumb-guest";

type AuthCtx = {
  /** Null in guest mode. Every consumer must handle that. */
  user: User | null;
  isGuest: boolean;
  /** The single question the UI should ask before showing anything that saves. */
  canWrite: boolean;
  logout: () => Promise<void>;
  /** Leave guest mode and go back to the login form. */
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
  const [status, setStatus] = useState<"loading" | "in" | "guest" | "out">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // A real session always wins over a remembered guest choice: the probe runs first, and the
    // stored flag is only consulted once it has failed.
    apiGet<User>("/auth/me")
      .then((u) => { enterOwner(u); })
      .catch(() => {
        if (localStorage.getItem(GUEST_FLAG) === "1") enterGuest();
        else setStatus("out");
      });
  }, []);

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
    await apiSend("POST", "/auth/logout").catch(() => {});
    await clearWorking("owner").catch(() => {}); // don't leak the previous user's canvas to the next login
    localStorage.removeItem(GUEST_FLAG);
    setScope("owner");
    setUser(null);
    setStatus("out");
  }

  if (status === "loading") {
    return (
      <div className="grid h-full place-items-center bg-background">
        <DuckSpinner label="Checking your session" />
      </div>
    );
  }
  if (status === "out") {
    return <AuthForm onAuthed={enterOwner} onGuest={enterGuest} />;
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

function AuthForm({ onAuthed, onGuest }: { onAuthed: (u: User) => void; onGuest: () => void }) {
  const [signupOpen, setSignupOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ signupOpen: boolean }>("/auth/status")
      .then(({ signupOpen }) => { setSignupOpen(signupOpen); if (signupOpen) setMode("register"); })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await apiSend<User>("POST", `/auth/${mode}`, { email: email.trim(), password });
      onAuthed(u);
    } catch (err: any) {
      setError(err?.message || "Error");
      setBusy(false);
    }
  }

  // The whole product's holo budget is spent here: the front door is the one screen
  // with a single object on it, so the iridescent ring has nothing to compete with.
  // Every other viewport in the editor is lime-only — see the note in styles.css.
  return (
    <div className="grid h-full place-items-center bg-background p-4">
      {/* asChild so the card *is* the form: one element, no wrapper between the
          sticker edge and the fields. */}
      <StickerCard holo asChild className="w-[min(380px,92vw)]">
        <form onSubmit={submit}>
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
              <span className="size-2.5 rounded-full bg-primary duck-glow-primary" />
            </span>
            <div className="leading-tight">
              <div className="font-display text-sm font-bold tracking-tight">Thumb Studio</div>
              <HudLabel size="sm" tracking="tight">
                {mode === "register" ? "Create account" : "Sign in"}
              </HudLabel>
            </div>
          </div>

          {/* `required` goes on the field, not the control: GlowField clones the child
              and passes its own `required` through, so setting it on the input would be
              overwritten with undefined. */}
          <GlowField label="Email" required>
            <GlowInput type="email" autoComplete="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
          </GlowField>
          <GlowField label="Password" required helper="At least 8 characters">
            <GlowInput
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
            />
          </GlowField>

          {/* One credential pair, one server verdict: this failure belongs to the form
              rather than to either field, so it stays in the form — never in a toast. */}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <QuackButton
            type="submit"
            className="w-full"
            state={busy ? "loading" : "idle"}
            loadingLabel="Please wait…"
          >
            {mode === "register" ? "Sign up" : "Sign in"}
          </QuackButton>

          {signupOpen && (
            <button
              type="button"
              className="text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => { setError(null); setMode((m) => (m === "login" ? "register" : "login")); }}
            >
              {mode === "login" ? "No account yet? Sign up" : "Already have an account? Sign in"}
            </button>
          )}

          <HoloSeparator label="or" />

          {/* No account needed and no request made: this only flips a client-side state. */}
          <QuackButton type="button" variant="outline" className="w-full" onClick={onGuest}>
            Continue as a guest
          </QuackButton>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Browse the published designs and edit them freely. Nothing a guest changes is saved.
          </p>
        </form>
      </StickerCard>
    </div>
  );
}
