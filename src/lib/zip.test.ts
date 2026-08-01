import { expect, test } from "bun:test";
import { crc32, safeFileName, uniqueName, zipStore } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

test("crc32 matches the known vector for \"123456789\"", () => {
  // The standard CRC-32 check value. If this drifts, every archive we write is subtly corrupt
  // in a way no local test would notice — unzip would just refuse it.
  expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
});

test("crc32 of nothing is zero", () => {
  expect(crc32(new Uint8Array())).toBe(0);
});

test("the archive carries the ZIP signatures and an entry count", async () => {
  const blob = zipStore([
    { name: "one.txt", data: bytes("hello") },
    { name: "two.txt", data: bytes("world") },
  ]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);

  expect(blob.type).toBe("application/zip");
  expect(view.getUint32(0, true)).toBe(0x04034b50); // first local file header

  // End-of-central-directory sits in the last 22 bytes (no comment).
  const end = buf.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2); // two entries

  // The recorded central-directory offset must actually point at one.
  const centralOffset = view.getUint32(end + 16, true);
  expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
});

test("stored entries keep their bytes verbatim", async () => {
  const buf = new Uint8Array(await zipStore([{ name: "a.txt", data: bytes("payload") }]).arrayBuffer());
  // 30-byte header + 5-byte name, then the data.
  expect(new TextDecoder().decode(buf.slice(35, 42))).toBe("payload");
});

test("an empty archive is still a valid one", async () => {
  const buf = new Uint8Array(await zipStore([]).arrayBuffer());
  expect(buf.length).toBe(22);
  expect(new DataView(buf.buffer).getUint32(0, true)).toBe(0x06054b50);
});

// Written to disk and handed to the system's own unzip: the only check that proves the
// header layout is right rather than merely self-consistent.
const unzip = Bun.which("unzip");
test.skipIf(!unzip)("the system unzip accepts the archive and reads the files back", async () => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/thumb-zip-test-${crc32(bytes(String(process.pid)))}`;
  const path = `${dir}/out.zip`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  try {
    await Bun.write(
      path,
      zipStore([
        { name: "first.txt", data: bytes("one") },
        { name: "nested name (2).txt", data: bytes("two") },
      ])
    );
    // -t verifies every entry's CRC against its stored bytes.
    const test = await Bun.$`unzip -t ${path}`.quiet();
    expect(test.exitCode).toBe(0);

    await Bun.$`unzip -o -q ${path} -d ${dir}`.quiet();
    expect(await Bun.file(`${dir}/first.txt`).text()).toBe("one");
    expect(await Bun.file(`${dir}/nested name (2).txt`).text()).toBe("two");
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("file names are made filesystem-safe without losing the extension", () => {
  expect(safeFileName("QA: code/review?", "png")).toBe("QA--code-review.png");
  expect(safeFileName("   ", "jpg")).toBe("design.jpg");
});

test("colliding names get numbered rather than overwriting each other", () => {
  const taken = new Set<string>();
  expect(uniqueName("a.png", taken)).toBe("a.png");
  expect(uniqueName("a.png", taken)).toBe("a (2).png");
  expect(uniqueName("a.png", taken)).toBe("a (3).png");
  expect(uniqueName("b.png", taken)).toBe("b.png");
});
