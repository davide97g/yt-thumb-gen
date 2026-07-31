import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { type ApiToken, createToken, deleteToken, listTokens } from "../lib/storage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-GB") : "never");

/** Settings › API tokens. Manages personal API tokens — the credential the MCP server uses
 *  to design from an agent. The plaintext token exists only in this panel, once, right
 *  after creation: the backend stores nothing but its hash. */
export function TokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      setCopied(false);
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

  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh).catch(() => {});
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-primary" /> API tokens
        </h3>
        <p className="text-sm text-muted-foreground">
          Use these to create projects from outside the editor — from the MCP server, for instance. A token is as
          powerful as your account: don't share it.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={name}
          placeholder="Token name (e.g. mcp-local)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <Button size="sm" onClick={() => void create()} disabled={busy || !name.trim()}>
          <Plus /> Create
        </Button>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <p className="text-xs text-muted-foreground">
            Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="readout min-w-0 flex-1 truncate rounded bg-background/60 px-2 py-1.5 text-xs">{fresh}</code>
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-1">
        {tokens === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{t.name}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  created {when(t.createdAt)} · used {when(t.lastUsedAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void remove(t.id)}
                disabled={busy}
                title="Revoke"
                aria-label={`Revoke ${t.name}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
