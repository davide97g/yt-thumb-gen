// The document-format contract test.
//
// This is the gate that stops a bad generated schema from reaching production and breaking
// the editor's ability to save. If the schema ever gets stricter than what the app actually
// produces, one of these fails long before a user does.

import { describe, expect, test } from "bun:test";
import { docWarnings, validateDoc, validateLayer } from "../server/src/validate";
import { adaptDocToFormat } from "./lib/adapt";
import { TEMPLATE_LABELS, TEMPLATES } from "./presets";
import {
  FORMATS,
  type FormatKey,
  newBrandLayer,
  newDrawLayer,
  newEffectLayer,
  newEmojiFxLayer,
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
} from "./state";

const formats = Object.keys(FORMATS) as FormatKey[];
const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe("templates satisfy the published schema", () => {
  for (const key of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
    test(`${key} (${TEMPLATE_LABELS[key]})`, () => {
      expect(validateDoc(wire(TEMPLATES[key]()))).toEqual([]);
    });

    // adaptDocToFormat rescales every layer; a schema with hard min/max bounds would start
    // rejecting docs here even though the editor produces them happily.
    for (const format of formats) {
      test(`${key} adapted to ${format}`, () => {
        expect(validateDoc(wire(adaptDocToFormat(TEMPLATES[key](), format)))).toEqual([]);
      });
    }
  }
});

describe("layer factories satisfy the published schema", () => {
  const factories = {
    text: newTextLayer(),
    image: newImageLayer(),
    brand: newBrandLayer("logo"),
    wordmark: newBrandLayer("wordmark"),
    emoji: newEmojiLayer(),
    emojifx: newEmojiFxLayer(),
    effect: newEffectLayer(),
    rect: newShapeLayer("rect"),
    pill: newShapeLayer("pill"),
    bar: newShapeLayer("bar"),
    draw: newDrawLayer([
      { x: 10, y: 10 },
      { x: 90, y: 60 },
    ]),
  };
  for (const [name, layer] of Object.entries(factories)) {
    test(name, () => expect(validateLayer(wire(layer), "layer", "lenient")).toEqual([]));
  }
});

describe("rejects malformed documents with one actionable error", () => {
  test("wrong field type names the layer and field", () => {
    const doc = wire(TEMPLATES.dacoder()) as any;
    doc.layers[1].size = "96";
    const errors = validateDoc(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("layers[1]");
    expect(errors[0]).toContain("size");
  });

  test("unknown layer type lists the valid ones", () => {
    const doc = wire(TEMPLATES.dacoder()) as any;
    doc.layers[0].type = "txt";
    expect(validateDoc(doc)).toEqual([
      'layers[0].type must be one of text | image | emoji | shape | effect | draw | emojifx (got "txt")',
    ]);
  });

  test("missing format is reported against the enum", () => {
    const doc = wire(TEMPLATES.dacoder()) as any;
    delete doc.format;
    expect(validateDoc(doc).join()).toContain("format must be one of");
  });

  test("a non-object is not a document", () => {
    expect(validateDoc(42)).toEqual(["document must be an object"]);
  });
});

describe("unknown keys warn but never block", () => {
  test("a typo is reported by name and does not invalidate the doc", () => {
    const doc = wire(TEMPLATES.dacoder()) as any;
    doc.layers[0].colour = "#fff";
    expect(validateDoc(doc)).toEqual([]);
    expect(docWarnings(doc).join()).toContain("colour");
  });

  test("a clean doc warns about nothing", () => {
    expect(docWarnings(wire(TEMPLATES.minimal()))).toEqual([]);
  });
});
