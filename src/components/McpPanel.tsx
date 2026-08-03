import { useEffect, useMemo, useState } from "react";
import { Plug, Plus, TriangleAlert } from "lucide-react";
import { type ApiToken, createToken, listTokens } from "../lib/storage";
import { CodeSnippet } from "./ui/code-snippet";
import { GlowField, GlowInput } from "./ui/glow-input";
import { HudCode } from "./ui/hud-code";
import { QuackButton } from "./ui/quack-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Provider = {
  id: string;
  label: string;
  /** What the user does with the snippet: run it, or paste it into a file. */
  kind: "command" | "file";
  /** CodeSnippet's highlighter language. TOML has no lexer there, so it reads as text. */
  lang: "bash" | "json" | "text";
  hint: string;
  snippet: (url: string, token: string) => string;
};

const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

// Every provider gets the same two facts — the endpoint and a bearer token — in whatever
// shape it expects. No provider needs the repo, a runtime, or an install.
const PROVIDERS: Provider[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "command",
    lang: "bash",
    hint: "Run this command in your terminal.",
    snippet: (url, token) =>
      `claude mcp add --transport http thumb-studio ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex CLI",
    kind: "file",
    lang: "text",
    hint: "Add to ~/.codex/config.toml",
    snippet: (url, token) =>
      `[mcp_servers.thumb-studio]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "file",
    lang: "json",
    hint: "Add to .cursor/mcp.json (or ~/.cursor/mcp.json)",
    snippet: (url, token) =>
      JSON.stringify(
        { mcpServers: { "thumb-studio": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2
      ),
  },
  {
    id: "json",
    label: "Other (JSON)",
    kind: "file",
    lang: "json",
    hint: "Standard format: VS Code, Windsurf, Zed and any MCP client.",
    snippet: (url, token) =>
      JSON.stringify(
        { mcpServers: { "thumb-studio": { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2
      ),
  },
];

/** Settings › MCP: hands out the hosted endpoint plus a token, in the shape each client
 *  expects. The endpoint is remote, so nothing here requires a checkout or an install. */
export function McpPanel() {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState("mcp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `${window.location.origin}/api/mcp`;

  useEffect(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError("Couldn't read the tokens."));
  }, []);

  const active = PROVIDERS.find((p) => p.id === provider)!;
  const snippet = useMemo(() => active.snippet(url, fresh ?? TOKEN_PLACEHOLDER), [active, url, fresh]);

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createToken(name.trim() || "mcp");
      setFresh(made.token);
      setTokens(await listTokens());
    } catch {
      setError("Couldn't create the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold">
          <Plug className="size-4 text-primary" /> Add Thumb Studio to your agent
        </h3>
        <p className="text-sm text-muted-foreground">
          Connect Claude, Codex or any MCP client to this account and it can create projects and campaigns for
          you. Nothing to install — the endpoint is already online.
        </p>
      </div>

      <GlowField label="Client">
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlowField>

      {!fresh && (
        <div className="sticker space-y-2 rounded-xl border-border bg-secondary/30 p-3">
          <p className="text-xs text-muted-foreground">
            You need a token. Create one now and it lands pre-filled in the snippet below.
          </p>
          <div className="flex gap-2">
            <GlowInput
              className="h-8"
              value={name}
              aria-label="Token name"
              placeholder="Token name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void mint(); }
              }}
            />
            <QuackButton size="sm" state={busy ? "loading" : "idle"} loadingLabel="Creating…" onClick={() => void mint()}>
              <Plus /> Create token
            </QuackButton>
          </div>
          {tokens && tokens.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              You already have {tokens.length} token(s), but the value is only shown at creation — if you lost it, create a new one.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {/* `wrap` rather than scroll: the one-line commands carry a 64-char token, and a
            snippet you can't read in full is hard to trust before pasting it. The copy
            button is CodeSnippet's, and it never claims success on a rejected write —
            clipboard access is denied over plain HTTP and in some embedded browsers, and a
            false "Copied" costs the user a silently empty paste. */}
        <CodeSnippet
          code={snippet}
          lang={active.lang}
          title={active.hint}
          wrap
          copyable
          chrome="plain"
        />
        {!fresh && (
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-primary" />
            Replace <HudCode>{TOKEN_PLACEHOLDER}</HudCode> with a valid token, or create one above to
            have it filled in automatically.
          </p>
        )}
        {fresh && (
          <p className="text-[11px] text-muted-foreground">
            The token is embedded in the snippet and won't be shown again — copy it now. It is as powerful as your account.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
