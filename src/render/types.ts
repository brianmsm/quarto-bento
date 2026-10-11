export type Json = null | boolean | number | string | Json[] | {
  [key: string]: Json;
};
export interface Element {
  id: string;
  type: string;
  [key: string]: Json;
}
export interface Slide {
  id: string;
  elements: Element[];
  [key: string]: Json | Element[];
}
export interface BentoDoc {
  format: "bento/slides";
  version: number;
  docId: string;
  title: string;
  size: { width: number; height: number };
  theme: {
    background: string;
    color: string;
    accent: string;
    fontFamily: string;
  };
  slides: Slide[];
}
export interface Diagnostic {
  code: string;
  message: string;
  elementId?: string;
  slideId?: string;
  /** Original managed design reference; minimal traces identify the directory only. */
  reference?: string;
}
export interface Origin {
  origin: "authored" | "computed";
  sourceId?: string;
  producer?: string;
  /** A generated design-only background verified against an original card or KPI div. */
  designOnly?: true;
  /** Exact bounded source graph role/relationship receipt, verified before persistence. */
  graph?: Json;
  /** Stable content receipt from a fresh, source-checked static table capture. */
  richTable?: Json;
}
export interface Projection {
  document: BentoDoc;
  origins: Record<string, Record<string, Origin>>;
  diagnostics: Diagnostic[];
  notes?: Record<string, { sourceId: string; codec: number }>;
  kpiAppearanceRescues?: { slideId: string; elementIds: string[] }[];
  design?: Record<
    string,
    Record<string, {
      ownedPaths: string[];
      bindings: Record<string, { sourceId: string; attribute: string }>;
    }>
  >;
}
// Pandoc JSON is validated by individual handlers; unknown nodes fail explicitly.
export interface Node {
  t: string;
  c?: unknown;
}
export interface Ast {
  blocks: Node[];
  meta: Record<string, { t: string; c: unknown }>;
}
