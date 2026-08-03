import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { type ApiToken, createToken, deleteToken, listTokens } from "../lib/storage";
import { CopyButton } from "./ui/copy-button";
import { DuckSpinner } from "./ui/duck-spinner";
import { EmptyPond } from "./ui/empty-pond";
import { GlowInput } from "./ui/glow-input";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerTooltip } from "./ui/sticker-tooltip";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-GB") : "never");

/** Settings › API tokens. Manages personal API tokens — the credential the MCP server uses
 *  to design from an agent. The plaintext token exists only in this panel, once, right
 *  after creation: the backend stores nothing but its hash. */
export function TokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError("Couldn't load the tokens."));
  }, []);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createToken(name.trim());
      setFresh(made.token);
      setName("");
      setTokens(await listTokens());
    } catch {
      setError("Couldn't create the token.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteToken(id);
      setTokens(await listTokens());
      setFresh(null);
    } catch {
      setError("Couldn't revoke the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold">
          <KeyRound className="size-4 text-primary" /> API tokens
        </h3>
        <p className="text-sm text-muted-foreground">
          Use these to create projects from outside the editor — from the MCP server, for instance. A token is as
          powerful as your account: don't share it.
        </p>
      </div>

      <div className="flex gap-2">
        <GlowInput
          value={name}
          aria-label="Token name"
          placeholder="Token name (e.g. mcp-local)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <QuackButton
          size="sm"
          state={busy ? "loading" : "idle"}
          loadingLabel="Creating…"
          disabled={!name.trim()}
          onClick={() => void create()}
        >
          <Plus /> Create
        </QuackButton>
      </div>

      {fresh && (
        <div className="sticker space-y-2 rounded-xl border-primary/40 bg-primary/10 p-3">
          <p className="text-xs text-muted-foreground">
            Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="readout min-w-0 flex-1 truncate rounded-md bg-background/60 px-2 py-1.5 text-xs">{fresh}</code>
            {/* duck's CopyButton: it owns the copied state and, crucially, does not claim
                success when the clipboard write is refused. */}
            <CopyButton value={fresh} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-1">
        {tokens === null ? (
          <div className="grid place-items-center py-4">
            <DuckSpinner size="sm" label="Reading your tokens" />
          </div>
        ) : tokens.length === 0 ? (
          <EmptyPond compact title="No tokens yet" hint="Create one above to let an agent design for you." />
        ) : (
          tokens.map((t) => (
            <div key={t.id} className="sticker flex items-center gap-2 rounded-xl border-border px-3 py-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{t.name}</div>
                <HudLabel size="sm" tracking="tight" className="block truncate">
                  created {when(t.createdAt)} · used {when(t.lastUsedAt)}
                </HudLabel>
              </div>
              <StickerTooltip content="Revoke" delay={400}>
                <QuackButton
                  variant="ghost"
                  size="icon"
                  ripple={false}
                  className="size-7 rounded-md text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                  onClick={() => void remove(t.id)}
                  disabled={busy}
                  aria-label={`Revoke ${t.name}`}
                >
                  <Trash2 />
                </QuackButton>
              </StickerTooltip>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
