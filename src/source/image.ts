/** Exact Markdown caption span for one standalone inline image. The Pandoc
 * proof remains responsible for confirming that the entire block is an image.
 */
export const IMAGE_CODEC_VERSION = 1;
export interface ImageCaptionSyntax {
  start: number;
  end: number;
  caption: string;
}
export function imageCaptionSyntax(
  raw: string,
): ImageCaptionSyntax | undefined {
  const opening = /^ {0,3}!\[/.exec(raw);
  if (!opening) return undefined;
  const start = opening[0].length;
  let depth = 1;
  for (let index = start; index < raw.length; index++) {
    const character = raw[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "`") {
      const run = /^`+/.exec(raw.slice(index))![0];
      let close = index + run.length;
      while (close < raw.length) {
        const next = raw.indexOf("`", close);
        if (next < 0) return undefined;
        const candidate = /^`+/.exec(raw.slice(next))![0];
        if (candidate.length === run.length) {
          index = next + run.length - 1;
          break;
        }
        close = next + candidate.length;
      }
      if (close >= raw.length) return undefined;
      continue;
    }
    if (character === "[") depth++;
    if (character === "]" && --depth === 0) {
      if (raw[index + 1] !== "(") return undefined;
      return {
        start: new TextEncoder().encode(raw.slice(0, start)).length,
        end: new TextEncoder().encode(raw.slice(0, index)).length,
        caption: raw.slice(start, index),
      };
    }
  }
  return undefined;
}
