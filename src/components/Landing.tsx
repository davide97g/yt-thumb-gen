// The front door — the page a stranger lands on before the editor exists for them.
//
// It is a **separate Vite entry** (welcome.html → src/welcome.tsx), not a route inside the
// editor, for the same reason render.html is: a marketing page has no business booting the
// auth gate, IndexedDB, the service worker, twenty display faces or a WebGL canvas. The whole
// page is text, hairlines and one mock plate, so it ships as its own small bundle and links to
// "/" like any other site would.
//
// The design thesis is the product's own: **a thumbnail here is a document**. So the hero is
// the document beside the picture it paints, sharing one spine — the layer index, which is
// paint order and therefore real information rather than decoration. Everything the page
// claims is a fact taken from the code it sits next to (FORMATS, GRID_W, SAFE_ZONES, the layer
// union, the MCP tool list), because a landing page that overstates a tool is found out on the
// first click.
//
// Type: Anton for display — the face the product's own thumbnails scream in, so the page looks
// like the thing it makes — Geist for prose, Geist Mono for every readout. The holo budget
// (one iridescent element per viewport) is spent on one word in the headline and on the closing
// card; the lime stays what it is in the editor, the colour of the one action worth taking.

import { ArrowRight, Camera, Image as ImageIcon, PenLine, Scissors, Smile, Square, Stars, Type, User, Waves } from "lucide-react";
import { cn } from "../lib/utils";
import { GRID_W, SAFE_ZONES } from "../lib/safeAreas";
import { FORMATS, type FormatKey } from "../state";
import { CodeSnippet } from "./ui/code-snippet";
import { HoloBadge } from "./ui/holo-badge";
import { HoloSeparator } from "./ui/holo-separator";
import { HudCode } from "./ui/hud-code";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerCard } from "./ui/sticker-card";
import { StickerKbd } from "./ui/sticker-kbd";

/** Where the editor lives. Same origin, so a plain link is the whole navigation story. */
const APP = "/";

const NAV = [
  { href: "#compose", label: "Compose" },
  { href: "#review", label: "Review" },
  { href: "#ship", label: "Ship" },
  { href: "#agents", label: "Agents" },
  { href: "#keep", label: "Keep" },
];

/** The seven layer types, in the order the union declares them. */
const LAYER_TYPES: { type: string; icon: typeof Type; blurb: string }[] = [
  { type: "text", icon: Type, blurb: "Headlines, badges and pills. Stroke, shadow, gradient fill, twenty display faces." },
  { type: "image", icon: ImageIcon, blurb: "An upload, a webcam frame or a brand mark. Gradient ring, cut-out glow that follows the alpha." },
  { type: "emoji", icon: Smile, blurb: "One glyph, any size, any angle." },
  { type: "shape", icon: Square, blurb: "Rectangle, pill, or the fake watched-progress bar designs lean into." },
  { type: "effect", icon: Waves, blurb: "A live background: grainient, aurora, mesh, dots — the first two are shaders." },
  { type: "draw", icon: PenLine, blurb: "Freehand strokes, smoothed, resizable after the fact." },
  { type: "emojifx", icon: Stars, blurb: "A field of emoji scattered around a cut-out, laid out from its real centre." },
];

/** The hero document — the editor's default seed, layer for layer. */
const DOC_ROWS: { type: string; detail: string }[] = [
  { type: "text", detail: '"$ dacoder" · mono 30' },
  { type: "text", detail: '"CODING" · anton 138 · stroke' },
  { type: "text", detail: '"DAL VIVO" · anton 138 · #3ddc84' },
  { type: "emoji", detail: "👨‍💻 · 140 · 10°" },
  { type: "image", detail: "me · ring, glow" },
  { type: "text", detail: "pill · @dacoder · iscriviti" },
  { type: "shape", detail: "bar · 64% · #3ddc84" },
];

/** What the readability check actually looks for. Pure function, unit-tested in the repo. */
const CHECKS = [
  { verdict: "fail", text: "Text below the size it needs at grid width" },
  { verdict: "fail", text: "Contrast under 3:1 against the pill or background behind it" },
  { verdict: "warn", text: "A layer sitting under the platform's own chrome, or outside the crop" },
  { verdict: "warn", text: "More words than a glance spends" },
  { verdict: "pass", text: "Everything else — said plainly, per layer, never in a toast" },
] as const;

/** Every tool the MCP server publishes, grouped the way an agent meets them. */
const TOOLS: { group: string; names: string[] }[] = [
  { group: "Learn the format", names: ["get_design_reference", "get_doc_schema", "list_templates", "get_template", "new_layer"] },
  { group: "Bring material", names: ["upload_image", "list_starred_elements", "get_starred_element", "add_starred_element"] },
  { group: "Write projects", names: ["list_projects", "get_project", "create_project", "update_project", "delete_project", "project_url"] },
  { group: "See the result", names: ["render_project"] },
  { group: "Run a campaign", names: ["list_campaigns", "get_campaign", "create_campaign", "rename_campaign", "delete_campaign", "set_project_campaign", "generate_campaign_set"] },
];

/** Lines are kept short on purpose: a snippet that has to scroll sideways to show its own
 *  point is a snippet nobody reads. */
const DOC_JSON = `{
  "format": "youtube",
  "background": { "mode": "gradient",
    "from": "#0d1b13", "to": "#04070a" },
  "layers": [
    { "type": "text", "text": "CODING", "x": 64,
      "y": 150, "size": 138, "stroke": true },
    { "type": "text", "text": "DAL VIVO", "x": 64,
      "y": 300, "size": 138, "color": "#3ddc84" },
    { "type": "shape", "kind": "bar", "fill": "#3ddc84" }
  ]
}`;

export function Landing() {
  return (
    <div className="lp min-h-dvh bg-background text-foreground antialiased">
      <a href="#main" className="lp-skip">Skip to content</a>
      <TopBar />
      <main id="main">
        <Hero />
        <Formats />
        <Compose />
        <Review />
        <Ship />
        <Agents />
        <Keep />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- chrome --- */

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
        <span className="size-2.5 rounded-full bg-primary duck-glow-primary" />
      </span>
      <span className="font-display text-sm font-bold tracking-tight">Thumb Studio</span>
    </span>
  );
}

function TopBar() {
  return (
    <header className="lp-bar">
      <div className="lp-wrap flex h-14 items-center justify-between gap-6">
        <a href={APP} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Wordmark />
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="lp-navlink">
              {n.label}
            </a>
          ))}
        </nav>
        <QuackButton asChild size="sm" ripple={false}>
          <a href={APP}>Open the editor</a>
        </QuackButton>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero --- */

function Hero() {
  return (
    <section className="lp-section lp-hero">
      <div className="lp-wrap grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20">
        <div>
          <HudLabel tone="primary" dot>
            Thumbnails · covers · posts
          </HudLabel>
          <h1 className="lp-display lp-h1 mt-6">
            Your thumbnail is a <span className="holo-text">document</span>.
          </h1>
          <p className="lp-lede mt-6 max-w-[46ch]">
            A flat, ordered array of layers with coordinates in 1280×720 space. You push them
            around on a canvas. An agent writes the same JSON over MCP. Both get the same
            picture out, because there is only one renderer.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <QuackButton asChild size="lg">
              <a href={APP}>
                Open the editor <ArrowRight />
              </a>
            </QuackButton>
            <QuackButton asChild variant="outline" size="lg">
              <a href="#agents">See the agent surface</a>
            </QuackButton>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Nothing to install. Guests can open the published designs, edit them and export —
            without an account.
          </p>
        </div>

        {/* The instrument: the picture, and the document that is the picture. One index
            column runs down both — array order is paint order, so the numbers are data. */}
        {/* min-w-0: a grid track sizes to its content unless told otherwise, and the rail
            holds monospace rows that do not wrap. Without it the page scrolls sideways. */}
        <div className="lp-instrument min-w-0">
          <Plate />
          <div className="lp-doc">
            <div className="flex items-center justify-between px-1 pb-2">
              <HudLabel tracking="tight">layers[7] · paint order</HudLabel>
              <HudLabel tracking="tight" tone="accent">
                index 0 = back
              </HudLabel>
            </div>
            <ol className="lp-doc-rows">
              {DOC_ROWS.map((row, i) => (
                <li key={row.detail} className="lp-doc-row lp-assemble" style={{ ["--i" as string]: i }}>
                  <span className="lp-doc-idx">{String(i).padStart(2, "0")}</span>
                  <span className="lp-doc-type">{row.type}</span>
                  <span className="lp-doc-detail">{row.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A stand-in for the canvas, not the canvas: importing ThumbCanvas would drag WebGL, the
 * export path and the whole layer inspector into a page that only needs to show what a
 * document looks like once it is painted. Every plate here is positioned in percentages and
 * sized in `cqw`, so one set of rules survives any width — the same trick the loading cover
 * uses. Layers rise in paint order, once, and reduced motion gets the finished picture.
 */
function Plate() {
  return (
    <figure className="lp-plate-wrap">
      <div className="lp-plate" role="img" aria-label="A composed YouTube thumbnail: the words CODING DAL VIVO over a dark gradient, with a face slot, an emoji and a subscribe pill.">
        <span className="lp-l lp-assemble lp-mono-30" style={{ ["--i" as string]: 0 }}>$ dacoder</span>
        <span className="lp-l lp-assemble lp-shout" style={{ ["--i" as string]: 1 }}>CODING</span>
        <span className="lp-l lp-assemble lp-shout lp-shout-lime" style={{ ["--i" as string]: 2 }}>DAL VIVO</span>
        <span className="lp-l lp-assemble lp-emoji" style={{ ["--i" as string]: 3 }} aria-hidden>👨‍💻</span>
        <span className="lp-l lp-assemble lp-face" style={{ ["--i" as string]: 4 }} aria-hidden>
          <User strokeWidth={1.25} />
        </span>
        <span className="lp-l lp-assemble lp-pill" style={{ ["--i" as string]: 5 }}>▶ @dacoder · iscriviti</span>
        <span className="lp-l lp-assemble lp-progress" style={{ ["--i" as string]: 6 }} aria-hidden />
        {/* What YouTube paints on top, at the fractions the editor's overlay uses. */}
        <span className="lp-zone lp-zone-duration" aria-hidden>
          <span>Duration</span>
        </span>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <HudLabel tracking="tight">youtube · 1280 × 720</HudLabel>
        <HudLabel tracking="tight" tone="accent">
          browsed at {GRID_W.youtube}px
        </HudLabel>
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------- formats --- */

const FORMAT_ORDER: FormatKey[] = ["youtube", "shorts", "ig-post", "ig-reel", "linkedin"];

function Formats() {
  return (
    <section className="lp-section lp-section-tight border-y border-border/60 bg-surface/40">
      <div className="lp-wrap">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <HudLabel tone="primary" dot>
            Five formats, real proportions
          </HudLabel>
          <p className="max-w-[52ch] text-sm text-muted-foreground">
            Each one carries its own size, its own platform chrome, and the width it is actually
            browsed at. Switching format re-lays the document out rather than stretching it.
          </p>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          {FORMAT_ORDER.map((key) => {
            const f = FORMATS[key];
            return (
              <li key={key} className="flex flex-col gap-3">
                <div className="flex flex-1 items-end">
                  <div className="lp-format" style={{ aspectRatio: `${f.w} / ${f.h}` }}>
                    {/* Straight from the table the editor's overlay reads, so the strip shows
                        what each platform takes rather than five empty boxes. */}
                    {SAFE_ZONES[key].map((z) => (
                      <span
                        key={z.id}
                        className={z.kind === "cover" ? "lp-fzone lp-fzone-cover" : "lp-fzone lp-fzone-keep"}
                        style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
                      />
                    ))}
                    <span className="lp-format-ratio">{f.aspect}</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">{f.platform}</div>
                  <HudLabel size="sm" tracking="tight" className="mt-1 block">
                    {f.w} × {f.h}
                  </HudLabel>
                  <HudLabel size="sm" tracking="tight" tone="accent" className="mt-0.5 block">
                    seen at {GRID_W[key]}px
                  </HudLabel>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="lp-key lp-key-cover" aria-hidden /> painted over by the platform
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="lp-key lp-key-keep" aria-hidden /> all that survives the crop
          </span>
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- sections --- */

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("lp-section", className)}>
      <div className="lp-wrap">
        <header className="max-w-[62ch]">
          <HudLabel tone="primary" dot>
            {eyebrow}
          </HudLabel>
          <h2 className="lp-display lp-h2 mt-5">{title}</h2>
          <p className="lp-lede mt-5">{lede}</p>
        </header>
        {children}
      </div>
    </section>
  );
}

function Compose() {
  return (
    <Section
      id="compose"
      eyebrow="Compose"
      title="Seven layer types. One flat stack."
      lede="No nesting and no groups to fight. Array order is paint order, and every layer holds its own x and y, so moving one never moves another. Drag, resize and rotate on the canvas; the sliders and the frame always agree."
    >
      <ul className="mt-12">
        {LAYER_TYPES.map(({ type, icon: Icon, blurb }, i) => (
          <li key={type} className="lp-row">
            <span className="lp-row-idx">{String(i).padStart(2, "0")}</span>
            <span className="lp-row-icon">
              <Icon strokeWidth={1.5} />
            </span>
            <span className="lp-row-type">{type}</span>
            <span className="lp-row-blurb">{blurb}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex flex-wrap gap-3">
        <HoloBadge variant="outline" shape="tag">
          <Scissors /> Background removal in the browser
        </HoloBadge>
        <HoloBadge variant="outline" shape="tag">
          <Camera /> Webcam capture
        </HoloBadge>
        <HoloBadge variant="outline" shape="tag">
          Undo 20 deep, one gesture per step
        </HoloBadge>
        <HoloBadge variant="outline" shape="tag">
          ⌘K command palette
        </HoloBadge>
      </div>
    </Section>
  );
}

function Review() {
  return (
    <Section
      id="review"
      eyebrow="Review"
      title={<>You edit at 40%. They see it at {GRID_W.youtube} pixels.</>}
      lede="Next to eleven other designs, with a duration pill over one corner. Three view-only tools close that gap — they never touch the document, and they are hidden from exports and previews."
      className="border-y border-border/60 bg-surface/40"
    >
      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div className="min-w-0">
          <ul className="space-y-5">
            <li className="flex gap-4">
              <StickerKbd watch="g">G</StickerKbd>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground">Actual size.</span> Sets the stage to the width
                the format is really browsed at, so "too small" is a fact rather than a zoom
                level.
              </p>
            </li>
            <li className="flex gap-4">
              <StickerKbd watch="a">A</StickerKbd>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground">Safe areas.</span> The boxes the platform paints
                over or crops away, per format. Deliberately approximate: the point is "nothing
                important here".
              </p>
            </li>
          </ul>
          <HoloSeparator className="my-8" />
          <p className="text-sm text-muted-foreground">
            The readability check measures the text the same way the canvas does — from the real
            DOM nodes, because how wide a run of type renders is a fact only the browser has.
          </p>
        </div>
        <StickerCard frame className="gap-0 p-0">
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
            <HudLabel tracking="tight" asChild>
              <h3>Readability</h3>
            </HudLabel>
            <HudLabel tracking="tight" tone="accent">
              at {GRID_W.youtube}px
            </HudLabel>
          </div>
          <ul className="divide-y divide-border/60">
            {CHECKS.map((c) => (
              <li key={c.text} className="flex items-start gap-3 px-5 py-3.5">
                <HudLabel
                  size="sm"
                  tracking="tight"
                  dot
                  dotTone={c.verdict === "pass" ? "primary" : c.verdict === "warn" ? "foreground" : "destructive"}
                  tone={c.verdict === "pass" ? "primary" : "muted"}
                  className="mt-0.5 w-14 shrink-0"
                >
                  {c.verdict}
                </HudLabel>
                <span className="text-sm text-muted-foreground">{c.text}</span>
              </li>
            ))}
          </ul>
        </StickerCard>
      </div>
    </Section>
  );
}

function Ship() {
  return (
    <Section
      id="ship"
      eyebrow="Ship"
      title="One document. Five uploads."
      lede="A campaign is one message across several platforms, so compose it once and adapt: each format becomes its own project, with its own safe areas and its own file."
    >
      <ul className="mt-12">
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">Campaign export</span>
          <span className="lp-row-blurb">
            Every design in the campaign is rendered offscreen and captured with the same code the
            Export button runs, then written into one ZIP. A design that fails is named in the
            summary instead of costing the other four.
          </span>
        </li>
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">The 2 MB wall</span>
          <span className="lp-row-blurb">
            YouTube rejects a PNG over 2 MB. Rather than saying so, the exporter walks a JPEG
            quality ladder from 0.92 down and ships the best one that fits — the fix is a file
            format, not a redesign. The extension stays honest.
          </span>
        </li>
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">Or take it with you</span>
          <span className="lp-row-blurb">
            Export a project as JSON and import it anywhere, including into a browser that has
            never signed in. The document format is the product; nothing here holds it hostage.
          </span>
        </li>
      </ul>
    </Section>
  );
}

function Agents() {
  return (
    <Section
      id="agents"
      eyebrow="Agents"
      title="The agent is a user, not a plugin."
      lede="The layer types are the source of truth, the JSON Schema is generated from them and served publicly, and the MCP server imports the editor's own factories — so an agent composes with the real thing and its mistakes are caught before a round trip."
      className="border-y border-border/60 bg-surface/40"
    >
      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
        {/* min-w-0 or the code block sets the track width from its longest line. */}
        <div className="min-w-0">
          <CodeSnippet
            code={DOC_JSON}
            lang="json"
            title="thumbdoc.json"
            chrome="plain"
            exportable={false}
            lineNumbers={false}
            className="w-full"
          />
          <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground">Hosted at <HudCode>/api/mcp</HudCode></span>, or over
              stdio locally. One implementation behind both, so the two can never drift.
            </li>
            <li>
              <span className="text-foreground">render_project returns a picture.</span> A headless
              Chromium loads the real canvas and screenshots it — the loop-closer for an agent that
              would otherwise compose blind and never learn that two layers overlap.
            </li>
            <li>
              <span className="text-foreground">Every project has a link.</span> Paste an editor URL
              into a tool, or a tool's answer into the address bar; both name the same design.
            </li>
          </ul>
        </div>
        <div className="min-w-0">
          {TOOLS.map((g, i) => (
            <div key={g.group} className={i === 0 ? "" : "mt-7"}>
              <HudLabel tracking="tight" asChild>
                <h3>{g.group}</h3>
              </HudLabel>
              <ul className="mt-3 flex flex-wrap gap-2">
                {g.names.map((n) => (
                  <li key={n} className="lp-tool">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Keep() {
  return (
    <Section
      id="keep"
      eyebrow="Keep"
      title="Nothing you saved is one save from gone."
      lede="Undo lives in memory and dies on reload, which used to make any edit that survived a refresh permanent — including an agent's. It isn't any more."
    >
      <ul className="mt-12">
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">Version history</span>
          <span className="lp-row-blurb">
            Every save files the outgoing document first, so the list reads as "put it back to
            here". Thirty per project. A rename spends nothing, and restoring is itself an edit —
            so undoing a restore is another restore.
          </span>
        </li>
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">An archive of pictures</span>
          <span className="lp-row-blurb">
            Each save captures its own preview, so two designs from one campaign stop being
            indistinguishable names in a list.
          </span>
        </li>
        <li className="lp-row lp-row-loose">
          <span className="lp-row-type lp-row-type-wide">A public gallery</span>
          <span className="lp-row-blurb">
            Publish a design and anyone can open it, edit it and export it. Guests hold a local
            copy and write nothing — not because the buttons are hidden, but because no route
            exists that would let them.
          </span>
        </li>
      </ul>
    </Section>
  );
}

function Closing() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <StickerCard holo className="items-center gap-6 px-6 py-14 text-center sm:px-14">
          <HudLabel tone="primary" dot>
            No account needed to look around
          </HudLabel>
          <h2 className="lp-display lp-h2 max-w-[24ch]">Open it and move something.</h2>
          <p className="lp-lede max-w-[52ch]">
            The editor starts on a real design. Drag a layer, press G to see it at the size
            everyone else will, and export a PNG — all of it before you decide whether to sign in.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <QuackButton asChild size="lg">
              <a href={APP}>
                Open the editor <ArrowRight />
              </a>
            </QuackButton>
            <QuackButton asChild variant="ghost" size="lg">
              <a href="/api/schema">Read the document schema</a>
            </QuackButton>
          </div>
        </StickerCard>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="lp-wrap flex flex-wrap items-center justify-between gap-4 py-8">
        <Wordmark />
        <HudLabel size="sm" tracking="tight">
          v{__APP_VERSION__} · {__APP_COMMIT__} · MIT
        </HudLabel>
      </div>
    </footer>
  );
}
