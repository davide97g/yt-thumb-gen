import { expect, test } from "bun:test";
import { z } from "zod";

import { docInput } from "./tools";

const schema = docInput("a doc");

test("a doc sent as an object passes through", () => {
  expect(schema.parse({ format: "youtube", layers: [] })).toEqual({ format: "youtube", layers: [] });
});

test("a doc sent as a JSON string is parsed — clients do stringify untyped arguments", () => {
  expect(schema.parse('{"format":"youtube","layers":[]}')).toEqual({ format: "youtube", layers: [] });
});

test("the published JSON Schema declares an object, so clients stop stringifying", () => {
  const json = z.toJSONSchema(z.object({ doc: schema }), { io: "input" }) as unknown as {
    properties: { doc: { type?: string } };
  };
  expect(json.properties.doc.type).toBe("object");
});
