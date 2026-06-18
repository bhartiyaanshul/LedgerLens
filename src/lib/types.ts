// ---------------------------------------------------------------------------
// Core domain types for the trial-balance -> tax-code categorizer.
//
// A CPA uploads a client's trial balance. Each account is mapped to a US tax
// "tax code" (the code that routes a GL account to a specific form line —
// e.g. Form 8825 line 3 "Advertising" = code 503). The result exports as a
// two-sheet workbook: a flat detail sheet
//   Account Number | Account Name | Amount | Tax line
// plus a pivot grouped by tax line.
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

export type Method = "rule" | "llm" | "manual";

/** Where a tax line sits on the financial statements (drives grouping/display). */
export type Section = "income" | "expense" | "asset" | "liability" | "equity";

/** The return types we ship tax-code sets for. */
export type EntityType = "1065" | "1120S" | "1120" | "1040E";

/**
 * One destination a GL account can be mapped to: a US tax form line and its
 * tax code. Keywords drive the local rule engine (matched against the
 * account name with word boundaries).
 */
export type TaxLine = {
  id: string;
  /** Human label, e.g. "Advertising". */
  name: string;
  /** Tax code, e.g. "503". Empty for special non-importing buckets. */
  code: string;
  section: Section;
  /** Where it lands, e.g. "Form 8825, Line 3" or "Sch L, line 15". */
  formLine: string;
  keywords: string[];
};

/** The whole persisted configuration: tax lines per entity + tuning. */
export type TaxConfig = {
  version: number;
  /** Tax-line sets keyed by entity type. */
  entities: Record<EntityType, TaxLine[]>;
  /** Generic tokens that, alone, downgrade a match to medium confidence. */
  weakTokens: string[];
};

/**
 * One trial-balance account after normalization + categorization.
 * `amount` is the signed net balance (debit positive, credit negative) — the
 * canonical trial-balance convention used for the export Amount column.
 */
export type TbAccount = {
  id: string;
  accountNumber: string;
  description: string;
  debit: number;
  credit: number;
  amount: number;
  /** Optional unit (e.g. property/activity number) for multi-activity returns. */
  unit: string;
  /** Assigned tax line name, or a special bucket (Unassigned / Needs Review). */
  taxLine: string;
  /** Assigned tax code ("" when unassigned / needs review). */
  taxCode: string;
  section: Section | "";
  confidence: Confidence;
  method: Method;
  /** Which keyword matched, the collision reason, or "categorised by model". */
  note: string;
  /** Original spreadsheet row, for traceability. */
  sourceRow: number;
};

// --- Column mapping ---------------------------------------------------------

/**
 * How the uploaded trial balance's columns map onto our canonical fields.
 * Amount can come from a single signed `balance` column OR separate
 * `debit` / `credit` columns.
 */
export type ColumnMapping = {
  accountNumber: string | null;
  description: string | null;
  balance: string | null;
  debit: string | null;
  credit: string | null;
};

export type AmountMode = "single" | "split";

export type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  /** Whether a header row was detected (false → columns named by position). */
  headerDetected: boolean;
  /** How many rows were merged into the header (e.g. 2 for a stacked header). */
  headerRowCount: number;
};

// --- LLM API contract -------------------------------------------------------
// The route receives, per account, its NAME and NUMBER, plus the candidate tax
// lines tagged with their statement section. The account number's chart-of-
// accounts series is an authoritative constraint on the answer (see route.ts).

/** One account sent to the categorizer: its name and (optional) GL number. */
export type CategorizeAccount = { name: string; number?: string | null };

/** A candidate tax line the model may choose, tagged with its section. */
export type CategorizeCategory = { name: string; section: Section };

export type CategorizeResultItem = {
  index: number;
  category: string;
  confidence: Confidence;
};
