// Generates the published JSON Schema for ThumbDoc from src/state.ts, which stays the
// single source of truth for the document format.
//
// The output lands in server/src/generated/ rather than the repo root because
// docker-compose builds the api with context ./server — the image cannot see src/.
//
//   bun run schema         write the schema
//   bun run schema:check   fail if the committed file is stale
//
// The MCP server does NOT read this file; it imports src/state.ts directly. This artifact
// exists solely so the server can enforce the format and serve it at GET /api/schema.

import { createGenerator } from "ts-json-schema-generator";

const OUT = new URL("../server/src/generated/thumbdoc.schema.json", import.meta.url);

const NOTE =
  "GENERATED FILE — do not edit. Source of truth is src/state.ts; regenerate with `bun run schema`.";

export function buildSchema(): Record<string, unknown> {
  const schema = createGenerator({
    path: new URL("../src/state.ts", import.meta.url).pathname,
    tsconfig: new URL("../tsconfig.json", import.meta.url).pathname,
    type: "ThumbDoc",
    expose: "export",
    topRef: true,
    jsDoc: "extended",
    // Forward-compatible on purpose: a schema stricter than the editor would reject docs
    // the editor legitimately produces the moment a new field ships. Unknown keys are
    // instead reported as non-fatal warnings by the server's strict shadow validator.
    additionalProperties: true,
    // Fail loudly on a TS error rather than emitting a partial schema.
    skipTypeCheck: false,
  }).createSchema("ThumbDoc") as Record<string, unknown>;

  // draft-07 is load-bearing: TextFx.gradient.colors is a fixed 3-tuple, which draft-07
  // emits as items[] + minItems/maxItems (enforced by plain ajv). Under 2020-12 it would
  // become prefixItems, which ajv's default export silently ignores.
  const draft = String(schema.$schema ?? "");
  if (!draft.includes("draft-07")) {
    throw new Error(`expected a draft-07 schema, got ${draft || "(none)"}`);
  }

  return { $schema: schema.$schema, $comment: NOTE, ...schema };
}

const serialized = `${JSON.stringify(buildSchema(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await Bun.file(OUT).text().catch(() => "");
  if (current !== serialized) {
    console.error("thumbdoc.schema.json is stale — run `bun run schema` and commit the result.");
    process.exit(1);
  }
  console.log("schema up to date");
} else {
  await Bun.write(OUT, serialized);
  console.log(`wrote ${OUT.pathname}`);
}
