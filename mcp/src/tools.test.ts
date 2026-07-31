import { expect, test } from "bun:test";
import { z } from "zod";

import { decodeImageInput, docInput, projectIdFrom } from "./tools";

const schema = docInput("a doc");

test("a doc sent as an object passes through", () => {
  expect(schema.parse({ format: "youtube", layers: [] })).toEqual({ format: "youtube", layers: [] });
});

test("a doc sent as a JSON string is parsed — clients do stringify untyped arguments", () => {
  expect(schema.parse('{"format":"youtube","layers":[]}')).toEqual({ format: "youtube", layers: [] });
});

const ID = "b2481785-9e5d-4816-bb25-7bd98c8dea48";

test("a bare id passes through untouched", () => {
  expect(projectIdFrom(ID)).toBe(ID);
  expect(projectIdFrom(`  ${ID}  `)).toBe(ID);
});

test("an editor URL yields the id it carries — that's what users copy from the address bar", () => {
  expect(projectIdFrom(`https://thumb.davideghiotto.it/?project=${ID}`)).toBe(ID);
  expect(projectIdFrom(`http://localhost:5174/?project=${ID}&foo=1`)).toBe(ID);
  expect(projectIdFrom(`https://thumb.davideghiotto.it/?project=${ID}#canvas`)).toBe(ID);
  expect(projectIdFrom(`/?project=${ID}`)).toBe(ID);
  expect(projectIdFrom(`?project=${ID}`)).toBe(ID);
});

test("a link without a project param is rejected rather than sent as an id", () => {
  expect(projectIdFrom("https://thumb.davideghiotto.it/")).toBeNull();
  expect(projectIdFrom("https://thumb.davideghiotto.it/?other=1")).toBeNull();
  expect(projectIdFrom("   ")).toBeNull();
});

test("the published JSON Schema declares an object, so clients stop stringifying", () => {
  const json = z.toJSONSchema(z.object({ doc: schema }), { io: "input" }) as unknown as {
    properties: { doc: { type?: string } };
  };
  expect(json.properties.doc.type).toBe("object");
});

// ── upload_image's decoder ──────────────────────────────────────────────────
// One-pixel PNG, the smallest real image to prove bytes survive the round trip.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a data: URL's own media type wins over the argument", () => {
  const out = decodeImageInput(`data:image/jpeg;base64,${PNG_1PX}`, "image/png");
  expect(out).toMatchObject({ contentType: "image/jpeg" });
});

test("bare base64 decodes, defaulting to png", () => {
  const out = decodeImageInput(PNG_1PX);
  if (typeof out === "string") throw new Error(out);
  expect(out.contentType).toBe("image/png");
  expect(out.bytes[0]).toBe(0x89); // PNG magic — the actual bytes came through
  expect(out.bytes.byteLength).toBeGreaterThan(50);
});

test("base64 that travelled through a heredoc or chat message still decodes", () => {
  const wrapped = PNG_1PX.replace(/(.{20})/g, "$1\n  ");
  expect(decodeImageInput(wrapped)).toMatchObject({ contentType: "image/png" });
});

test("non-image content types are refused — a layer source has to be an image", () => {
  expect(decodeImageInput(PNG_1PX, "application/pdf")).toContain("only image/*");
});

test("garbage in gets a message out, not a crash", () => {
  expect(decodeImageInput("   ")).toContain("empty");
  expect(decodeImageInput("not base64 at all!!")).toContain("not valid base64");
  expect(decodeImageInput("data:image/png,%89PNG")).toContain("must be base64");
});

test("an oversized image is refused with the size and the limit", () => {
  const huge = "A".repeat(12 * 1024 * 1024); // ~9 MB decoded, over the 8 MB ceiling
  const out = decodeImageInput(huge);
  expect(out).toContain("MB");
  expect(out).toContain("Downscale");
});
