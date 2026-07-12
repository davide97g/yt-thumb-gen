// Authentication gate. Wraps the whole editor: until the visitor is logged in, the app's
// mount/hydration/autosave effects never run — only a login/registration form shows. Once
// authenticated it renders `children` (the editor) and exposes `useAuth()` for logout + the
// current user's email.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiSend } from "../lib/api";
import { clearWorking } from "../lib/storage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type User = { id: string; email: string };

type AuthCtx = { user: User; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx | null>(null);

/** Access the logged-in user + logout. Only valid inside the authenticated subtree. */
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    apiGet<User>("/auth/me")
      .then((u) => { setUser(u); setStatus("in"); })
      .catch(() => setStatus("out"));
  }, []);

  async function logout() {
    await apiSend("POST", "/auth/logout").catch(() => {});
    await clearWorking().catch(() => {}); // don't leak the previous user's canvas to the next login
    setUser(null);
    setStatus("out");
  }

  if (status === "loading") {
    return <div className="grid h-full place-items-center bg-background text-sm text-muted-foreground">Caricamento…</div>;
  }
  if (status === "out" || !user) {
    return <AuthForm onAuthed={(u) => { setUser(u); setStatus("in"); }} />;
  }
  return <Ctx.Provider value={{ user, logout }}>{children}</Ctx.Provider>;
}

function AuthForm({ onAuthed }: { onAuthed: (u: User) => void }) {
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
      setError(err?.message || "Errore");
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-background p-4">
      <form onSubmit={submit} className="flex w-[min(380px,92vw)] flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
            <span className="size-2.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Thumb Studio</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {mode === "register" ? "Crea account" : "Accedi"}
            </div>
          </div>
        </div>

        <label className="space-y-1.5">
          <span className="text-sm text-muted-foreground">Email</span>
          <Input type="email" autoComplete="email" value={email} autoFocus required onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm text-muted-foreground">Password</span>
          <Input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            required
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" className="w-full justify-center" disabled={busy}>
          {busy ? "Attendere…" : mode === "register" ? "Registrati" : "Accedi"}
        </Button>

        {signupOpen && (
          <button
            type="button"
            className="text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setError(null); setMode((m) => (m === "login" ? "register" : "login")); }}
          >
            {mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
          </button>
        )}
      </form>
    </div>
  );
}
