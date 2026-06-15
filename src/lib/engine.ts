import type { Confidence, Section, TaxLine, TbAccount } from "./types";
import { REVIEW, UNASSIGNED } from "./constants";

// ---------------------------------------------------------------------------
// Rule engine. Matches a GL account NAME against each tax line's keywords using
// WORD-BOUNDARY regex (so "rent" never matches inside "current"). Runs entirely
// client-side; only the leftovers go to the LLM fallback.
// ---------------------------------------------------------------------------

export type Classification = {
  taxLine: string;
  code: string;
  section: Section | "";
  confidence: Confidence;
  note: string;
};

type CompiledKeyword = { keyword: string; regex: RegExp };
type CompiledLine = {
  name: string;
  code: string;
  section: Section;
  keywords: CompiledKeyword[];
};

export type CompiledRules = {
  lines: CompiledLine[];
  weakTokens: Set<string>;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileRules(
  lines: TaxLine[],
  weakTokens: string[],
): CompiledRules {
  return {
    lines: lines.map((l) => ({
      name: l.name.trim(),
      code: l.code.trim(),
      section: l.section,
      keywords: l.keywords
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .map((keyword) => ({
          keyword,
          regex: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i"),
        })),
    })),
    weakTokens: new Set(
      weakTokens.map((t) => t.trim().toLowerCase()).filter(Boolean),
    ),
  };
}

/**
 * Classify a single account description.
 * - Exactly one tax line matches -> assign it (high, or medium if the only
 *   match was a weak/generic token).
 * - Two or more *different* lines match -> Needs Review (low), recording which.
 * - No match -> Unassigned (low).
 *
 * When multiple keywords across the SAME line match, the longest (most
 * specific) keyword wins for the note/weak-token decision.
 */
export function classify(
  description: string,
  rules: CompiledRules,
): Classification {
  const matched: { line: CompiledLine; keyword: string }[] = [];

  for (const line of rules.lines) {
    let best: string | null = null;
    for (const { keyword, regex } of line.keywords) {
      if (regex.test(description)) {
        if (best === null || keyword.length > best.length) best = keyword;
      }
    }
    if (best !== null) matched.push({ line, keyword: best });
  }

  if (matched.length === 0) {
    return { taxLine: UNASSIGNED, code: "", section: "", confidence: "low", note: "no match" };
  }

  if (matched.length === 1) {
    const { line, keyword } = matched[0];
    const weak = rules.weakTokens.has(keyword.toLowerCase());
    return {
      taxLine: line.name,
      code: line.code,
      section: line.section,
      confidence: weak ? "medium" : "high",
      note: `matched '${keyword}'`,
    };
  }

  // Multiple lines matched. Prefer the line whose matched keyword is the most
  // specific (longest) — e.g. "accumulated depreciation" beats "building" and
  // "depreciation" for "Accumulated Depreciation - Building". If a single line
  // wins on specificity we assign it but flag it medium (competitors existed).
  // A genuine tie on the longest keyword stays Needs Review.
  const maxLen = Math.max(...matched.map((m) => m.keyword.length));
  const top = matched.filter((m) => m.keyword.length === maxLen);
  if (top.length === 1) {
    const { line, keyword } = top[0];
    const others = matched
      .filter((m) => m.line.name !== line.name)
      .map((m) => m.line.name);
    return {
      taxLine: line.name,
      code: line.code,
      section: line.section,
      confidence: "medium",
      note: `matched '${keyword}' (also saw: ${others.join(", ")})`,
    };
  }

  const distinctNames = Array.from(new Set(matched.map((m) => m.line.name)));
  return {
    taxLine: REVIEW,
    code: "",
    section: "",
    confidence: "low",
    note: `ambiguous: ${distinctNames.slice().sort().join(", ")}`,
  };
}

export function runRuleEngine(
  accounts: TbAccount[],
  lines: TaxLine[],
  weakTokens: string[],
): TbAccount[] {
  const rules = compileRules(lines, weakTokens);
  return accounts.map((a) => {
    const c = classify(a.description, rules);
    return {
      ...a,
      taxLine: c.taxLine,
      taxCode: c.code,
      section: c.section,
      confidence: c.confidence,
      method: "rule" as const,
      note: c.note,
    };
  });
}

export function needsLLM(a: TbAccount): boolean {
  return (
    a.taxLine === UNASSIGNED || a.taxLine === REVIEW || a.confidence === "low"
  );
}

/** Flagged for the reviewer: unassigned, collided, or low confidence. */
export function isFlagged(a: TbAccount): boolean {
  return (
    a.taxLine === UNASSIGNED || a.taxLine === REVIEW || a.confidence === "low"
  );
}

/** Look up a tax line by its (display) name. */
export function lineByName(
  lines: TaxLine[],
  name: string,
): TaxLine | undefined {
  return lines.find((l) => l.name === name);
}

// --- Summary helpers --------------------------------------------------------

export const SECTION_ORDER: Section[] = [
  "income",
  "expense",
  "asset",
  "liability",
  "equity",
];

export const SECTION_LABELS: Record<Section, string> = {
  income: "Income",
  expense: "Expenses",
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity / Capital",
};
