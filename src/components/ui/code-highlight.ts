export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "constant"
  | "function"
  | "type"
  | "property"
  | "tag"
  | "attribute"
  | "variable"
  | "operator"
  | "punctuation"
  | "meta"
  | "insert"
  | "delete";

export interface CodeToken {
  kind: TokenKind;
  text: string;
}

export interface CodeLine {
  tokens: CodeToken[];
  /** Set for diff input, so a line can be washed green or red as a whole. */
  change?: "insert" | "delete" | "meta";
}

/* ================================================================
   Grammars

   Every rule carries a sticky regex, tried in order at the current
   index; the first hit wins and nothing backtracks. `push` and `pop`
   move a context stack, which is what makes JSX work: a tag opens a
   context where bare identifiers are attributes, `{` re-enters code,
   and `>` closes it again.
   ================================================================ */

interface Rule {
  kind: TokenKind;
  /** Must carry the `y` flag — the scanner matches at an exact index. */
  re: RegExp;
  /** Only apply when the previous meaningful token was one of these. */
  after?: TokenKind[];
  /** Enter this context after a match. */
  push?: string;
  /** Leave the current context after a match. */
  pop?: boolean;
}

type Grammar = Record<string, Rule[]>;

const whitespace: Rule = { kind: "plain", re: /[ \t\n]+/y };

/* ---- JavaScript family: js, jsx, ts, tsx ---- */

const jsKeywords =
  /\b(?:abstract|as|asserts|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|global|if|implements|import|in|infer|instanceof|interface|is|keyof|let|namespace|new|of|override|package|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|unique|var|void|while|with|yield)\b/y;

const jsCode: Rule[] = [
  whitespace,
  { kind: "comment", re: /\/\/[^\n]*/y },
  { kind: "comment", re: /\/\*[\s\S]*?(?:\*\/|$)/y },
  { kind: "string", re: /"(?:\\.|[^"\\\n])*"/y },
  { kind: "string", re: /'(?:\\.|[^'\\\n])*'/y },
  { kind: "string", re: /`(?:\\.|[^`\\])*`/y },
  // A slash only starts a regex where a value is expected. After an
  // identifier or a closing bracket it is division.
  {
    kind: "string",
    re: /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuvy]*/y,
    after: ["operator", "keyword", "punctuation"],
  },
  { kind: "attribute", re: /@[A-Za-z_$][\w$.]*/y },
  {
    kind: "number",
    re: /0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?n?/y,
  },
  // `<div`, `</Card` — but not `Array<string>`, where the previous token is a
  // type or an identifier rather than punctuation.
  {
    kind: "tag",
    re: /<\/?[A-Za-z][\w.:-]*/y,
    after: ["punctuation", "operator", "keyword"],
    push: "tag",
  },
  { kind: "constant", re: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y },
  { kind: "keyword", re: jsKeywords },
  { kind: "function", re: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
  { kind: "constant", re: /\b[A-Z][A-Z0-9_]{2,}\b/y },
  { kind: "type", re: /\b[A-Z][\w$]*\b/y },
  { kind: "property", re: /\b[A-Za-z_$][\w$]*(?=\s*:)/y },
  { kind: "variable", re: /[A-Za-z_$][\w$]*/y },
  { kind: "punctuation", re: /\{/y, push: "code" },
  { kind: "punctuation", re: /\}/y, pop: true },
  { kind: "punctuation", re: /[()[\];,.]/y },
  { kind: "operator", re: /[+\-*/%=&|!<>?:^~]+/y },
];

/** Inside `<... >`: bare words are attributes and `{` re-enters code. */
const jsTag: Rule[] = [
  whitespace,
  { kind: "string", re: /"(?:\\.|[^"\\\n])*"/y },
  { kind: "string", re: /'(?:\\.|[^'\\\n])*'/y },
  { kind: "punctuation", re: /\{/y, push: "code" },
  { kind: "punctuation", re: /\/?>/y, pop: true },
  { kind: "operator", re: /=/y },
  { kind: "attribute", re: /[A-Za-z_$][\w$:.-]*/y },
  { kind: "punctuation", re: /[^\s]/y },
];

const jsGrammar: Grammar = { code: jsCode, tag: jsTag };

/* ---- HTML and SVG ---- */

const htmlGrammar: Grammar = {
  code: [
    { kind: "comment", re: /<!--[\s\S]*?(?:-->|$)/y },
    { kind: "meta", re: /<![A-Za-z][^>]*>/y },
    { kind: "tag", re: /<\/?[A-Za-z][\w:-]*/y, push: "tag" },
    { kind: "constant", re: /&#?[\w]+;/y },
    { kind: "plain", re: /[^<&]+/y },
  ],
  tag: [
    whitespace,
    { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
    { kind: "string", re: /'(?:\\.|[^'\\])*'/y },
    { kind: "punctuation", re: /\/?>/y, pop: true },
    { kind: "operator", re: /=/y },
    { kind: "attribute", re: /[A-Za-z_@:][\w:.-]*/y },
    { kind: "punctuation", re: /[^\s]/y },
  ],
};

/* ---- CSS ---- */

const cssGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /\/\*[\s\S]*?(?:\*\/|$)/y },
    { kind: "keyword", re: /@[\w-]+|!important/y },
    { kind: "string", re: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y },
    { kind: "constant", re: /#[0-9a-fA-F]{3,8}\b/y },
    { kind: "property", re: /[\w-]+(?=\s*:)/y },
    // Before the selector rule below, or `.5rem` reads as a class name.
    {
      kind: "number",
      re: /-?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:%|[a-zA-Z]+)?/y,
    },
    { kind: "type", re: /::?[\w-]+|[.#][\w-]+/y },
    { kind: "function", re: /[\w-]+(?=\()/y },
    { kind: "variable", re: /--[\w-]+|[\w-]+/y },
    { kind: "punctuation", re: /[{}()[\];:,]/y },
    { kind: "operator", re: /[>+~*/=]/y },
  ],
};

/* ---- JSON and JSONC ---- */

const jsonGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
    { kind: "property", re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
    { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
    { kind: "constant", re: /\b(?:true|false|null)\b/y },
    { kind: "number", re: /-?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
    { kind: "punctuation", re: /[{}[\],:]/y },
  ],
};

/* ---- Shell ---- */

const bashGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /"(?:\\.|[^"\\])*"|'[^']*'/y },
    { kind: "variable", re: /\$\{[^}\n]*\}|\$[\w@#?!*$-]+/y },
    {
      kind: "keyword",
      re: /\b(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|in|function|return|exit|export|local|readonly|source|set|unset|shift|trap|eval)\b/y,
    },
    // The first word of a command, and anything after a pipe or a separator.
    { kind: "function", re: /(?:^|(?<=[|&;]\s*))[\w.\/-]+/my },
    { kind: "attribute", re: /(?<=\s)--?[A-Za-z][\w-]*/y },
    { kind: "number", re: /\b\d+\b/y },
    { kind: "operator", re: /[|&;<>]+|=/y },
    { kind: "punctuation", re: /[(){}[\],]/y },
    { kind: "plain", re: /[^\s|&;<>(){}[\],=]+/y },
  ],
};

/* ---- Python ---- */

const pythonGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /[rbfuRBFU]{0,2}("""|''')[\s\S]*?(?:\1|$)/y },
    {
      kind: "string",
      re: /[rbfuRBFU]{0,2}(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y,
    },
    { kind: "attribute", re: /@[\w.]+/y },
    { kind: "constant", re: /\b(?:True|False|None|self|cls)\b/y },
    {
      kind: "keyword",
      re: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/y,
    },
    { kind: "number", re: /\b(?:0[xXbBoO][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?j?)\b/y },
    { kind: "function", re: /\b\w+(?=\s*\()/y },
    { kind: "type", re: /\b[A-Z]\w*\b/y },
    { kind: "property", re: /\b\w+(?=\s*=(?!=))/y },
    { kind: "variable", re: /\b\w+\b/y },
    { kind: "punctuation", re: /[()[\]{},:.]/y },
    { kind: "operator", re: /[+\-*/%=&|!<>^~]+/y },
  ],
};

/* ---- SQL ---- */

const sqlGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
    { kind: "string", re: /'(?:''|[^'])*'/y },
    {
      kind: "keyword",
      re: /\b(?:add|all|alter|and|as|asc|between|by|case|cast|column|constraint|create|cross|default|delete|desc|distinct|drop|else|end|exists|foreign|from|full|group|having|if|in|index|inner|insert|into|is|join|key|left|like|limit|not|null|offset|on|or|order|outer|primary|references|returning|right|select|set|table|then|union|unique|update|using|values|view|when|where|with)\b/iy,
    },
    {
      kind: "type",
      re: /\b(?:bigint|boolean|bytea|char|date|decimal|double|float|int|integer|json|jsonb|numeric|real|serial|smallint|text|time|timestamp|uuid|varchar)\b/iy,
    },
    { kind: "constant", re: /\b(?:true|false|null|current_timestamp|now)\b/iy },
    { kind: "number", re: /\b\d+(?:\.\d+)?\b/y },
    { kind: "function", re: /\b\w+(?=\s*\()/y },
    { kind: "variable", re: /"[^"]*"|`[^`]*`|\b\w+\b/y },
    { kind: "punctuation", re: /[()[\],;.]/y },
    { kind: "operator", re: /[+\-*/%=<>!|]+/y },
  ],
};

/* ---- YAML ---- */

const yamlGrammar: Grammar = {
  code: [
    whitespace,
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "meta", re: /^(?:---|\.\.\.)$/my },
    { kind: "property", re: /[\w.$/-]+(?=\s*:(?:\s|$))/y },
    { kind: "attribute", re: /[&*][\w-]+|![\w!/:-]+/y },
    { kind: "string", re: /"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/y },
    { kind: "constant", re: /\b(?:true|false|null|yes|no|on|off|~)\b/iy },
    { kind: "number", re: /-?\b\d+(?:\.\d+)?\b/y },
    { kind: "punctuation", re: /-(?=\s)|[:[\]{},]|[|>][-+]?$/my },
    { kind: "plain", re: /[^\s]+/y },
  ],
};

const grammars: Record<string, Grammar> = {
  js: jsGrammar,
  html: htmlGrammar,
  css: cssGrammar,
  json: jsonGrammar,
  bash: bashGrammar,
  python: pythonGrammar,
  sql: sqlGrammar,
  yaml: yamlGrammar,
};

/* ================================================================
   Languages
   ================================================================ */

export const codeSnippetLanguages = [
  "auto",
  "tsx",
  "ts",
  "jsx",
  "js",
  "json",
  "jsonc",
  "css",
  "html",
  "bash",
  "python",
  "sql",
  "yaml",
  "diff",
  "text",
] as const;

export type CodeLanguage = (typeof codeSnippetLanguages)[number];

/** What each language is called in the header badge. */
export const languageLabels: Record<CodeLanguage, string> = {
  auto: "auto",
  tsx: "tsx",
  ts: "ts",
  jsx: "jsx",
  js: "js",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  html: "html",
  bash: "bash",
  python: "py",
  sql: "sql",
  yaml: "yaml",
  diff: "diff",
  text: "txt",
};

const grammarNames: Record<CodeLanguage, string | null> = {
  auto: "js",
  tsx: "js",
  ts: "js",
  jsx: "js",
  js: "js",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "html",
  bash: "bash",
  python: "python",
  sql: "sql",
  yaml: "yaml",
  diff: null,
  text: null,
};

const extensions: Record<string, CodeLanguage> = {
  tsx: "tsx",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  jsx: "jsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  htm: "html",
  svg: "html",
  vue: "html",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  env: "bash",
  py: "python",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  diff: "diff",
  patch: "diff",
  txt: "text",
  md: "text",
};

/**
 * Guess a language from the filename first — it is the one signal that is
 * never wrong — and from the shape of the code only as a fallback.
 */
export function detectLanguage(code: string, title?: string): CodeLanguage {
  const extension = title?.toLowerCase().match(/\.([a-z0-9]+)\s*$/)?.[1];
  if (extension && extension in extensions) return extensions[extension];

  const source = code.trim();
  if (/^(?:diff --git|@@ |[-+]{3} )/m.test(source)) return "diff";
  if (/^[{[]/.test(source) && /["\d}\]]\s*$/.test(source)) return "json";
  if (/^(?:<!DOCTYPE|<html|<svg|<\?xml)/i.test(source)) return "html";
  if (/^(?:import|from)\s|\bdef\s+\w+\(|^print\(/m.test(source)) return "python";
  if (/^(?:select|insert into|update|create table|with)\b/i.test(source)) return "sql";
  if (/^[\w.-]+:\s|^- \w/m.test(source) && !/[{};]/.test(source)) return "yaml";
  if (/^(?:[.#@:]|[\w-]+\s*\{)/.test(source) && /:\s*[^;\n]+;/.test(source)) return "css";
  if (/^(?:\$ |#!|npm |npx |pnpm |yarn |bun |git |docker |curl |cd |sudo )/m.test(source))
    return "bash";
  return "tsx";
}

/* ================================================================
   Scanner
   ================================================================ */

function scan(source: string, grammar: Grammar): CodeToken[] {
  const tokens: CodeToken[] = [];
  const stack = ["code"];
  let index = 0;
  let previous: TokenKind | undefined;

  const emit = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
    if (text.trim()) previous = kind;
  };

  while (index < source.length) {
    const rules = grammar[stack[stack.length - 1]] ?? grammar.code;
    let length = 0;

    for (const rule of rules) {
      if (rule.after && previous && !rule.after.includes(previous)) continue;
      rule.re.lastIndex = index;
      const match = rule.re.exec(source);
      if (!match?.[0]) continue;

      emit(rule.kind, match[0]);
      length = match[0].length;
      if (rule.push) stack.push(rule.push);
      else if (rule.pop && stack.length > 1) stack.pop();
      break;
    }

    // No rule matched: take one character so the scan always advances.
    if (length === 0) {
      emit("plain", source[index]);
      length = 1;
    }
    index += length;
  }

  return tokens;
}

function splitLines(tokens: CodeToken[]): CodeLine[] {
  const lines: CodeLine[] = [{ tokens: [] }];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ tokens: [] });
      if (part) lines[lines.length - 1].tokens.push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

/** Diffs are line-based, so the marker decides the whole line. */
function splitDiff(source: string): CodeLine[] {
  return source.split("\n").map((text) => {
    const change =
      /^(?:@@|diff |index |[-+]{3} )/.test(text)
        ? ("meta" as const)
        : text.startsWith("+")
          ? ("insert" as const)
          : text.startsWith("-")
            ? ("delete" as const)
            : undefined;
    const kind: TokenKind = change ?? "plain";
    return { tokens: text ? [{ kind, text }] : [], change };
  });
}

/**
 * Turn source into lines of colored tokens. Tabs become two spaces and CRLF
 * becomes LF, so what the DOM shows and what the PNG paints are the same
 * string measured the same way.
 */
export function tokenizeCode(code: string, language: CodeLanguage): CodeLine[] {
  const source = code.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  if (language === "diff") return splitDiff(source);

  const grammar = grammars[grammarNames[language] ?? ""];
  if (!grammar) {
    return source
      .split("\n")
      .map((text) => ({ tokens: text ? [{ kind: "plain" as TokenKind, text }] : [] }));
  }
  return splitLines(scan(source, grammar));
}

/* ================================================================
   Palettes

   Fifteen colors per mode. Everything else is derived in the
   component, so adding a scheme stays a small job.
   ================================================================ */

export interface CodePalette {
  /** Code surface. */
  bg: string;
  /** Default text, identifiers, punctuation-adjacent plain runs. */
  fg: string;
  /** Gutter, operators, brackets — everything that should recede. */
  muted: string;
  /** Header bar and the collapsed-fade base. */
  band: string;
  /** Caret, focus, badge, line-highlight wash. */
  accent: string;
  comment: string;
  string: string;
  number: string;
  keyword: string;
  /** Function and method names. */
  fn: string;
  type: string;
  attribute: string;
  tag: string;
  insert: string;
  delete: string;
}

export interface CodeScheme {
  name: string;
  label: string;
  light: CodePalette;
  dark: CodePalette;
}

export const codeSnippetSchemes = [
  {
    name: "duck",
    label: "Duck",
    dark: {
      bg: "#1c1c20",
      fg: "#e8e8ec",
      muted: "#82828d",
      band: "#26262c",
      accent: "#cbe86a",
      comment: "#82828d",
      string: "#c3e86a",
      number: "#f0b45f",
      keyword: "#c58cf5",
      fn: "#6ad4bd",
      type: "#7cbef8",
      attribute: "#f0b45f",
      tag: "#ff9095",
      insert: "#7fd88f",
      delete: "#ff8b8b",
    },
    light: {
      bg: "#ffffff",
      fg: "#24242a",
      muted: "#6c6c76",
      band: "#f5f6f0",
      accent: "#5d7f14",
      comment: "#77777f",
      string: "#4d7a10",
      number: "#9a5b06",
      keyword: "#7b3bc4",
      fn: "#08736a",
      type: "#1863b8",
      attribute: "#9a5b06",
      tag: "#b32b3a",
      insert: "#227a33",
      delete: "#b3242f",
    },
  },
  {
    name: "pond",
    label: "Pond",
    dark: {
      bg: "#0e1b21",
      fg: "#d7e9ee",
      muted: "#6d8d96",
      band: "#16272f",
      accent: "#58cfe0",
      comment: "#64848d",
      string: "#86e0c4",
      number: "#f2c68a",
      keyword: "#66c9f2",
      fn: "#a8dff0",
      type: "#b6b0ff",
      attribute: "#f2c68a",
      tag: "#6fe0d0",
      insert: "#7ad6a8",
      delete: "#ff9a9a",
    },
    light: {
      bg: "#f9fdff",
      fg: "#17323b",
      muted: "#4f7480",
      band: "#e7f4f8",
      accent: "#0f7f96",
      comment: "#5c8290",
      string: "#0d6b57",
      number: "#8a5310",
      keyword: "#0b6a91",
      fn: "#116c86",
      type: "#4b45c9",
      attribute: "#8a5310",
      tag: "#0a7b6e",
      insert: "#1c7a4d",
      delete: "#ab2f2f",
    },
  },
  {
    name: "sunset",
    label: "Sunset",
    dark: {
      bg: "#241a1f",
      fg: "#f6e6e2",
      muted: "#a2848a",
      band: "#30222a",
      accent: "#ff9d76",
      comment: "#9a7d84",
      string: "#ffc38a",
      number: "#ffd76b",
      keyword: "#ff8fa3",
      fn: "#ffb37c",
      type: "#f2a5ff",
      attribute: "#ffd76b",
      tag: "#ff9d76",
      insert: "#b7e08a",
      delete: "#ff8080",
    },
    light: {
      bg: "#fffaf6",
      fg: "#3a2226",
      muted: "#8a6a6f",
      band: "#fdeee2",
      accent: "#cf5b28",
      comment: "#8a6a6f",
      string: "#a4560d",
      number: "#8f5a00",
      keyword: "#c2325a",
      fn: "#b04a12",
      type: "#8b3fb0",
      attribute: "#8f5a00",
      tag: "#b3441c",
      insert: "#2f7a33",
      delete: "#b52626",
    },
  },
  {
    name: "neon",
    label: "Neon",
    dark: {
      bg: "#0b0b16",
      fg: "#e9e9ff",
      muted: "#6f6f9c",
      band: "#15152b",
      accent: "#ff5ed2",
      comment: "#5f5f8f",
      string: "#6cffc7",
      number: "#ffe066",
      keyword: "#ff5ed2",
      fn: "#5fe6ff",
      type: "#b57cff",
      attribute: "#ffb14d",
      tag: "#ff5e7a",
      insert: "#5dff9b",
      delete: "#ff5e7a",
    },
    light: {
      bg: "#fdfbff",
      fg: "#1d1b33",
      muted: "#6a6690",
      band: "#f4eefe",
      accent: "#b3007f",
      comment: "#6a6690",
      string: "#0a7a5c",
      number: "#8a6100",
      keyword: "#b3007f",
      fn: "#0a6f8a",
      type: "#6a2fb5",
      attribute: "#9a5a00",
      tag: "#b8143a",
      insert: "#0f7a44",
      delete: "#b8143a",
    },
  },
  {
    name: "paper",
    label: "Paper",
    dark: {
      bg: "#221f1a",
      fg: "#eee7d9",
      muted: "#9a9182",
      band: "#2c2822",
      accent: "#d8a273",
      comment: "#948b7c",
      string: "#b9cc8a",
      number: "#e0b978",
      keyword: "#e8998f",
      fn: "#9dc0d6",
      type: "#c0aee8",
      attribute: "#e0b978",
      tag: "#e8998f",
      insert: "#a4d6a4",
      delete: "#e89b9b",
    },
    light: {
      bg: "#fbf7ef",
      fg: "#2f2a24",
      muted: "#8a8073",
      band: "#f2ebdc",
      accent: "#8a5a2f",
      comment: "#8a8073",
      string: "#4f6b2a",
      number: "#8a5a00",
      keyword: "#8a2f2f",
      fn: "#2f5f7a",
      type: "#5b4a8a",
      attribute: "#8a5a00",
      tag: "#8a2f2f",
      insert: "#3f7a3f",
      delete: "#a33a3a",
    },
  },
  {
    name: "mono",
    label: "Mono",
    dark: {
      bg: "#1a1a1a",
      fg: "#e6e6e6",
      muted: "#8c8c8c",
      band: "#252525",
      accent: "#bdbdbd",
      comment: "#7a7a7a",
      string: "#cfcfcf",
      number: "#d6d6d6",
      keyword: "#ffffff",
      fn: "#c8c8c8",
      type: "#dcdcdc",
      attribute: "#b4b4b4",
      tag: "#ffffff",
      insert: "#d0d0d0",
      delete: "#9a9a9a",
    },
    light: {
      bg: "#ffffff",
      fg: "#1f1f1f",
      muted: "#757575",
      band: "#f2f2f2",
      accent: "#4a4a4a",
      comment: "#6f6f6f",
      string: "#3d3d3d",
      number: "#454545",
      keyword: "#000000",
      fn: "#2a2a2a",
      type: "#333333",
      attribute: "#4f4f4f",
      tag: "#000000",
      insert: "#2f2f2f",
      delete: "#767676",
    },
  },
] as const satisfies readonly CodeScheme[];

export type CodeSchemeName = (typeof codeSnippetSchemes)[number]["name"];

export function getCodeScheme(name: CodeSchemeName): CodeScheme {
  return codeSnippetSchemes.find((scheme) => scheme.name === name) ?? codeSnippetSchemes[0];
}
