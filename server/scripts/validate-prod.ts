// Read-only audit: does the data already in Postgres satisfy the published schema?
//
// Run this BEFORE switching THUMBDOC_VALIDATE to `enforce`. Known hazard: `ThumbDoc.format`
// became required on 2026-07-24 (c55780e) but the backend shipped 2026-07-11 (3633799), so
// every project saved in that window has a doc with no `format` key. migrateDoc() backfills
// it client-side on load, which means those rows are still unmigrated in the database and
// would start failing writes — for a field the caller never touched.
//
// It lives inside server/ so it ships in the api image: production Postgres is not published
// to the host, so the only way to reach it is from a container on the internal network.
//
//   docker compose exec api bun run scripts/validate-prod.ts
//   docker compose exec api bun run scripts/validate-prod.ts --fix-format
//
// DATABASE_URL is already set in that container. Without --fix-format nothing is written;
// with it, the one known backfill is applied.

// Reuses the server's own connection setup (and its DATABASE_URL requirement) so this audit
// cannot drift from how the API actually reads the data.
import { sql } from "../src/db";
import { validateDoc, validateLayer } from "../src/validate";

const fixFormat = process.argv.includes("--fix-format");

/** Collapses "layers[3] (text)/size must be number" to a shape that groups usefully. */
const bucket = (e: string) => e.replace(/\[\d+\]/g, "[i]").replace(/^layers\[i\] \((\w+)\)/, "layers[i] ($1)");

function report(label: string, rows: { id: string; errors: string[] }[], total: number) {
  const bad = rows.filter((r) => r.errors.length > 0);
  console.log(`\n${label}: ${total} rows, ${bad.length} invalid`);
  if (bad.length === 0) return;

  const hist = new Map<string, number>();
  for (const r of bad) for (const e of r.errors) hist.set(bucket(e), (hist.get(bucket(e)) ?? 0) + 1);

  for (const [msg, n] of [...hist].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)} × ${msg}`);
  console.log(`  first offending ids: ${bad.slice(0, 5).map((r) => r.id).join(", ")}`);
}

const projects = await sql<{ id: string; doc: unknown }[]>`SELECT id, doc FROM projects`;
report(
  "projects.doc",
  projects.map((r) => ({ id: r.id, errors: validateDoc(r.doc) })),
  projects.length
);

const starred = await sql<{ id: string; layer: unknown }[]>`SELECT id, layer FROM starred_items`;
report(
  "starred_items.layer",
  starred.map((r) => ({ id: r.id, errors: validateLayer(r.layer, "layer", "lenient") })),
  starred.length
);

const missingFormat = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM projects WHERE NOT doc ? 'format'`;
const n = Number(missingFormat[0].n);
if (n > 0) {
  console.log(`\n${n} project(s) predate the multi-format change and have no \`format\` key.`);
  if (fixFormat) {
    await sql`UPDATE projects SET doc = jsonb_set(doc, '{format}', '"youtube"') WHERE NOT doc ? 'format'`;
    console.log("Backfilled to \"youtube\".");
  } else {
    console.log("Re-run with --fix-format to backfill them to \"youtube\".");
  }
}

await sql.end();
