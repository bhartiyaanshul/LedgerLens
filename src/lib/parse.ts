import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  AmountMode,
  ColumnMapping,
  ParsedFile,
  TbAccount,
} from "./types";
import { COLUMN_ALIASES, UNASSIGNED } from "./constants";
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

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = fileExtension(file.name);
  if (CSV_EXT.has(ext)) return parseCsv(file);
  if (XLSX_EXT.has(ext)) return parseXlsx(file);
  throw new ParseError(
    `Unsupported file type ".${ext}". Please upload a CSV or Excel file.`,
  );
}

export function parseCsvText(text: string, fileName: string): ParsedFile {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  if (headers.length === 0) {
    throw new ParseError("No columns found. Is this a valid CSV file?");
  }
  const rows = (result.data ?? [])
    .map((r) => stringifyRow(r))
    .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
  if (rows.length === 0) throw new ParseError("The file has no data rows.");
  return { fileName, headers, rows };
}

function parseCsv(file: File): Promise<ParsedFile> {
  return file.text().then((text) => parseCsvText(text, file.name));
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array" });
  } catch {
    throw new ParseError("Could not read the Excel file. It may be corrupted.");
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new ParseError("The workbook has no sheets.");
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) throw new ParseError("The sheet is empty.");

  const headerIdx = matrix.findIndex(
    (row) => row.filter((c) => String(c ?? "").trim() !== "").length >= 2,
  );
  if (headerIdx < 0) throw new ParseError("Could not find a header row.");

  const headers = matrix[headerIdx].map((c) => String(c ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const raw = matrix[i];
    const obj: Record<string, string> = {};
    let nonEmpty = false;
    headers.forEach((h, j) => {
      if (!h) return;
      const v = String(raw[j] ?? "").trim();
      obj[h] = v;
      if (v !== "") nonEmpty = true;
    });
    if (nonEmpty) rows.push(obj);
  }

  const cleanHeaders = headers.filter((h) => h.length > 0);
  if (cleanHeaders.length === 0)
    throw new ParseError("Could not detect any column names.");
  if (rows.length === 0) throw new ParseError("The sheet has no data rows.");
  return { fileName: file.name, headers: cleanHeaders, rows };
}

function stringifyRow(r: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k.trim() === "") continue;
    out[k.trim()] = v == null ? "" : String(v).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Column auto-detection
// ---------------------------------------------------------------------------

function findColumn(headers: string[], aliases: string[]): string | null {
  const lower = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  for (const a of aliases) {
    const hit = lower.get(a);
    if (hit) return hit;
  }
  for (const a of aliases) {
    for (const [low, original] of lower) {
      if (low.includes(a)) return original;
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
 * carried straight to the UltraTax import Amount column.
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

    accounts.push({
      id: makeId("acct"),
      accountNumber: (mapping.accountNumber && row[mapping.accountNumber]) || "",
      description: description.trim(),
      debit,
      credit,
      amount,
      unit: "",
      taxLine: UNASSIGNED,
      taxCode: "",
      section: "",
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
