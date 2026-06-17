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

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  try {
    return XLSX.read(buf, { type: "array" });
  } catch {
    throw new ParseError("Could not read the Excel file. It may be corrupted.");
  }
}

/** Turn a single named worksheet into the canonical { headers, rows } shape. */
function worksheetToParsed(
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

  const headerIdx = matrix.findIndex(
    (row) => row.filter((c) => String(c ?? "").trim() !== "").length >= 2,
  );
  if (headerIdx < 0)
    throw new ParseError(`Could not find a header row in "${sheetName}".`);

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
    throw new ParseError(`Could not detect column names in "${sheetName}".`);
  if (rows.length === 0)
    throw new ParseError(`The tab "${sheetName}" has no data rows.`);
  return { fileName, headers: cleanHeaders, rows };
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
