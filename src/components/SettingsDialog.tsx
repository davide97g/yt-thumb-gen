// Settings modal — the one place for everything that isn't the design itself: the MCP
// connection, API tokens, and the current session. Each section is its own panel
// component; this file is only the shell (backdrop, tab rail, scrolling body).

import { useEffect, useMemo, useState } from "react";
import { KeyRound, LogIn, LogOut, Plug, UserRound, X } from "lucide-react";
import { useAuth } from "./AuthGate";
import { McpPanel } from "./McpPanel";
import { TokensPanel } from "./TokensPanel";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type Props = { onClose: () => void };

type TabId = "mcp" | "tokens" | "session";

const TABS: { id: TabId; label: string; icon: typeof Plug }[] = [
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "tokens", label: "API tokens", icon: KeyRound },
  { id: "session", label: "Session", icon: UserRound },
];

export function SettingsDialog({ onClose }: Props) {
  const { canWrite } = useAuth();
  // MCP and API tokens are both about handing an agent write access to an account. A guest has
  // no account, so the tabs would have nothing to show and their one button would throw.
  const tabs = useMemo(() => (canWrite ? TABS : TABS.filter((t) => t.id === "session")), [canWrite]);
  const [tab, setTab] = useState<TabId>(canWrite ? "mcp" : "session");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-md"
      onPointerDown={onClose}
    >
      <div
        className="anim-panel flex max-h-[86vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:flex-row"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* Tab rail: a column on desktop, a scrollable strip above the body on mobile. */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 bg-secondary/20 p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
          <div className="hidden px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
            Settings
          </div>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                tab === id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
              aria-current={tab === id}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end p-2 pb-0">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {tab === "mcp" && canWrite && <McpPanel />}
            {tab === "tokens" && canWrite && <TokensPanel />}
            {tab === "session" && <SessionPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Current session: who you are, and the way out. Logout also wipes the local working
 *  canvas (see `AuthGate`), so it's the one action here that discards state.
 *
 *  A guest has no account, so `user` is null here — the panel explains the read-only session
 *  and offers the way into a real one instead of an email and a sign-out. */
function SessionPanel() {
  const { user, logout, signIn } = useAuth();

  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <UserRound className="size-4 text-primary" /> Guest session
          </h3>
          <p className="text-sm text-muted-foreground">
            You're browsing without an account. Everything on the canvas is yours to change, and it stays
            in this browser — nothing is saved to the archive, and the export buttons still work.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Signing in keeps whatever you have open here only if you export it first.
          </p>
          <Button variant="outline" size="sm" onClick={signIn}>
            <LogIn /> Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <UserRound className="size-4 text-primary" /> Session
        </h3>
        <p className="text-sm text-muted-foreground">The account currently signed in on this browser.</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
        <Row label="Email" value={user.email} />
        <Row label="ID" value={user.id} />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Signing out clears the local working canvas — save the project first if you want it back.
        </p>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut /> Sign out
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="readout min-w-0 flex-1 truncate text-xs" title={value}>
        {value}
      </span>
    </div>
  );
}
