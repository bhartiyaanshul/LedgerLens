import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  AmountMode,
  ColumnMapping,
  ParsedFile,
  TbAccount,
} from "./types";
import { COLUMN_ALIASES, UNASSIGNED } from "./constants";
import { sectionFromAccountNumber } from "./engine";
import { makeId } from "./utils";

// ---------------------------------------------------------------------------
// Ingest a trial balance (CSV/XLSX) into { headers, rows } in the browser,
// then normalize to TbAccount[]. Financial data never leaves the client here.
// ---------------------------------------------------------------------------

export class ParseError extends Error {}

const CSV_EXT = new Set(["csv", "tsv", "txt"]);
const XLSX_EXT = new Set(["xlsx", "xls", "xlsm"]);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isSupportedFile(name: string): boolean {
  const ext = fileExtension(name);
  return CSV_EXT.has(ext) || XLSX_EXT.has(ext);
}

export function isXlsxFile(name: string): boolean {
  return XLSX_EXT.has(fileExtension(name));
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = fileExtension(file.name);
  if (CSV_EXT.has(ext)) return parseCsv(file);
  if (XLSX_EXT.has(ext)) return parseXlsx(file);
  throw new ParseError(
    `Unsupported file type ".${ext}". Please upload a CSV or Excel file.`,
  );
}

export function parseCsvText(text: string, fileName: string): ParsedFile {
  // Parse as a raw matrix (header:false) and let matrixToParsed decide whether
  // the first row is a header — a CSV can be headerless too.
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
  });
  const matrix = (result.data ?? []).filter((r) => Array.isArray(r));
  if (matrix.length === 0) {
    throw new ParseError("No rows found. Is this a valid CSV file?");
  }
  return matrixToParsed(matrix, fileName);
}

function parseCsv(file: File): Promise<ParsedFile> {
  return file.text().then((text) => parseCsvText(text, file.name));
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  try {
    return XLSX.read(buf, { type: "array" });
  } catch {
    throw new ParseError("Could not read the Excel file. It may be corrupted.");
  }
}

/** Turn a single named worksheet into the canonical { headers, rows } shape. */
export function worksheetToParsed(
  wb: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
): ParsedFile {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new ParseError(`The tab "${sheetName}" could not be found.`);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) throw new ParseError(`The tab "${sheetName}" is empty.`);
  return matrixToParsed(matrix, fileName);
}

// ---------------------------------------------------------------------------
// Header detection
//
// We can't assume row 0 is the header: real trial balances start with a stacked
// header ("Ending" over "Balance"), extra title rows, or no header at all. So we
// SCORE the first non-blank row. A header row is text labels with NO parseable
// amount or account number in it (and scores higher for known label words like
// "Balance"/"Debit"); a data row carries a signed amount — incl. "(1,234.00)"
// or a "-" zero — and/or a chart-of-accounts number like 4500.10. If the top row
// scores as a header we take it (merging immediately-following label-only rows
// into one multi-line header); if it scores as data we treat the sheet as
// headerless and synthesize column names from each column's own content. Either
// way the first data row is never consumed as a header.
// ---------------------------------------------------------------------------

const MAX_HEADER_ROWS = 3; // cap on a stacked/wrapped header

/** Known header words — their presence is strong evidence of a header row. */
const HEADER_LABEL_TOKENS = new Set([
  "account", "accounts", "acct", "no", "number", "code", "description",
  "name", "title", "particulars", "balance", "ending", "beginning", "opening",
  "closing", "debit", "debits", "credit", "credits", "amount", "net", "total",
  "gl", "ledger", "dr", "cr", "unit", "activity",
]);

/** A chart-of-accounts number like 123, 4500, or 3000.1001 (no separators). */
const ACCOUNT_NUM_RE = /^\d{3,5}(\.\d+)?$/;

function cellText(c: unknown): string {
  return String(c ?? "").trim();
}

function isAccountNumberToken(s: string): boolean {
  return ACCOUNT_NUM_RE.test(s.trim());
}

/**
 * Does this cell read as a money amount? Accepts parenthesized negatives
 * "(1,234.00)", a lone "-" (the accounting zero), currency symbols, and
 * thousands separators — distinct from an account number, which has none.
 */
function looksLikeAmount(s: string): boolean {
  let t = s.trim();
  if (t === "") return false;
  if (/^[-–—]$/.test(t)) return true; // dash = zero
  t = t.replace(/^\((.*)\)$/, "$1").trim(); // unwrap (negative)
  t = t.replace(/[$£€,\s]/g, "").replace(/^[-+]/, ""); // strip currency, commas, sign
  return /^\d+(\.\d+)?$/.test(t);
}

/** True when a cell carries letters — a textual label or account name. */
function hasLetters(s: string): boolean {
  return /[a-z]/i.test(s);
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((c) => cellText(c) === "");
}

/** A row whose every non-empty cell is a clean text label (no values). */
function isLabelOnlyRow(row: unknown[]): boolean {
  let any = false;
  for (const cell of row) {
    const s = cellText(cell);
    if (s === "") continue;
    if (isAccountNumberToken(s) || looksLikeAmount(s) || !hasLetters(s)) return false;
    any = true;
  }
  return any;
}

/**
 * Header-likeness of a row: text labels push it positive (recognized header
 * words more so), while any amount or account-number pushes it negative. A
 * positive score means "header"; zero or negative means "data".
 */
function scoreHeaderRow(row: unknown[]): number {
  let score = 0;
  let nonEmpty = 0;
  for (const cell of row) {
    const s = cellText(cell);
    if (s === "") continue;
    nonEmpty += 1;
    if (isAccountNumberToken(s) || looksLikeAmount(s)) {
      score -= 3; // a value → this is data, not a header
    } else if (hasLetters(s)) {
      score += 1;
      const words = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
      if (words.some((w) => HEADER_LABEL_TOKENS.has(w))) score += 2;
    }
  }
  return nonEmpty === 0 ? 0 : score;
}

type HeaderDetection = { headerRows: number[]; dataStart: number };

/** Decide which leading rows (if any) form the header; where data begins. */
function detectHeader(matrix: unknown[][]): HeaderDetection {
  let start = 0;
  while (start < matrix.length && isBlankRow(matrix[start])) start++;
  if (start >= matrix.length) return { headerRows: [], dataStart: matrix.length };

  // Top non-blank row scores as data → headerless; don't drop it.
  if (scoreHeaderRow(matrix[start]) <= 0) {
    return { headerRows: [], dataStart: start };
  }

  // It's a header. Absorb immediately-following label-only rows (a wrapped or
  // stacked header such as "Ending" over "Balance"), capped for safety.
  let end = start;
  while (
    end + 1 < matrix.length &&
    end + 1 - start < MAX_HEADER_ROWS &&
    isLabelOnlyRow(matrix[end + 1])
  ) {
    end++;
  }
  const headerRows: number[] = [];
  for (let i = start; i <= end; i++) headerRows.push(i);
  return { headerRows, dataStart: end + 1 };
}

/**
 * A totals/summary row carries values but nothing that identifies an account —
 * no text label and no account number (e.g. a trailing "(0.00)"). Dropping it
 * keeps it out of the account list and the preview.
 */
function isTotalsRow(row: unknown[]): boolean {
  let any = false;
  for (const cell of row) {
    const s = cellText(cell);
    if (s === "") continue;
    any = true;
    if (hasLetters(s) || isAccountNumberToken(s)) return false; // identifying → keep
  }
  return any;
}

/**
 * Name an unlabeled column from its own data so column auto-detection still
 * works. Canonical names match COLUMN_ALIASES. Returns null for a column with no
 * data at all (it gets dropped), or a positional fallback when content is mixed.
 */
function synthesizeColumnName(values: string[], colIndex: number): string | null {
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return null;
  let acct = 0;
  let amount = 0;
  let text = 0;
  for (const v of nonEmpty) {
    if (isAccountNumberToken(v)) acct++; // account numbers also look like amounts,
    else if (looksLikeAmount(v)) amount++; // so test them first
    else if (hasLetters(v)) text++;
  }
  const n = nonEmpty.length;
  if (text / n >= 0.5) return "Account Description";
  if (acct / n >= 0.6) return "Account Number";
  if (amount / n >= 0.6) return "Balance";
  return `Column ${colIndex + 1}`;
}

/**
 * Turn a raw cell matrix into the canonical { headers, rows } shape, deciding
 * for itself where the header is (or that there isn't one).
 */
export function matrixToParsed(
  matrix: unknown[][],
  fileName: string,
): ParsedFile {
  if (matrix.length === 0) throw new ParseError(`"${fileName}" is empty.`);
  const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
  if (width === 0) throw new ParseError(`"${fileName}" has no columns.`);

  const { headerRows, dataStart } = detectHeader(matrix);

  // Data rows: drop fully-blank rows and amount-only totals lines.
  const dataRows: unknown[][] = [];
  for (let i = dataStart; i < matrix.length; i++) {
    const row = matrix[i];
    if (isBlankRow(row) || isTotalsRow(row)) continue;
    dataRows.push(row);
  }

  // Build a name for every column: merge any header-row labels, else synthesize
  // from the column's content. Keep names unique and drop wholly-empty columns.
  const headers: string[] = [];
  const keptCols: number[] = [];
  const used = new Set<string>();
  for (let c = 0; c < width; c++) {
    const label = headerRows
      .map((r) => cellText(matrix[r]?.[c]))
      .filter(Boolean)
      .join(" ")
      .trim();
    let name = label || synthesizeColumnName(dataRows.map((r) => cellText(r[c])), c);
    if (name === null) continue; // empty column, no header → drop
    if (used.has(name.toLowerCase())) {
      let n = 2;
      while (used.has(`${name} ${n}`.toLowerCase())) n++;
      name = `${name} ${n}`;
    }
    used.add(name.toLowerCase());
    headers.push(name);
    keptCols.push(c);
  }

  if (headers.length === 0)
    throw new ParseError(`Could not detect any columns in "${fileName}".`);

  const rows: Record<string, string>[] = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    keptCols.forEach((c, j) => {
      obj[headers[j]] = cellText(row[c]);
    });
    return obj;
  });

  if (rows.length === 0) throw new ParseError(`"${fileName}" has no data rows.`);

  return {
    fileName,
    headers,
    rows,
    headerDetected: headerRows.length > 0,
    headerRowCount: headerRows.length,
  };
}

/** One worksheet's name plus a rough count of its non-empty rows. */
export type SheetSummary = { name: string; rows: number };

/**
 * A workbook opened for tab selection: every sheet's name + row count, plus a
 * `parseSheet` closure to parse whichever tab the user picks. Lets us ask
 * "which tab?" before committing to a single sheet (workbooks often carry
 * extra tabs — adjustments, notes — alongside the trial balance).
 */
export type WorkbookSheets = {
  fileName: string;
  sheets: SheetSummary[];
  parseSheet: (sheetName: string) => ParsedFile;
};

export async function readXlsxSheets(file: File): Promise<WorkbookSheets> {
  const wb = await readWorkbook(file);
  if (wb.SheetNames.length === 0)
    throw new ParseError("The workbook has no sheets.");
  const sheets: SheetSummary[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const matrix = ws
      ? XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: "",
          blankrows: false,
        })
      : [];
    const rows = matrix.filter((r) =>
      r.some((c) => String(c ?? "").trim() !== ""),
    ).length;
    return { name, rows };
  });
  return {
    fileName: file.name,
    sheets,
    parseSheet: (sheetName) => worksheetToParsed(wb, sheetName, file.name),
  };
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const wb = await readWorkbook(file);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new ParseError("The workbook has no sheets.");
  return worksheetToParsed(wb, sheetName, file.name);
}

// ---------------------------------------------------------------------------
// Column auto-detection
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `alias` appear in `headerLower` as a whole token (delimited by
 * non-alphanumerics or string ends)? Token-boundary — not raw substring — so a
 * short alias like "cr" matches "Net Cr" but never "Des**cr**iption".
 */
function tokenMatch(headerLower: string, alias: string): boolean {
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`,
  ).test(headerLower);
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const lower = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  for (const a of aliases) {
    const hit = lower.get(a);
    if (hit) return hit;
  }
  for (const a of aliases) {
    for (const [low, original] of lower) {
      if (tokenMatch(low, a)) return original;
    }
  }
  return null;
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const debit = findColumn(headers, COLUMN_ALIASES.debit);
  const credit = findColumn(headers, COLUMN_ALIASES.credit);
  // Only treat a column as the single "balance" if it isn't already the debit
  // or credit column (since "amount" can collide with those aliases).
  let balance = findColumn(headers, COLUMN_ALIASES.balance);
  if (balance && (balance === debit || balance === credit)) balance = null;
  return {
    accountNumber: findColumn(headers, COLUMN_ALIASES.accountNumber),
    description: findColumn(headers, COLUMN_ALIASES.description),
    balance,
    debit,
    credit,
  };
}

export function detectAmountMode(mapping: ColumnMapping): AmountMode {
  if (mapping.debit || mapping.credit) return "split";
  if (mapping.balance) return "single";
  return "split";
}

// ---------------------------------------------------------------------------
// Normalize -> TbAccount[]
// ---------------------------------------------------------------------------

export function parseAmount(value: string | undefined | null): number {
  if (value == null) return 0;
  let s = String(value).trim();
  if (s === "") return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, "").replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export type NormalizeOptions = {
  mapping: ColumnMapping;
  amountMode: AmountMode;
};

/**
 * Turn parsed rows into normalized accounts. `amount` is the signed net balance
 * (debit positive, credit negative) — the canonical trial-balance convention,
 * carried straight to the export Amount column.
 */
export function normalize(
  parsed: ParsedFile,
  opts: NormalizeOptions,
): TbAccount[] {
  const { mapping, amountMode } = opts;
  if (!mapping.description) {
    throw new ParseError("An Account Description column must be selected.");
  }

  const accounts: TbAccount[] = [];
  parsed.rows.forEach((row, i) => {
    const description = (mapping.description && row[mapping.description]) || "";
    if (!description || description.toLowerCase() === "nan") return;

    let debit = 0;
    let credit = 0;
    if (amountMode === "single" && mapping.balance) {
      const val = parseAmount(row[mapping.balance]);
      if (val >= 0) debit = val;
      else credit = -val;
    } else {
      // Sign-preserving: a negative in the debit column (e.g. "(500)") nets as
      // a credit rather than being silently flipped positive by Math.abs.
      debit = mapping.debit ? parseAmount(row[mapping.debit]) : 0;
      credit = mapping.credit ? parseAmount(row[mapping.credit]) : 0;
    }
    const amount = debit - credit;

    const accountNumber =
      (mapping.accountNumber && row[mapping.accountNumber]) || "";
    accounts.push({
      id: makeId("acct"),
      accountNumber,
      description: description.trim(),
      debit,
      credit,
      amount,
      unit: "",
      taxLine: UNASSIGNED,
      taxCode: "",
      // Seed the section from the chart-of-accounts number; the rule engine
      // refines it when an account maps to a tax line.
      section: sectionFromAccountNumber(accountNumber),
      confidence: "low",
      method: "rule",
      note: "",
      sourceRow: i + 2,
    });
  });

  if (accounts.length === 0) {
    throw new ParseError(
      "No accounts found. Check that the Description column is mapped correctly.",
    );
  }
  return accounts;
}
