"use client";

import * as React from "react";
import {
  ChevronsDownUp,
  Clipboard,
  ImageDown,
  WrapText,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";
import {
  codeSnippetSchemes,
  detectLanguage,
  getCodeScheme,
  languageLabels,
  tokenizeCode,
  type CodeLanguage,
  type CodeLine,
  type CodePalette,
  type CodeScheme,
  type CodeSchemeName,
  type TokenKind,
} from "@/components/ui/code-highlight";

/**
 * CodeSnippet — a code block that highlights itself, wears one of six color
 * schemes, and exports itself as a PNG.
 *
 * The highlighter is local (see code-highlight.ts), so there is no async theme
 * load and no flash of unstyled code. Both palettes of a scheme are written to
 * the element as CSS variables and the active one is picked by the `dark`
 * variant, which means the server render is already correct in either mode and
 * the PNG can read the resolved colors straight back out of the DOM.
 *
 * Syntax colors are the one place duck/ui uses raw values instead of semantic
 * tokens — a syntax palette is data, like a Shiki theme. The frame, the header
 * and every control around the code stay on the theme.
 */

/* ================================================================
   Palette plumbing

   Each scheme writes `--cs-<key>-light` and `--cs-<key>-dark` through
   the style attribute; the static pairs below collapse those into
   `--cs-<key>` for whichever mode is live. Static because Tailwind has
   to see every class it generates — never build these strings.
   ================================================================ */

const PALETTE_VARS = [
  "[--cs-bg:var(--cs-bg-light)] dark:[--cs-bg:var(--cs-bg-dark)]",
  "[--cs-fg:var(--cs-fg-light)] dark:[--cs-fg:var(--cs-fg-dark)]",
  "[--cs-muted:var(--cs-muted-light)] dark:[--cs-muted:var(--cs-muted-dark)]",
  "[--cs-band:var(--cs-band-light)] dark:[--cs-band:var(--cs-band-dark)]",
  "[--cs-accent:var(--cs-accent-light)] dark:[--cs-accent:var(--cs-accent-dark)]",
  "[--cs-comment:var(--cs-comment-light)] dark:[--cs-comment:var(--cs-comment-dark)]",
  "[--cs-string:var(--cs-string-light)] dark:[--cs-string:var(--cs-string-dark)]",
  "[--cs-number:var(--cs-number-light)] dark:[--cs-number:var(--cs-number-dark)]",
  "[--cs-keyword:var(--cs-keyword-light)] dark:[--cs-keyword:var(--cs-keyword-dark)]",
  "[--cs-fn:var(--cs-fn-light)] dark:[--cs-fn:var(--cs-fn-dark)]",
  "[--cs-type:var(--cs-type-light)] dark:[--cs-type:var(--cs-type-dark)]",
  "[--cs-attribute:var(--cs-attribute-light)] dark:[--cs-attribute:var(--cs-attribute-dark)]",
  "[--cs-tag:var(--cs-tag-light)] dark:[--cs-tag:var(--cs-tag-dark)]",
  "[--cs-insert:var(--cs-insert-light)] dark:[--cs-insert:var(--cs-insert-dark)]",
  "[--cs-delete:var(--cs-delete-light)] dark:[--cs-delete:var(--cs-delete-dark)]",
].join(" ");

function schemeVars(scheme: CodeScheme) {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(scheme.light)) vars[`--cs-${key}-light`] = value;
  for (const [key, value] of Object.entries(scheme.dark)) vars[`--cs-${key}-dark`] = value;
  return vars as React.CSSProperties;
}

/**
 * One row per token kind: the class the DOM uses and the palette key the
 * canvas paints with. Keep the two halves in agreement or the PNG stops
 * matching the block it came from.
 */
const tokenStyles: Record<TokenKind, { className: string; color: keyof CodePalette }> = {
  plain: { className: "text-[var(--cs-fg)]", color: "fg" },
  variable: { className: "text-[var(--cs-fg)]", color: "fg" },
  comment: { className: "text-[var(--cs-comment)] italic", color: "comment" },
  string: { className: "text-[var(--cs-string)]", color: "string" },
  number: { className: "text-[var(--cs-number)]", color: "number" },
  constant: { className: "text-[var(--cs-number)]", color: "number" },
  keyword: { className: "text-[var(--cs-keyword)]", color: "keyword" },
  function: { className: "text-[var(--cs-fn)]", color: "fn" },
  type: { className: "text-[var(--cs-type)]", color: "type" },
  property: { className: "text-[var(--cs-type)]", color: "type" },
  tag: { className: "text-[var(--cs-tag)]", color: "tag" },
  attribute: { className: "text-[var(--cs-attribute)]", color: "attribute" },
  operator: { className: "text-[var(--cs-muted)]", color: "muted" },
  punctuation: { className: "text-[var(--cs-muted)]", color: "muted" },
  meta: { className: "text-[var(--cs-muted)]", color: "muted" },
  insert: { className: "text-[var(--cs-insert)]", color: "insert" },
  delete: { className: "text-[var(--cs-delete)]", color: "delete" },
};

const paletteKeys = [
  "bg",
  "fg",
  "muted",
  "band",
  "accent",
  "comment",
  "string",
  "number",
  "keyword",
  "fn",
  "type",
  "attribute",
  "tag",
  "insert",
  "delete",
] as const satisfies readonly (keyof CodePalette)[];

/** The resolved palette, straight from the element the browser just styled. */
function readPalette(element: HTMLElement): CodePalette {
  const styles = getComputedStyle(element);
  const palette = {} as CodePalette;
  for (const key of paletteKeys) {
    palette[key] = styles.getPropertyValue(`--cs-${key}`).trim() || "#808080";
  }
  return palette;
}

/* ================================================================
   Helpers
   ================================================================ */

/** `"1,4-6"` or `[1, 4, 5, 6]` — both end up as a set of line numbers. */
function parseLines(spec: string | number[] | undefined): Set<number> {
  if (!spec) return new Set();
  if (Array.isArray(spec)) return new Set(spec);

  const numbers = new Set<number>();
  for (const part of spec.split(",")) {
    const [from, to] = part.split("-").map((value) => Number.parseInt(value.trim(), 10));
    if (Number.isNaN(from)) continue;
    // `"2"` splits to a single part, so `to` is undefined rather than NaN.
    const end = to === undefined || Number.isNaN(to) ? from : to;
    for (let line = Math.min(from, end); line <= Math.max(from, end); line += 1) {
      numbers.add(line);
    }
  }
  return numbers;
}

function lineLength(line: CodeLine) {
  return line.tokens.reduce((total, token) => total + token.text.length, 0);
}

function fileNameFor(title: string | undefined, override: string | undefined) {
  if (override) return override.endsWith(".png") ? override : `${override}.png`;
  const base = (title ?? "snippet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "snippet"}.png`;
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/* ================================================================
   Component
   ================================================================ */

type CodeSnippetProps = Omit<React.ComponentProps<"div">, "children"> & {
  code: string;
  /** `"auto"` reads the extension in `title` first, the code itself second. */
  lang?: CodeLanguage;
  /** Filename in the header bar. Also names the exported PNG. */
  title?: string;
  scheme?: CodeSchemeName;
  frame?: "sticker" | "holo" | "plain";
  chrome?: "dots" | "plain" | "none";
  lineNumbers?: boolean;
  startLine?: number;
  /** Lines to wash with the accent color: `"3,7-9"` or `[3, 7, 8, 9]`. */
  highlight?: string | number[];
  wrap?: boolean;
  /** Collapse to this many lines behind a "show all" control. */
  maxLines?: number;
  languageBadge?: boolean;
  copyable?: boolean;
  /** Show the PNG controls: download, and copy to the clipboard where allowed. */
  exportable?: boolean;
  /** Let the reader switch scheme. `scheme` stays the starting point. */
  schemePicker?: boolean;
  wrapToggle?: boolean;
  /** Pixel density of the PNG. Clamped to 1–4. */
  exportScale?: number;
  /** What sits behind the card in the PNG. */
  exportBackdrop?: "holo" | "scheme" | "none";
  /** Small credit painted into the PNG only. */
  watermark?: string;
  /** Override the download filename. */
  fileName?: string;
  onCopied?: (value: string) => void;
  /**
   * The clipboard refused — plain HTTP, an embedded browser, a denied prompt.
   * The block already announces it in its own live region; this is for the page
   * that wants to say more than "Copy failed".
   */
  onCopyError?: (error: unknown) => void;
};

function CodeSnippet({
  code,
  lang = "auto",
  title,
  scheme: schemeName = "duck",
  frame = "sticker",
  chrome = "dots",
  lineNumbers = true,
  startLine = 1,
  highlight,
  wrap = false,
  maxLines,
  languageBadge = true,
  copyable = true,
  exportable = true,
  schemePicker = false,
  wrapToggle = false,
  exportScale = 2,
  exportBackdrop = "holo",
  watermark,
  fileName,
  onCopied,
  onCopyError,
  className,
  ...props
}: CodeSnippetProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const preRef = React.useRef<HTMLPreElement>(null);

  // Props stay authoritative until the reader touches a control.
  const [pickedScheme, setPickedScheme] = React.useState<CodeSchemeName | null>(null);
  const [pickedWrap, setPickedWrap] = React.useState<boolean | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [canCopyImage, setCanCopyImage] = React.useState(false);

  const scheme = getCodeScheme(pickedScheme ?? schemeName);
  const wrapped = pickedWrap ?? wrap;

  const language = React.useMemo(
    () => (lang === "auto" ? detectLanguage(code, title) : lang),
    [lang, code, title]
  );
  const lines = React.useMemo(() => tokenizeCode(code, language), [code, language]);
  const marked = React.useMemo(() => parseLines(highlight), [highlight]);

  const total = lines.length;
  const collapsible = maxLines !== undefined && total > maxLines;
  const visible = collapsible && !expanded ? lines.slice(0, maxLines) : lines;
  const gutterWidth = String(startLine + total - 1).length;

  // ClipboardItem is missing in Firefox, so the control only appears where it
  // would actually work.
  React.useEffect(() => {
    setCanCopyImage(
      typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function"
    );
  }, []);

  React.useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  /* ---- PNG ---- */

  /**
   * Paint the whole snippet — never the collapsed slice, never wrapped — from
   * the same tokens the DOM rendered, in the colors the DOM resolved.
   */
  const paint = React.useCallback(async () => {
    const root = rootRef.current;
    const pre = preRef.current;
    if (!root || !pre) throw new Error("CodeSnippet is not mounted");

    await document.fonts?.ready;

    const palette = readPalette(root);
    const preStyles = getComputedStyle(pre);
    const fontSize = Math.round(Number.parseFloat(preStyles.fontSize) || 13);
    const fontFamily = preStyles.fontFamily || "monospace";
    const font = `${fontSize}px ${fontFamily}`;

    const canvas = document.createElement("canvas");
    const measure = canvas.getContext("2d");
    if (!measure) throw new Error("Canvas is unavailable");

    measure.font = font;
    const charWidth = measure.measureText("0".repeat(20)).width / 20;
    const lineHeight = Math.round(fontSize * 1.7);
    const pad = Math.round(fontSize * 1.5);
    const header = chrome === "none" ? 0 : Math.round(fontSize * 2.8);
    const gutter = lineNumbers ? gutterWidth * charWidth + fontSize : 0;
    const footer = watermark ? lineHeight : 0;
    const columns = lines.reduce((widest, line) => Math.max(widest, lineLength(line)), 0);

    const cardWidth = Math.max(pad * 2 + gutter + columns * charWidth, fontSize * 24);
    const cardHeight = header + pad * 2 + total * lineHeight + footer;
    const inset = exportBackdrop === "none" ? 0 : Math.round(fontSize * 2.6);
    const scale = Math.min(Math.max(exportScale, 1), 4);

    canvas.width = Math.ceil((cardWidth + inset * 2) * scale);
    canvas.height = Math.ceil((cardHeight + inset * 2) * scale);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.scale(scale, scale);
    context.textBaseline = "middle";
    context.font = font;

    // Backdrop
    if (exportBackdrop !== "none") {
      if (exportBackdrop === "holo") {
        const gradient = context.createLinearGradient(
          0,
          0,
          cardWidth + inset * 2,
          cardHeight + inset * 2
        );
        gradient.addColorStop(0, palette.accent);
        gradient.addColorStop(0.55, palette.type);
        gradient.addColorStop(1, palette.tag);
        context.fillStyle = gradient;
      } else {
        context.fillStyle = palette.band;
      }
      context.fillRect(0, 0, cardWidth + inset * 2, cardHeight + inset * 2);
    }

    // Card
    const left = inset;
    const top = inset;
    const radius = Math.round(fontSize);
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.32)";
    context.shadowBlur = fontSize * 2;
    context.shadowOffsetY = fontSize * 0.8;
    roundRectPath(context, left, top, cardWidth, cardHeight, radius);
    context.fillStyle = palette.bg;
    context.fill();
    context.restore();

    roundRectPath(context, left, top, cardWidth, cardHeight, radius);
    context.save();
    context.clip();

    // Header bar
    if (header > 0) {
      context.fillStyle = palette.band;
      context.fillRect(left, top, cardWidth, header);
      context.save();
      context.globalAlpha = 0.3;
      context.fillStyle = palette.muted;
      context.fillRect(left, top + header - 1, cardWidth, 1);
      context.restore();

      let dotX = left + pad;
      if (chrome === "dots") {
        const dotRadius = fontSize * 0.32;
        for (const color of [palette.delete, palette.number, palette.insert]) {
          context.beginPath();
          context.arc(dotX + dotRadius, top + header / 2, dotRadius, 0, Math.PI * 2);
          context.fillStyle = color;
          context.fill();
          dotX += dotRadius * 3.2;
        }
        dotX += fontSize * 0.4;
      }
      if (title) {
        context.font = `${Math.round(fontSize * 0.92)}px ${fontFamily}`;
        context.fillStyle = palette.muted;
        context.fillText(title, dotX, top + header / 2);
      }
    }

    // Lines
    const contentTop = top + header + pad;
    lines.forEach((line, index) => {
      const rowTop = contentTop + index * lineHeight;
      const middle = rowTop + lineHeight / 2;

      const wash =
        line.change === "insert"
          ? palette.insert
          : line.change === "delete"
            ? palette.delete
            : marked.has(startLine + index)
              ? palette.accent
              : null;

      if (wash) {
        context.save();
        context.globalAlpha = 0.14;
        context.fillStyle = wash;
        context.fillRect(left, rowTop, cardWidth, lineHeight);
        context.restore();
        context.fillStyle = wash;
        context.fillRect(left, rowTop, 2, lineHeight);
      }

      if (lineNumbers) {
        context.font = font;
        context.fillStyle = palette.muted;
        context.textAlign = "right";
        context.fillText(
          String(startLine + index),
          left + pad + gutter - fontSize,
          middle
        );
        context.textAlign = "left";
      }

      let x = left + pad + gutter;
      for (const token of line.tokens) {
        context.font = token.kind === "comment" ? `italic ${font}` : font;
        context.fillStyle = palette[tokenStyles[token.kind].color];
        context.fillText(token.text, x, middle);
        x += token.text.length * charWidth;
      }
    });

    if (watermark) {
      context.font = `${Math.round(fontSize * 0.85)}px ${fontFamily}`;
      context.textAlign = "right";
      context.save();
      context.globalAlpha = 0.6;
      context.fillStyle = palette.muted;
      context.fillText(watermark, left + cardWidth - pad, top + cardHeight - pad - footer / 2);
      context.restore();
      context.textAlign = "left";
    }

    context.restore();
    return canvas;
  }, [
    chrome,
    exportBackdrop,
    exportScale,
    gutterWidth,
    lineNumbers,
    lines,
    marked,
    startLine,
    title,
    total,
    watermark,
  ]);

  const toBlob = React.useCallback(async () => {
    const canvas = await paint();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("Could not encode the PNG");
    return blob;
  }, [paint]);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFor(title, fileName);
      link.click();
      URL.revokeObjectURL(url);
      setStatus("PNG saved");
    } catch {
      setStatus("Export failed");
    } finally {
      setBusy(false);
    }
  };

  const copyImage = async () => {
    setBusy(true);
    try {
      // Built before the first await: Safari drops the write once the user
      // gesture has expired, but it will wait on a promise handed to it now.
      const item = new ClipboardItem({ "image/png": toBlob() });
      await navigator.clipboard.write([item]);
      setStatus("Image copied");
    } catch (error) {
      setStatus("Copy failed");
      // Same refusal, same channel: a page that handles one wants both.
      onCopyError?.(error);
    } finally {
      setBusy(false);
    }
  };

  /* ---- Chrome ---- */

  const showHeader = chrome !== "none";
  const actions = (
    <>
      {schemePicker && (
        <select
          value={scheme.name}
          onChange={(event) => setPickedScheme(event.target.value as CodeSchemeName)}
          aria-label="Color scheme"
          className={cn(
            "h-7 cursor-pointer rounded-md border border-transparent bg-transparent px-1 font-mono text-[11px]",
            "text-[var(--cs-muted)] transition-colors hover:text-[var(--cs-fg)]",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {codeSnippetSchemes.map((option) => (
            <option key={option.name} value={option.name} className="bg-card text-foreground">
              {option.label}
            </option>
          ))}
        </select>
      )}
      {wrapToggle && (
        <SnippetAction
          icon={WrapText}
          label={wrapped ? "Stop wrapping lines" : "Wrap long lines"}
          pressed={wrapped}
          onClick={() => setPickedWrap(!wrapped)}
        />
      )}
      {copyable && (
        <CopyButton
          value={code}
          label="Copy code"
          copiedLabel="Code copied"
          errorLabel="Copy failed"
          onCopied={onCopied}
          onError={(error) => {
            // The code is on the page and selectable, so the honest fallback is
            // to say so rather than to leave the button looking broken.
            setStatus("Copy failed — select the code and copy it manually");
            onCopyError?.(error);
          }}
          className="size-7 border-transparent bg-transparent text-[var(--cs-muted)] hover:border-transparent hover:text-[var(--cs-fg)]"
        />
      )}
      {exportable && (
        <SnippetAction
          icon={ImageDown}
          label="Download as PNG"
          disabled={busy}
          onClick={download}
        />
      )}
      {exportable && canCopyImage && (
        <SnippetAction
          icon={Clipboard}
          label="Copy image to clipboard"
          disabled={busy}
          onClick={copyImage}
        />
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      data-slot="code-snippet"
      data-scheme={scheme.name}
      style={schemeVars(scheme)}
      className={cn(
        "group/snippet relative w-full overflow-hidden rounded-xl bg-[var(--cs-bg)]",
        PALETTE_VARS,
        frame === "holo"
          ? "holo-border"
          : frame === "sticker"
            ? "sticker border-border"
            : "border border-border",
        className
      )}
      {...props}
    >
      {showHeader ? (
        <div className="flex items-center gap-2 border-b border-[color-mix(in_oklab,var(--cs-muted)_26%,transparent)] bg-[var(--cs-band)] px-3 py-2">
          {chrome === "dots" && (
            <span aria-hidden className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--cs-delete)]" />
              <span className="size-2.5 rounded-full bg-[var(--cs-number)]" />
              <span className="size-2.5 rounded-full bg-[var(--cs-insert)]" />
            </span>
          )}
          {title && (
            <span className="truncate font-mono text-xs text-[var(--cs-muted)]">{title}</span>
          )}
          {languageBadge && (
            <span className="rounded-md bg-[color-mix(in_oklab,var(--cs-accent)_18%,transparent)] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[var(--cs-accent)] uppercase">
              {languageLabels[language]}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">{actions}</span>
        </div>
      ) : (
        <span className="absolute top-2 right-2 z-1 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-[var(--ease-duck)] group-hover/snippet:opacity-100 focus-within:opacity-100">
          {actions}
        </span>
      )}

      <div className="relative">
        <div
          role="region"
          tabIndex={0}
          aria-label={`${title ? `${title}, ` : ""}${languageLabels[language]} code`}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <pre
            ref={preRef}
            className={cn(
              "w-fit min-w-full py-3 font-mono text-[13px] leading-[1.7]",
              wrapped ? "break-words whitespace-pre-wrap" : "whitespace-pre"
            )}
          >
            <code>
              {visible.map((line, index) => {
                const number = startLine + index;
                const change = line.change;
                return (
                  <span
                    key={number}
                    data-line={number}
                    className={cn(
                      "flex px-4",
                      marked.has(number) &&
                        "bg-[color-mix(in_oklab,var(--cs-accent)_14%,transparent)] shadow-[inset_2px_0_0_0_var(--cs-accent)]",
                      change === "insert" &&
                        "bg-[color-mix(in_oklab,var(--cs-insert)_14%,transparent)] shadow-[inset_2px_0_0_0_var(--cs-insert)]",
                      change === "delete" &&
                        "bg-[color-mix(in_oklab,var(--cs-delete)_14%,transparent)] shadow-[inset_2px_0_0_0_var(--cs-delete)]"
                    )}
                  >
                    {lineNumbers && (
                      <span
                        aria-hidden
                        className="mr-4 shrink-0 text-right tabular-nums text-[var(--cs-muted)] select-none"
                        style={{ width: `${gutterWidth}ch` }}
                      >
                        {number}
                      </span>
                    )}
                    <span className={cn(wrapped && "min-w-0")}>
                      {line.tokens.length === 0
                        ? // A zero-width space, or an empty line has no height.
                          "\u200b"
                        : line.tokens.map((token, position) => (
                            <span
                              key={position}
                              className={tokenStyles[token.kind].className}
                            >
                              {token.text}
                            </span>
                          ))}
                    </span>
                  </span>
                );
              })}
            </code>
          </pre>
        </div>

        {collapsible && !expanded && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-[var(--cs-bg)] to-transparent"
            />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer rounded-lg border border-[color-mix(in_oklab,var(--cs-accent)_45%,transparent)] bg-[var(--cs-band)] px-3 py-1 font-mono text-[11px] text-[var(--cs-accent)] transition-transform duration-200 ease-[var(--ease-duck)] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Show all {total} lines
            </button>
          </>
        )}
      </div>

      {collapsible && expanded && (
        <div className="flex justify-center border-t border-[color-mix(in_oklab,var(--cs-muted)_26%,transparent)] p-2">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-[11px] text-[var(--cs-muted)] transition-colors hover:text-[var(--cs-fg)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronsDownUp className="size-3.5" />
            Collapse to {maxLines} lines
          </button>
        </div>
      )}

      <span aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}

function SnippetAction({
  icon: Icon,
  label,
  pressed,
  className,
  ...props
}: React.ComponentProps<"button"> & { icon: LucideIcon; label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent",
        "transition-colors duration-200 ease-[var(--ease-duck)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        pressed
          ? "border-[color-mix(in_oklab,var(--cs-accent)_45%,transparent)] text-[var(--cs-accent)]"
          : "text-[var(--cs-muted)] hover:text-[var(--cs-fg)]",
        className
      )}
      {...props}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

export { CodeSnippet, codeSnippetSchemes };
