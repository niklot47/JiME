// JSON Schema validators for packs, scenario files and the content database
import { readFileSync } from "node:fs";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { ContentDb, PackManifest, ScenarioFile } from "./types.ts";

const loadSchema = (name: string): object =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
const vPack = ajv.compile<PackManifest>(loadSchema("pack"));
const vScenario = ajv.compile<ScenarioFile>(loadSchema("scenario"));
const vDb = ajv.compile<ContentDb>(loadSchema("db"));

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function run(v: ValidateFunction, data: unknown): ValidationResult {
  const ok = v(data) as boolean;
  const errors = ok ? [] : (v.errors ?? []).slice(0, 20).map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  return { ok, errors };
}

export const validatePack = (data: unknown): ValidationResult => run(vPack, data);
export const validateScenario = (data: unknown): ValidationResult => run(vScenario, data);
export const validateDb = (data: unknown): ValidationResult => run(vDb, data);
