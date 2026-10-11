/** Versioned JSON-only persistence contract; no upstream runtime dependency. */
export type Json = null | boolean | number | string | Json[] | {
  [key: string]: Json;
};
export interface JsonObject {
  [key: string]: Json;
}
export interface BentoElement extends JsonObject {
  id: string;
  type: string;
}
export interface BentoSlide extends JsonObject {
  id: string;
  elements: BentoElement[];
}
export interface BentoDoc extends JsonObject {
  docId: string;
  slides: BentoSlide[];
}
export interface Target {
  slideId?: string;
  elementId?: string;
}
export interface Value {
  present: boolean;
  value?: Json;
}
export interface Field {
  path: string[];
  value: Value;
}
export type Origin = "authored" | "computed" | "bento-only" | "detached";
export interface Provenance {
  origin: Origin;
  semanticId?: string;
  producer?: string;
  source?: JsonObject;
}
/** Key with targetKey({slideId, elementId}); '/'-separated paths also accepted in ownership. */
export type ProvenanceMap = Record<string, Provenance>;
export type OwnershipMap = Record<string, string[]>;
export interface Override {
  target: Target;
  fields: Field[];
}
export interface Change {
  id: string;
  target: Target;
  path: string[];
  kind:
    | "field"
    | "create-slide"
    | "create-element"
    | "delete-slide"
    | "delete-element"
    | "slide-order"
    | "orphan";
  origin: Origin;
  status: "bento-ahead" | "conflict" | "bento-only";
  before: Value;
  after: Value;
  source?: Value;
  reason?: string;
}
export interface ProjectState {
  schemaVersion: 1;
  revision: number;
  docId: string;
  generatedBaseline: BentoDoc;
  emitted: BentoDoc;
  provenance: ProvenanceMap;
  ownership: OwnershipMap;
  overrides: Override[];
  elementOrders: { slideId: string; ids: string[] }[];
  bentoOnly: { slideId: string; element: BentoElement }[];
  pending: Change[];
  output?: { path: string; sha256: string };
}
export class StateError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "StateError";
  }
}
