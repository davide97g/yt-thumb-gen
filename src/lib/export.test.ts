import { describe, expect, it } from "bun:test";
import { defaultFileName } from "./export";

describe("defaultFileName", () => {
  it("names the PNG after the project", () => {
    expect(defaultFileName("stop-reading-code")).toBe("stop-reading-code.png");
  });

  it("turns spaces into dashes and drops path-hostile characters", () => {
    expect(defaultFileName("Stop Reading Code")).toBe("Stop-Reading-Code.png");
    expect(defaultFileName("QA: code/review?")).toBe("QA--code-review.png");
  });

  it("does not double the extension", () => {
    expect(defaultFileName("cover.png")).toBe("cover.png");
  });

  it("falls back for untitled or empty names", () => {
    expect(defaultFileName("Senza titolo")).toBe("thumb.png");
    expect(defaultFileName("   ")).toBe("thumb.png");
    expect(defaultFileName("...")).toBe("thumb.png");
  });
});
