import { isAbsolute, relative, resolve } from "node:path";
export async function assetData(
  src: string,
  assetRoots: string[],
): Promise<string> {
  // UNC and device paths must refuse before realPath can contact a share on Windows.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/\\]{2}/.test(src)) {
    throw new Error("EXTERNAL_ASSET: local bundled image required");
  }
  try {
    src = decodeURIComponent(src);
  } catch {
    throw new Error("INVALID_ASSET_PATH: malformed escaped local image path");
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/\\]{2}/.test(src) ||
    src.includes("\0")
  ) throw new Error("EXTERNAL_ASSET: local bundled image required");
  for (const root of assetRoots) {
    try {
      const candidate = resolve(root, src);
      const lexical = relative(resolve(root), candidate);
      if (
        lexical === ".." || lexical.startsWith("../") ||
        lexical.startsWith("..\\") || isAbsolute(lexical)
      ) continue;
      const actual = await Deno.realPath(candidate);
      const rel = relative(await Deno.realPath(root), actual);
      if (
        rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") ||
        isAbsolute(rel)
      ) continue;
      const bytes = await Deno.readFile(actual);
      const extension = actual.split(".").pop()?.toLowerCase();
      const mime = ({
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
      } as Record<string, string>)[extension || ""];
      if (!mime) {
        throw new Error("UNSUPPORTED_ASSET: image format is not supported");
      }
      if (extension === "svg") {
        const text = new TextDecoder().decode(bytes);
        if (
          /<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)|<!ENTITY/i
            .test(text)
        ) {
          throw new Error(
            "UNSAFE_SVG: scripts, external references and entities are not supported",
          );
        }
      }
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `data:${mime};base64,${btoa(binary)}`;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  throw new Error(
    `MISSING_ASSET: ${src} is not within the source/build directory`,
  );
}
