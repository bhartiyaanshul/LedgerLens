import type { Confidence, Section, TaxLine, TbAccount } from "./types";
import {
  coaCategoryFromNumber,
  coaSectionsFromNumber,
  EXCLUDE,
  REVIEW,
  UNASSIGNED,
} from "./constants";
import { normalizeName } from "./normalize";

// ---------------------------------------------------------------------------
// Categorization engine.
//
// A trial-balance account name carries two independent signals about which tax
// line it belongs to:
//
//   1. The NAME — matched against each tax line's keyword lexicon. We normalize
//      the name first (see normalize.ts) so abbreviations and separators don't
//      defeat matching, then score keywords by specificity: a multi-word phrase
//      ("accumulated depreciation") is far more decisive than a generic token
//      ("depreciation"), which in turn beats a weak/generic token ("fee").
//
//   2. The ACCOUNT NUMBER — the firm's chart-of-accounts series encodes the
//      statement section (1xxx asset, 2xxx liability, 3xxx equity, 4xxx income,
//      5xxx–9xxx expense/other; see COA_RANGES in constants.ts). We treat this
//      as an AUTHORITATIVE CONSTRAINT: when a number is present we first FILTER
//      the candidate tax lines down to those whose section the number allows,
//      and only THEN run keyword matching. This is what lets "1700 Prepaid
//      Insurance" land on the asset line (Other current assets) — the Insurance
//      *expense* line is filtered out before scoring, so it can never win.
//
// The best-scoring surviving line wins. A clear margin -> high confidence; a thin margin
// or a weak-token-only match -> medium (with the runner-up noted); a genuine
// tie between different lines -> Needs Review; nothing above the floor ->
// Unassigned. Everything runs client-side; only the leftovers go to the LLM.
// ---------------------------------------------------------------------------

export type Classification = {
  taxLine: string;
  code: string;
  section: Section | "";
  confidence: Confidence;
  note: string;
};

type CompiledKeyword = {
  keyword: string;
  regex: RegExp;
  weight: number;
  weak: boolean;
};
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

// --- Scoring constants ------------------------------------------------------
// The account-number section is enforced as a hard pre-filter (see scoreLines),
// not a score adjustment, so only the keyword signals below set the score.
// A second/third matching keyword on the same line adds a little, capped, so a
// line can't win on sheer keyword count alone.
const EXTRA_MATCH_BONUS = 0.5;
const EXTRA_MATCH_CAP = 2;
// Margin over the runner-up (a different line) needed for "high" confidence.
const HIGH_MARGIN = 4;
// Two different lines within this score are treated as a tie -> Needs Review.
const TIE_EPSILON = 0.5;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How decisive a keyword is. Weak/generic tokens barely move the needle;
 * specificity rises with the number of words and the length of a single token.
 */
function keywordWeight(normalized: string, weak: boolean): number {
  if (weak) return 1;
  const words = normalized.split(" ").filter(Boolean).length;
  if (words >= 3) return 16;
  if (words === 2) return 12;
  const len = normalized.length;
  if (len >= 9) return 8;
  if (len >= 6) return 6;
  if (len >= 4) return 4;
  return 2;
}

export function compileRules(
  lines: TaxLine[],
  weakTokens: string[],
): CompiledRules {
  const weak = new Set(
    weakTokens.map((t) => normalizeName(t)).filter(Boolean),
  );
  return {
    // Skip lines with no name: an unnamed-but-keyworded line would otherwise
    // match and assign taxLine="" — a value the review dropdown can't show or
    // re-select, leaving the row in a broken, unrecoverable state.
    lines: lines
      .filter((l) => l.name.trim().length > 0)
      .map((l) => ({
        name: l.name.trim(),
        code: l.code.trim(),
        section: l.section,
        keywords: l.keywords
          .map((k) => ({ raw: k, norm: normalizeName(k) }))
          .filter((k) => k.norm.length > 0)
          // De-dupe keywords that normalize to the same token.
          .filter(
            (k, i, arr) => arr.findIndex((o) => o.norm === k.norm) === i,
          )
          .map(({ norm }) => {
            const isWeak = weak.has(norm);
            return {
              keyword: norm,
              regex: new RegExp(`\\b${escapeRegExp(norm)}\\b`),
              weight: keywordWeight(norm, isWeak),
              weak: isWeak,
            };
          }),
      })),
    weakTokens: weak,
  };
}

type Candidate = {
  line: CompiledLine;
  bestKeyword: string;
  score: number;
  weakOnly: boolean;
};

/**
 * Score every line that has at least one keyword match against the name.
 * `allowed`, when non-null, is the authoritative set of statement sections the
 * account number permits — lines outside it are dropped BEFORE keyword scoring,
 * so a cross-section keyword match can never win.
 */
function scoreLines(
  normalizedName: string,
  allowed: Set<Section> | null,
  rules: CompiledRules,
): Candidate[] {
  const out: Candidate[] = [];
  for (const line of rules.lines) {
    if (allowed && !allowed.has(line.section)) continue; // COA hard filter

    let bestKeyword: string | null = null;
    let bestWeight = 0;
    let matches = 0;
    let anyStrong = false;

    for (const k of line.keywords) {
      if (!k.regex.test(normalizedName)) continue;
      matches += 1;
      if (!k.weak) anyStrong = true;
      // Highest weight wins; ties broken by the longer (more specific) keyword.
      if (
        k.weight > bestWeight ||
        (k.weight === bestWeight &&
          bestKeyword !== null &&
          k.keyword.length > bestKeyword.length)
      ) {
        bestWeight = k.weight;
        bestKeyword = k.keyword;
      }
    }
    if (matches === 0 || bestKeyword === null) continue;

    const score =
      bestWeight + Math.min(EXTRA_MATCH_CAP, (matches - 1) * EXTRA_MATCH_BONUS);
    out.push({ line, bestKeyword, score, weakOnly: !anyStrong });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Classify one account. `accountNumber` is optional but, when present, supplies
 * the section prior that disambiguates same-name asset vs. expense lines.
 */
export function classify(
  description: string,
  rules: CompiledRules,
  accountNumber = "",
): Classification {
  const text = normalizeName(description);
  // The account number's series is an authoritative constraint: when present,
  // only tax lines in the allowed section(s) are eligible.
  const coa = coaCategoryFromNumber(accountNumber);
  const allowed = coa ? new Set(coa.sections) : null;
  const candidates = scoreLines(text, allowed, rules);

  // Audit: note which COA category constrained the candidate set, so the
  // preparer can see why a line was eligible (or why nothing matched).
  const coaTag = coa ? ` · acct #→${coa.label} (constraint)` : "";

  if (candidates.length === 0) {
    return {
      taxLine: UNASSIGNED,
      code: "",
      section: "",
      confidence: "low",
      note: `no match${coaTag}`,
    };
  }

  const best = candidates[0];
  const runnerUp = candidates.find((c) => c.line.name !== best.line.name);
  const margin = best.score - (runnerUp ? runnerUp.score : -Infinity);

  // Two distinct lines essentially tied — don't guess, flag for review.
  if (runnerUp && margin < TIE_EPSILON) {
    const names = Array.from(
      new Set(
        candidates
          .filter((c) => best.score - c.score < TIE_EPSILON)
          .map((c) => c.line.name),
      ),
    ).sort();
    return {
      taxLine: REVIEW,
      code: "",
      section: "",
      confidence: "low",
      note: `ambiguous: ${names.join(", ")}${coaTag}`,
    };
  }

  const confidence: Confidence = best.weakOnly
    ? "medium"
    : margin >= HIGH_MARGIN
      ? "high"
      : "medium";

  const note =
    (runnerUp && margin < HIGH_MARGIN
      ? `matched '${best.bestKeyword}' (also saw: ${runnerUp.line.name})`
      : `matched '${best.bestKeyword}'`) + coaTag;

  return {
    taxLine: best.line.name,
    code: best.line.code,
    section: best.line.section,
    confidence,
    note,
  };
}

export function runRuleEngine(
  accounts: TbAccount[],
  lines: TaxLine[],
  weakTokens: string[],
): TbAccount[] {
  const rules = compileRules(lines, weakTokens);
  return accounts.map((a) => {
    const c = classify(a.description, rules, a.accountNumber);
    return flagSectionConflict({
      ...a,
      taxLine: c.taxLine,
      taxCode: c.code,
      // Keep a section even when no tax line matched, inferred from the
      // account number — drives the by-section grouping in the export/pivot.
      section: c.section || sectionFromAccountNumber(a.accountNumber),
      confidence: c.confidence,
      method: "rule" as const,
      note: c.note,
    });
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

// --- Account-number → section ----------------------------------------------

/**
 * The single PRIMARY statement section for an account number, used to seed the
 * by-section grouping of otherwise-unmapped rows (export/pivot). For the
 * authoritative eligibility constraint (which may allow more than one section,
 * e.g. 8xxx "other income & expenses"), use {@link coaSectionsFromNumber}.
 *   1xxx → assets, 2xxx → liabilities, 3xxx → capital/equity,
 *   4xxx → income, 5xxx and above → expense.
 * Returns "" when the account number has no leading digit.
 */
export function sectionFromAccountNumber(accountNumber: string): Section | "" {
  const digits = String(accountNumber ?? "").replace(/\D/g, "");
  switch (digits[0]) {
    case "1":
      return "asset";
    case "2":
      return "liability";
    case "3":
      return "equity";
    case "4":
      return "income";
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
      return "expense";
    default:
      return "";
  }
}

/**
 * Best-available section: the assigned tax line's section, falling back to the
 * one inferred from the account number (so even Unassigned rows can be grouped).
 */
export function effectiveSection(a: {
  section: Section | "";
  accountNumber: string;
}): Section | "" {
  return a.section || sectionFromAccountNumber(a.accountNumber);
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

// --- Account-number guardrail ----------------------------------------------

/**
 * True when the assigned line's section is not among the sections the account
 * number permits — the structural net behind the export-page warning. The rule
 * engine already pre-filters to allowed sections, so this mainly catches an LLM
 * pick (or a manual edit) that landed cross-section. Special buckets and
 * numberless accounts never conflict.
 */
export function hasSectionConflict(a: {
  accountNumber: string;
  section: Section | "";
  taxLine: string;
}): boolean {
  const allowed = coaSectionsFromNumber(a.accountNumber);
  return (
    allowed.length > 0 &&
    !!a.section &&
    !allowed.includes(a.section) &&
    a.taxLine !== UNASSIGNED &&
    a.taxLine !== REVIEW &&
    a.taxLine !== EXCLUDE
  );
}

export function flagSectionConflict(a: TbAccount): TbAccount {
  if (!hasSectionConflict(a)) return a;
  const coa = coaCategoryFromNumber(a.accountNumber);
  return {
    ...a,
    confidence: "low",
    note: `Section conflict — account # → ${coa?.label ?? "?"}, but ${a.taxLine} (code ${a.taxCode}) → ${SECTION_LABELS[a.section as Section]}; verify`,
  };
}
