/**
 * Bounded authored display-LaTeX codec for the pinned Bento text renderer.
 * Stores source text, never MathML, scripts, computed output or renderer state.
 */
import { StateError } from "../state/mod.ts";
import { escapeHtml } from "./html.ts";

export const MATH_CODEC_VERSION = 1;
const MAX_TEX = 16_000;
const MAX_LINES = 16;
const MAX_DEPTH = 64;
function fail(message: string): never {
  throw new StateError("UNSUPPORTED_MATH", message);
}
const symbols = new Set((
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega " +
  "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
  "cdot times div pm mp le ge leq geq ne neq approx equiv sim simeq cong to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto " +
  "in notin ni subset supset subseteq supseteq cup cap emptyset varnothing forall exists neg land lor infty partial nabla ell hbar Re Im " +
  "sum prod coprod int iint iiint oint sin cos tan cot sec csc sinh cosh tanh exp log ln lim min max sup inf det Pr " +
  "quad qquad ldots cdots vdots ddots angle perp parallel mid lvert rvert lVert rVert langle rangle"
).split(" "));
const argumentCounts: Record<string, number> = {
  frac: 2,
  dfrac: 2,
  tfrac: 2,
  binom: 2,
  sqrt: 1,
  text: 1,
  textrm: 1,
  textbf: 1,
  textit: 1,
  mathrm: 1,
  mathbf: 1,
  mathit: 1,
  mathsf: 1,
  mathtt: 1,
  mathbb: 1,
  mathcal: 1,
  mathfrak: 1,
  boldsymbol: 1,
  operatorname: 1,
  hat: 1,
  widehat: 1,
  bar: 1,
  overline: 1,
  vec: 1,
  dot: 1,
  ddot: 1,
  tilde: 1,
  widetilde: 1,
  underline: 1,
  underbrace: 1,
  overbrace: 1,
};
const environments = new Set([
  "aligned",
  "gathered",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "cases",
  "smallmatrix",
]);
const escaped = new Set([
  "{",
  "}",
  "$",
  "%",
  "_",
  "&",
  "#",
  " ",
  ",",
  ";",
  ":",
  "!",
  "|",
]);
type Token = { value: string; command: boolean };
/** A deliberately small syntax vocabulary, not an independent TeX renderer. */
function validateTex(tex: string): void {
  if (
    !tex.trim() || tex.length > MAX_TEX || tex.split("\n").length > MAX_LINES ||
    Array.from(tex).some((c) => {
      const point = c.codePointAt(0)!;
      return (point < 32 && point !== 9 && point !== 10) || point === 127 ||
        point === 0xE000;
    }) ||
    !tex.isWellFormed() || /\{\{[<%]/.test(tex) ||
    /\{\{\s*(?:page|pages|title|date|time|author|company|subject|event)(?::[^}]*)?\s*\}\}/i
      .test(tex) ||
    /^(?:\s*typst:)/.test(tex) || /[`\u00a0]/.test(tex)
  ) {
    fail(
      "Display math must be bounded literal LaTeX without fields, controls, Typst or executable Markdown.",
    );
  }
  const tokens: Token[] = [];
  for (let i = 0; i < tex.length;) {
    const c = tex[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "$" || c === "%") {
      fail(
        "Unescaped dollars and TeX comments are outside the display-math subset.",
      );
    }
    if (c !== "\\") {
      tokens.push({ value: c, command: false });
      i++;
      continue;
    }
    const match = /^\\([A-Za-z]+|[^\n])/u.exec(tex.slice(i));
    if (!match) fail("A LaTeX command is incomplete.");
    tokens.push({ value: match[1], command: true });
    i += match[0].length;
  }
  let at = 0, depth = 0;
  const left: { depth: number; environments: number }[] = [];
  const opened: { name: string; depth: number; left: number }[] = [];
  function group(): void {
    if (tokens[at]?.command || tokens[at]?.value !== "{") {
      fail("This LaTeX command requires a braced argument.");
    }
    at++;
    if (++depth > MAX_DEPTH) fail("LaTeX groups are nested too deeply.");
    const start = at;
    sequence(true);
    if (at === start + 1) {
      fail("Empty LaTeX groups need explicit source review.");
    }
    depth--;
  }
  function textGroup(): void {
    if (tokens[at]?.command || tokens[at]?.value !== "{") {
      fail("Text in math requires a braced argument.");
    }
    at++;
    let nested = 1, count = 0;
    while (tokens[at] && nested) {
      const token = tokens[at++];
      if (token.command) {
        if (!symbols.has(token.value) && !escaped.has(token.value)) {
          fail("Unsupported command inside literal math text.");
        }
      } else if (token.value === "{") {
        if (++nested + depth > MAX_DEPTH) {
          fail("Math text is nested too deeply.");
        }
      } else if (token.value === "}") nested--;
      count++;
    }
    if (nested || count === 1) fail("Math text is empty or unclosed.");
  }
  function environmentName(): string {
    if (tokens[at]?.command || tokens[at]?.value !== "{") {
      fail("A math environment needs a braced name.");
    }
    at++;
    let name = "";
    while (
      tokens[at] && !tokens[at].command && /^[A-Za-z]$/.test(tokens[at].value)
    ) name += tokens[at++].value;
    if (
      tokens[at]?.command || tokens[at]?.value !== "}" ||
      !environments.has(name)
    ) fail("Unsupported or malformed math environment.");
    at++;
    return name;
  }
  function atom(script = false): void {
    const token = tokens[at++];
    if (!token || (!token.command && ["}", "^", "_"].includes(token.value))) {
      fail("A LaTeX group or script is incomplete.");
    }
    if (!token.command) {
      if (token.value === "{") {
        at--;
        group();
      }
      if (
        token.value === "&" &&
        (!opened.length || opened.at(-1)!.depth !== depth ||
          opened.at(-1)!.left !== left.length)
      ) fail("Math alignment is allowed only in a supported environment cell.");
      return;
    }
    const command = token.value;
    if (command === "begin" || command === "end") {
      if (script) fail("A math environment cannot be a script argument.");
      const name = environmentName();
      if (command === "begin") opened.push({ name, depth, left: left.length });
      else {
        const previous = opened.pop();
        if (!previous || previous.name !== name || previous.depth !== depth) {
          fail("Math environment boundaries do not match.");
        }
      }
      return;
    }
    if (command === "left" || command === "right") {
      if (script) fail("A scalable delimiter cannot be a script argument.");
      const delimiter = tokens[at++];
      if (
        !delimiter || !(delimiter.command
          ? [
            "{",
            "}",
            "|",
            "langle",
            "rangle",
            "lvert",
            "rvert",
            "lVert",
            "rVert",
          ].includes(delimiter.value)
          : ["(", ")", "[", "]", "|", "."].includes(delimiter.value))
      ) fail("Unsupported scalable math delimiter.");
      if (command === "left") left.push({ depth, environments: opened.length });
      else {
        const previous = left.pop();
        if (
          !previous || previous.depth !== depth ||
          previous.environments !== opened.length
        ) {
          fail(
            "Scalable delimiters cannot cross a group or environment boundary.",
          );
        }
      }
      return;
    }
    if (command === "\\") {
      if (
        script || !opened.length || opened.at(-1)!.depth !== depth ||
        opened.at(-1)!.left !== left.length
      ) {
        fail("Math row breaks require a supported environment.");
      }
      return;
    }
    if (["text", "textrm", "operatorname"].includes(command)) {
      textGroup();
      return;
    }
    const args = argumentCounts[command];
    if (args) {
      for (let i = 0; i < args; i++) group();
      return;
    }
    if (!symbols.has(command) && !escaped.has(command)) {
      fail(
        `LaTeX command \\${command} needs an explicit supported projection.`,
      );
    }
  }
  function sequence(inGroup = false): void {
    while (at < tokens.length) {
      if (!tokens[at].command && tokens[at].value === "}") {
        if (!inGroup) fail("A LaTeX closing brace has no matching opener.");
        if (
          left.some((frame) => frame.depth >= depth) ||
          opened.some((frame) => frame.depth >= depth)
        ) {
          fail(
            "A math group cannot close before its delimiter or environment.",
          );
        }
        at++;
        return;
      }
      atom();
      const scripts = new Set<string>();
      while (
        tokens[at] && !tokens[at].command &&
        ["^", "_"].includes(tokens[at].value)
      ) {
        const script = tokens[at++].value;
        if (scripts.has(script)) fail("A math atom has duplicate scripts.");
        scripts.add(script);
        atom(true);
      }
    }
    if (inGroup) fail("A LaTeX group is unclosed.");
  }
  sequence();
  if (opened.length || left.length) {
    fail("A math environment or scalable delimiter is unclosed.");
  }
}
function normalizeTex(tex: string): { tex: string; normalized: boolean } {
  if (tex.length > MAX_TEX) fail("LaTeX exceeds the supported size.");
  const normalized = tex.replace(/\r\n|\r/g, "\n").trim();
  validateTex(normalized);
  return { tex: normalized, normalized: normalized !== tex };
}
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:([^;\s]+);|(?=[A-Za-z#]))/g,
    (whole, name?: string) => {
      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: "\u00a0",
      };
      if (name && Object.hasOwn(entities, name)) return entities[name];
      if (name && /^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
        const point = name[1].toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
        if (
          point > 0 && point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
        ) return String.fromCodePoint(point);
      }
      return fail(`Unsupported or invalid math HTML entity ${whole}.`);
    },
  );
}
/** Accept native editor line breaks, never attributes or other HTML content. */
function lineText(html: string): string {
  if (html.length > MAX_TEX * 8) fail("Math HTML exceeds the supported size.");
  let text = "", kind = "", open = "", count = 0;
  for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
    if (!token.startsWith("<")) {
      text += decodeEntities(token);
      continue;
    }
    if (++count > 40) fail("Math HTML contains too many line-break tags.");
    if (/^<br\s*\/?\s*>$/i.test(token)) {
      text += "\n";
      continue;
    }
    const block = /^<(\/?)(div|p)>$/i.exec(token);
    if (!block) {
      fail(
        "Math sync accepts only one formula and attribute-free br/div/p line breaks.",
      );
    }
    const tag = block[2].toLowerCase();
    if (kind && kind !== tag) {
      fail("A formula cannot mix div and p line blocks.");
    }
    kind = tag;
    if (!block[1]) {
      if (open) fail("Nested math line blocks need explicit source review.");
      open = tag;
      if (text && !text.endsWith("\n")) text += "\n";
    } else {
      if (open !== tag) fail("Math line blocks are unbalanced.");
      open = "";
      if (!text.endsWith("\n")) text += "\n";
    }
  }
  if (open) fail("Math line blocks are unclosed.");
  return text;
}
export interface NativeDisplayMath {
  /** Formula body suitable for an existing SourceBlock.contentSpan patch. */
  tex: string;
  /** Canonical native text.html, still containing literal LaTeX. */
  html: string;
  /** Complete QMD block for an explicitly reviewed insertion. */
  source: string;
  /** Boundary whitespace/line-end changes require the caller's normal review. */
  normalized: boolean;
}
export function mathToNativeHtml(tex: string, display = true): string {
  if (!display) fail("Inline math is outside this display-object codec.");
  const literal = normalizeTex(tex).tex;
  return `$$${escapeHtml(literal).replaceAll("\n", "<br>")}$$`;
}
export function parseNativeDisplayMath(html: string): NativeDisplayMath {
  const text = lineText(html).replace(/\r\n|\r/g, "\n").trim();
  let body: string;
  if (text.startsWith("$$") && text.endsWith("$$")) body = text.slice(2, -2);
  else if (text.startsWith("\\[") && text.endsWith("\\]")) {
    body = text.slice(2, -2);
  } else {fail(
      "Math sync requires exactly one standalone display formula ($$…$$ or \\[…\\]).",
    );}
  // These token pairs can close the native delimiter or broaden the source block.
  if (/\\[()[\]]/.test(body)) {
    fail("Nested or alternate math delimiters need explicit source review.");
  }
  const literal = normalizeTex(body);
  return {
    tex: literal.tex,
    html: mathToNativeHtml(literal.tex),
    source: `$$\n${literal.tex}\n$$`,
    normalized: literal.normalized || /\r/.test(html),
  };
}
export function nativeDisplayMathToSource(html: string): string {
  return parseNativeDisplayMath(html).source;
}
