// Settings modal — the one place for everything that isn't the design itself: the MCP
// connection, API tokens, and the current session. Each section is its own panel
// component; this file is only the shell (dialog, tab strip, scrolling body).
//
// The tab rail used to be a column on the left, hand-rolled from `aria-current` buttons.
// It is duck's DuckTabs now, which brings the real tabs keyboard pattern (arrows, Home,
// End) and the sliding lime pill — and that pill measures offsetLeft/offsetWidth, so the
// strip runs across the top rather than down the side. Three tabs fit either way.

import { useMemo, useState } from "react";
import { KeyRound, LogIn, LogOut, Plug, UserRound } from "lucide-react";
import { useAuth } from "./AuthGate";
import { McpPanel } from "./McpPanel";
import { TokensPanel } from "./TokensPanel";
import { DuckTabs, DuckTabsContent, DuckTabsList, DuckTabsTrigger } from "./ui/duck-tabs";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogHeader,
  StickerDialogTitle,
} from "./ui/sticker-dialog";

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

  // Escape, the focus trap and the scroll lock are Radix's now — the window keydown
  // listener this component carried did only the first of the three.
  return (
    <StickerDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <StickerDialogContent
        size="lg"
        className="max-h-[86vh] w-[min(720px,94vw)] max-w-none gap-0 overflow-hidden p-0"
        aria-label="Settings"
      >
        {/* One DuckTabs around both halves: the strip in the header and the scroller under
            it share a context, which is what wires each panel to its own tab. */}
        <DuckTabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="min-h-0 flex-1 gap-0">
          <StickerDialogHeader className="shrink-0 border-b border-border px-5 py-4">
            <StickerDialogTitle className="sr-only">Settings</StickerDialogTitle>
            <HudLabel size="sm" tracking="tight">Settings</HudLabel>
            <DuckTabsList aria-label="Settings sections" className="mt-2">
              {tabs.map(({ id, label, icon: Icon }) => (
                <DuckTabsTrigger key={id} value={id} className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0" />
                  {label}
                </DuckTabsTrigger>
              ))}
            </DuckTabsList>
          </StickerDialogHeader>

          {/* One scroller under the strip. The panels are separate components, so each tab's
              body is its own DuckTabsContent rather than a conditional inside one. */}
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {canWrite && (
              <>
                <DuckTabsContent value="mcp"><McpPanel /></DuckTabsContent>
                <DuckTabsContent value="tokens"><TokensPanel /></DuckTabsContent>
              </>
            )}
            <DuckTabsContent value="session"><SessionPanel /></DuckTabsContent>
          </div>
        </DuckTabs>
      </StickerDialogContent>
    </StickerDialog>
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
          <h3 className="flex items-center gap-2 font-display text-sm font-bold">
            <UserRound className="size-4 text-primary" /> Guest session
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You're browsing without an account. Everything on the canvas is yours to change, and it stays
            in this browser — nothing is saved to the archive, and the export buttons still work.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Signing in keeps whatever you have open here only if you export it first.
          </p>
          <QuackButton variant="outline" size="sm" onClick={signIn}>
            <LogIn /> Sign in
          </QuackButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold">
          <UserRound className="size-4 text-primary" /> Session
        </h3>
        <p className="text-sm text-muted-foreground">The account currently signed in on this browser.</p>
      </div>

      <div className="sticker space-y-2 rounded-xl border-border bg-secondary/30 p-3">
        <Row label="Email" value={user.email} />
        <Row label="ID" value={user.id} />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Signing out clears the local working canvas — save the project first if you want it back.
        </p>
        <QuackButton variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut /> Sign out
        </QuackButton>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <HudLabel size="sm" tracking="tight" className="w-12 shrink-0">
        {label}
      </HudLabel>
      <span className="readout min-w-0 flex-1 truncate text-xs" title={value}>
        {value}
      </span>
    </div>
  );
}
