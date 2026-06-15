import type { EntityType, Section, TaxConfig, TaxLine } from "./types";
import { CONFIG_VERSION, STORAGE_KEY, defaultConfig } from "./constants";
import { makeId } from "./utils";

// ---------------------------------------------------------------------------
// Persistence for the tax-code config. No database: localStorage + JSON
// import/export. Clear seam to add Supabase / Vercel Postgres later — replace
// load/save with async calls keeping the same TaxConfig shape.
// ---------------------------------------------------------------------------

const ENTITY_KEYS: EntityType[] = ["1065", "1120S", "1120", "1040E"];
const SECTIONS: Section[] = ["income", "expense", "asset", "liability", "equity"];

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function coerceLine(input: unknown): TaxLine | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Partial<TaxLine>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  const section: Section =
    typeof o.section === "string" && (SECTIONS as string[]).includes(o.section)
      ? (o.section as Section)
      : "expense";
  return {
    id: typeof o.id === "string" && o.id ? o.id : makeId("line"),
    name,
    code: typeof o.code === "string" ? o.code.trim() : "",
    section,
    formLine: typeof o.formLine === "string" ? o.formLine : "",
    keywords: Array.isArray(o.keywords)
      ? Array.from(
          new Set(
            o.keywords
              .filter((k): k is string => typeof k === "string")
              .map((k) => k.trim())
              .filter(Boolean),
          ),
        )
      : [],
  };
}

export function coerceConfig(input: unknown): TaxConfig | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Partial<TaxConfig>;
  if (!o.entities || typeof o.entities !== "object") return null;

  const fallback = defaultConfig();
  const entities = {} as TaxConfig["entities"];
  let any = false;
  for (const key of ENTITY_KEYS) {
    const raw = (o.entities as Record<string, unknown>)[key];
    const lines = Array.isArray(raw)
      ? raw.map(coerceLine).filter((l): l is TaxLine => l !== null)
      : [];
    if (lines.length > 0) {
      entities[key] = lines;
      any = true;
    } else {
      entities[key] = fallback.entities[key];
    }
  }
  if (!any) return null;

  const weakTokens = Array.isArray(o.weakTokens)
    ? Array.from(
        new Set(
          o.weakTokens
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        ),
      )
    : fallback.weakTokens;

  return {
    version: typeof o.version === "number" ? o.version : CONFIG_VERSION,
    entities,
    weakTokens,
  };
}

export function loadConfig(): TaxConfig {
  if (!isBrowser()) return defaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    return coerceConfig(JSON.parse(raw)) ?? defaultConfig();
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: TaxConfig): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* quota / privacy mode — in-memory config still works */
  }
}

export function exportConfigJson(config: TaxConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importConfigJson(json: string): TaxConfig {
  const coerced = coerceConfig(JSON.parse(json));
  if (!coerced) {
    throw new Error("That file is not a valid LedgerLens tax config.");
  }
  return coerced;
}
