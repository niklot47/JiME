// TypeScript mirror of schemas/*.schema.json. Keep both in sync; bump FORMAT_VERSION on breaking changes.

export const FORMAT_VERSION = 1;

export type Localized = string | Record<string, string>;

export type ContentType = "scenario" | "lang" | "voice" | "theme" | "models" | "rules";

export interface PackContent {
  type: ContentType;
  /** Path relative to the pack root (file or directory) */
  path: string;
  /** Required for lang and voice content */
  lang?: string;
}

export interface PackManifest {
  $schema?: string;
  formatVersion: 1;
  id: string;
  name?: Localized;
  description?: Localized;
  version: string;
  /** Higher priority overrides lower on conflicting keys/ids */
  priority: number;
  origin?: "ffg-import" | "community" | "generated" | "user";
  authors?: string[];
  dependencies?: Record<string, string>;
  contents: PackContent[];
}

// ---------- scenario (FFG prefab + PlayMaker FSM) ----------

export type FsmVarValue = number | string | boolean | null | Record<string, unknown> | unknown[];

export interface FsmAction {
  action: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface FsmState {
  name: string;
  transitions: Record<string, string>;
  actions: FsmAction[];
}

export interface Fsm {
  name: string;
  start: string;
  go: number;
  variables: Record<string, FsmVarValue>;
  global: Record<string, string>;
  states: FsmState[];
}

export interface GameObject {
  name: string;
  parent: number | null;
  components: Record<string, unknown>;
}

export interface ScenarioFile {
  $schema?: string;
  format: "jime-scenario";
  formatVersion: 1;
  kind: "adventure" | "encounter";
  id: number | string;
  source?: "ffg" | "custom";
  root: number;
  model: Record<string, unknown>;
  gameObjects: Record<string, GameObject>;
  fsms: Fsm[];
  ext?: Record<string, unknown>;
}

// ---------- content database ----------

export interface TileSpace {
  traits: number;
  connected: number[];
}

export interface GlobalVar {
  type: "bool" | "int" | "float" | "string" | "vector3" | "array";
  value: unknown;
}

/** Tile geometry for the map generator (cube hex coords, spaces, outside edges with EdgeTraits) */
export interface TileGeometry {
  code: string;
  hexes: { x: number; y: number; z: number; space: number }[];
  spaces: { traits: number; hexes: number[]; connected: number[] }[];
  edges: { hex: number; dir: number; traits: number; open: boolean }[];
}

export interface ContentDb {
  $schema?: string;
  format: "jime-db";
  formatVersion: 1;
  models: Record<string, Record<string, Record<string, unknown>>>;
  standardTiles: Record<string, { model: Record<string, unknown>; spaces: TileSpace[] }>;
  tiles?: TileGeometry[];
  productOrder?: number[];
  globals: Record<string, GlobalVar>;
}
