/** Self-contained so the native bootstrap can embed this function without a runtime dependency. */
export function pngCameraMetadata(
  png: string,
  metadata?: unknown,
): { png: string; metadata?: unknown } {
  const prefix = "data:image/png;base64,";
  const reject = (): never => {
    throw new Error("Invalid PNG camera metadata");
  };
  if (!png.startsWith(prefix) || png.length > 12_000_022) reject();
  const encoded = png.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) reject();
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return reject();
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (
    bytes.length < 57 || bytes.slice(0, 8).join() !== "137,80,78,71,13,10,26,10"
  ) reject();
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (value: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of value) c = table[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const view = new DataView(bytes.buffer), keyword = "qbento-camera\0";
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
  let result: unknown, found = false, ended = false, count = 0;
  for (let offset = 8; offset < bytes.length;) {
    if (++count > 100000 || offset + 12 > bytes.length) reject();
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) reject();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      crc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    ) reject();
    if (count === 1 && (type !== "IHDR" || length !== 13)) reject();
    const data = bytes.subarray(offset + 8, end - 4);
    const isCamera = type === "tEXt" && data.length >= keyword.length &&
      keyword.split("").every((c, i) => data[i] === c.charCodeAt(0));
    if (isCamera) {
      if (found || data.length > keyword.length + 4096) reject();
      found = true;
      try {
        result = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            data.subarray(keyword.length),
          ),
        );
      } catch {
        reject();
      }
    }
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) reject();
      ended = true;
      if (metadata !== undefined) {
        let payload: Uint8Array;
        try {
          payload = new TextEncoder().encode(
            JSON.stringify(metadata).replace(
              /[^\x20-\x7e]/g,
              (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
            ),
          );
        } catch {
          return reject();
        }
        if (!payload.length || payload.length > 4096) reject();
        const chunk = new Uint8Array(12 + keyword.length + payload.length),
          chunkView = new DataView(chunk.buffer);
        chunkView.setUint32(0, keyword.length + payload.length);
        chunk.set([116, 69, 88, 116], 4);
        for (let i = 0; i < keyword.length; i++) {
          chunk[8 + i] = keyword.charCodeAt(i);
        }
        chunk.set(payload, 8 + keyword.length);
        chunkView.setUint32(
          chunk.length - 4,
          crc(chunk.subarray(4, chunk.length - 4)),
        );
        chunks.push(chunk);
      }
    }
    if (!isCamera || metadata === undefined) {
      chunks.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  if (!ended) reject();
  if (metadata === undefined) {
    return { png, ...(found ? { metadata: result } : {}) };
  }
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (size > 9_000_000) reject();
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  let text = "";
  for (let start = 0; start < output.length; start += 8192) {
    text += String.fromCharCode(...output.subarray(start, start + 8192));
  }
  return { png: prefix + btoa(text), metadata };
}
