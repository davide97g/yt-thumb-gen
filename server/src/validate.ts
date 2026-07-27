// Document validation against the published JSON Schema (server/src/generated/).
//
// The point of this module is ERROR QUALITY, not just accept/reject. `Layer` is a 7-branch
// anyOf; validating a doc against it wholesale makes ajv report every branch's failure, so
// one wrong field yields ~40 errors dominated by "must be equal to constant" noise with the
// real problem buried. An agent cannot self-correct from that.
//
// So we never validate the union. We read the discriminator (`type` on a layer, `preset` on
// an effect, `kind` on a text fx) and run only the matching branch's validator, prefixing the
// error path. One bad field produces one actionable message.

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import schema from "./generated/thumbdoc.schema.json";

const LAYER_TYPES = ["text", "image", "emoji", "shape", "effect", "draw", "emojifx"] as const;
type LayerType = (typeof LAYER_TYPES)[number];

const DEFINITION: Record<LayerType, string> = {
  text: "TextLayer",
  image: "ImageLayer",
  emoji: "EmojiLayer",
  shape: "ShapeLayer",
  effect: "EffectLayer",
  draw: "DrawLayer",
  emojifx: "EmojiFxLayer",
};

/** Deep copy with `additionalProperties: false` forced on every object schema. Used for the
 *  advisory pass: unknown keys are a typo signal (`colour`, `fontSize`) that would otherwise
 *  be stored and silently ignored by the renderer. */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = strictify(v);
  if (out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function compile(strict: boolean) {
  // allowUnionTypes: the model uses `string | null` in several places.
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  ajv.addSchema(strict ? (strictify(schema) as object) : (schema as object), "thumbdoc");
  const get = (name: string): ValidateFunction => {
    const fn = ajv.getSchema(`thumbdoc#/definitions/${name}`);
    if (!fn) throw new Error(`schema is missing #/definitions/${name}`);
    return fn;
  };
  return {
    background: get("Background"),
    layer: Object.fromEntries(LAYER_TYPES.map((t) => [t, get(DEFINITION[t])])) as Record<LayerType, ValidateFunction>,
  };
}

const lenient = compile(false);
const strict = compile(true);

const FORMATS = (schema as any).definitions?.FormatKey?.enum as string[] | undefined;

function render(prefix: string, errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const where = e.instancePath ? `${prefix}${e.instancePath}` : prefix;
    const p = e.params as Record<string, any> | undefined;
    let detail = "";
    // `missingProperty` is deliberately not appended — ajv's message already names it.
    if (p && "allowedValues" in p) detail = ` (${p.allowedValues.join(" | ")})`;
    else if (p && "additionalProperty" in p) detail = `: ${p.additionalProperty}`;
    return `${where} ${e.message}${detail}`;
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates one layer against its own branch. Exported so POST /api/starred, which stores a
 *  bare Layer, is held to the same contract as a layer inside a doc. */
export function validateLayer(layer: unknown, prefix: string, mode: "lenient" | "strict"): string[] {
  if (!isObj(layer)) return [`${prefix} must be an object`];
  const type = layer.type;
  if (typeof type !== "string" || !(LAYER_TYPES as readonly string[]).includes(type)) {
    return [`${prefix}.type must be one of ${LAYER_TYPES.join(" | ")} (got ${JSON.stringify(type)})`];
  }
  const validator = (mode === "strict" ? strict : lenient).layer[type as LayerType];
  return validator(layer) ? [] : render(`${prefix} (${type})`, validator.errors);
}

function check(doc: unknown, mode: "lenient" | "strict"): string[] {
  if (!isObj(doc)) return ["document must be an object"];
  const errors: string[] = [];

  if (FORMATS && !FORMATS.includes(doc.format as string)) {
    errors.push(`format must be one of ${FORMATS.join(" | ")} (got ${JSON.stringify(doc.format)})`);
  }

  const bg = (mode === "strict" ? strict : lenient).background;
  if (!bg(doc.background)) errors.push(...render("background", bg.errors));

  if (!Array.isArray(doc.layers)) {
    errors.push("layers must be an array");
    return errors;
  }
  doc.layers.forEach((layer, i) => errors.push(...validateLayer(layer, `layers[${i}]`, mode)));
  return errors;
}

/** Hard errors — the document is not a valid ThumbDoc. */
export const validateDoc = (doc: unknown): string[] => check(doc, "lenient");

/** Advisory: keys the schema doesn't know about. Never blocks a write, but surfacing them is
 *  the difference between an agent debugging blind and self-correcting after a typo. */
export function docWarnings(doc: unknown): string[] {
  return check(doc, "strict")
    .filter((e) => e.includes("must NOT have additional properties"))
    .slice(0, 20);
}

/** `warn` logs and allows; `enforce` rejects with 422. Default is `warn` so validation can be
 *  observed against real traffic before it starts turning saves into failures. */
export const MODE = process.env.THUMBDOC_VALIDATE === "enforce" ? "enforce" : "warn";

export { schema };
