import { describe, expect, it } from "bun:test";
import { dataUrlBytes, defaultFileName, fileNameFor, fitToLimit, type Encoder } from "./export";

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

describe("fileNameFor", () => {
  it("matches the extension to what was encoded", () => {
    expect(fileNameFor("cover.png", "jpeg")).toBe("cover.jpg");
    expect(fileNameFor("cover.jpg", "png")).toBe("cover.png");
    expect(fileNameFor("cover", "png")).toBe("cover.png");
  });
});

describe("fitToLimit", () => {
  /** A data URL of a given payload size, so the ladder can be driven with exact byte counts. */
  const urlOf = (bytes: number) => "data:image/png;base64," + "A".repeat(Math.ceil((bytes * 4) / 3));

  /** Encoder whose output shrinks with quality — the shape a real JPEG encoder has. */
  const encoder = (pngBytes: number, jpegAt: Record<number, number>): { encode: Encoder; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      encode: async (kind, quality) => {
        calls.push(kind === "png" ? "png" : `jpeg@${quality}`);
        return urlOf(kind === "png" ? pngBytes : jpegAt[quality!]);
      },
    };
  };

  it("keeps the PNG when it fits, and doesn't encode anything else", async () => {
    const { encode, calls } = encoder(1_000, {});
    const out = await fitToLimit(encode, 2_000);
    expect(out.kind).toBe("png");
    expect(calls).toEqual(["png"]);
  });

  it("keeps the PNG when the platform has no limit at all", async () => {
    const { encode } = encoder(50_000_000, {});
    expect((await fitToLimit(encode, undefined)).kind).toBe("png");
  });

  it("falls to the highest-quality JPEG that fits, then stops", async () => {
    const { encode, calls } = encoder(3_000, { 0.92: 2_500, 0.8: 1_800, 0.68: 900, 0.55: 500 });
    const out = await fitToLimit(encode, 2_000);
    expect(out).toMatchObject({ kind: "jpeg", quality: 0.8 });
    expect(calls).toEqual(["png", "jpeg@0.92", "jpeg@0.8"]); // 0.68 and 0.55 never rendered
  });

  it("returns the smallest attempt when nothing fits, rather than nothing", async () => {
    const { encode } = encoder(9_000, { 0.92: 8_000, 0.8: 7_000, 0.68: 6_000, 0.55: 5_000 });
    const out = await fitToLimit(encode, 1_000);
    expect(out).toMatchObject({ kind: "jpeg", quality: 0.55 });
    expect(out.bytes).toBeGreaterThan(1_000); // caller warns; the file still downloads
  });

  it("keeps an oversized PNG when JPEG is off — a transparent design must not be flattened", async () => {
    const { encode, calls } = encoder(9_000, { 0.92: 100, 0.8: 100, 0.68: 100, 0.55: 100 });
    const out = await fitToLimit(encode, 1_000, false);
    expect(out.kind).toBe("png");
    expect(calls).toEqual(["png"]); // the ladder is never entered, however well it would fit
  });

  it("measures payload bytes, not string length", () => {
    expect(dataUrlBytes(urlOf(1_200))).toBeCloseTo(1_200, -1);
  });
});
