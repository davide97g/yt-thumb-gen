import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Plug, Plus, TriangleAlert } from "lucide-react";
import { type ApiToken, createToken, listTokens } from "../lib/storage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Provider = {
  id: string;
  label: string;
  /** What the user does with the snippet: run it, or paste it into a file. */
  kind: "command" | "file";
  hint: string;
  snippet: (url: string, token: string) => string;
};

const TOKEN_PLACEHOLDER = "IL_TUO_TOKEN";

// Every provider gets the same two facts — the endpoint and a bearer token — in whatever
// shape it expects. No provider needs the repo, a runtime, or an install.
const PROVIDERS: Provider[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "command",
    hint: "Esegui il comando nel terminale.",
    snippet: (url, token) =>
      `claude mcp add --transport http thumb-studio ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex CLI",
    kind: "file",
    hint: "Aggiungi a ~/.codex/config.toml",
    snippet: (url, token) =>
      `[mcp_servers.thumb-studio]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "file",
    hint: "Aggiungi a .cursor/mcp.json (o ~/.cursor/mcp.json)",
    snippet: (url, token) =>
      JSON.stringify(
        { mcpServers: { "thumb-studio": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2
      ),
  },
  {
    id: "json",
    label: "Altro (JSON)",
    kind: "file",
    hint: "Formato standard: VS Code, Windsurf, Zed e qualsiasi client MCP.",
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
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `${window.location.origin}/api/mcp`;

  useEffect(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError("Impossibile leggere i token."));
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
      setCopied(false);
      setTokens(await listTokens());
    } catch {
      setError("Creazione token non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    // Only claim success if the write actually happened — clipboard access is denied over
    // plain HTTP and in some embedded browsers, and a false "Copiato" costs the user a
    // silently empty paste.
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setError(null);
    } catch {
      setCopied(false);
      setError("Copia non riuscita: seleziona il testo e copialo a mano.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="size-4 text-primary" /> Aggiungi Thumb Studio al tuo agente
        </h3>
        <p className="text-sm text-muted-foreground">
          Collega Claude, Codex o qualsiasi client MCP a questo account: potrà creare progetti e campagne al posto
          tuo. Niente da installare — l’endpoint è già online.
        </p>
      </div>

      <label className="space-y-1.5">
        <span className="text-sm text-muted-foreground">Client</span>
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
      </label>

      {!fresh && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
          <p className="text-xs text-muted-foreground">
            Serve un token. Creane uno adesso: comparirà già inserito nello snippet qui sotto.
          </p>
          <div className="flex gap-2">
            <Input
              className="h-8"
              value={name}
              placeholder="Nome del token"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void mint(); }
              }}
            />
            <Button size="sm" className="h-8" onClick={() => void mint()} disabled={busy}>
              <Plus /> Crea token
            </Button>
          </div>
          {tokens && tokens.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Hai già {tokens.length} token, ma il valore si vede solo alla creazione: se l’hai perso, creane uno nuovo.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{active.hint}</span>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? "Copiato" : "Copia"}
          </Button>
        </div>
        {/* Wrap rather than scroll: the one-line commands carry a 64-char token, and a
            snippet you can't read in full is hard to trust before pasting it. */}
        <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed">
          {snippet}
        </pre>
        {!fresh && (
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-primary" />
            Sostituisci <code className="font-mono">{TOKEN_PLACEHOLDER}</code> con un token valido, oppure creane uno
            qui sopra per inserirlo automaticamente.
          </p>
        )}
        {fresh && (
          <p className="text-[11px] text-muted-foreground">
            Il token è incluso nello snippet e non verrà più mostrato: copialo adesso. Vale quanto il tuo account.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
