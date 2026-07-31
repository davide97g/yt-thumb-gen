import { expect, test } from "bun:test";
import { z } from "zod";

import { docInput, projectIdFrom } from "./tools";

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
