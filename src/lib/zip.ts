// A minimal ZIP writer — enough to hand back a folder of images, and no more.
//
// No dependency, because the archive this app needs is the simplest one there is: a handful
// of PNGs and JPEGs, already compressed, so they are *stored* rather than deflated. Storing
// means no compressor at all — the format work is a CRC and two header layouts.
//
// Not implemented, deliberately: deflate, zip64, encryption, directories as entries. The
// limits that follow (4 GB per file, 65535 files) are three orders of magnitude past what a
// campaign of thumbnails will ever hit.

export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Names are stored UTF-8 with the language-encoding flag set, so an emoji in a project name
 *  survives the round trip instead of arriving as mojibake. */
const encodeName = (name: string) => new TextEncoder().encode(name);

/** Builds a stored (uncompressed) ZIP. Entry order is preserved. */
export function zipStore(entries: ZipEntry[]): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encodeName(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header: signature, version 2.0, UTF-8 flag, method 0 (stored), no date.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // bit 11: names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed == uncompressed
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);

    parts.push(new Uint8Array(local.buffer), name, entry.data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true); // stored
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true); // where this entry's local header starts
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // central directory starts after the last entry

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

/** Filesystem-safe file name, with the extension kept. Two designs in a campaign are often
 *  named alike once the campaign prefix is stripped, so callers dedupe with `uniqueName`. */
export function safeFileName(name: string, ext: string): string {
  const base =
    name
      .trim()
      .replace(/[/\\:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80) || "design";
  return `${base}.${ext}`;
}

/** Returns `name`, or `name (2)` etc. when it's already in `taken`. Mutates `taken`. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
