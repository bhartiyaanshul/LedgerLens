import type { Workbook, Worksheet } from "exceljs";
import type { EntityType, Section, TbAccount } from "./types";
import { effectiveSection, SECTION_ORDER } from "./engine";
import { todayStamp } from "./utils";

// ---------------------------------------------------------------------------
// Export a two-sheet workbook:
//
//   Sheet 1 "Trial Balance" — the flat detail, one row per account:
//     Account Number | Account Name | Amount | Tax line
//   ...with a bold Total row (a balanced trial balance nets to zero).
//
//   Sheet 2 "Tax line pivot" — the same accounts grouped by tax line:
//     Tax line | Account Number | Account Name | Amount
//   ...with a subtotal per tax line and a grand total. Groups are ordered by
//   statement section (income, expense, assets, liabilities, capital).
//
// `Amount` is the signed net balance (debit positive, credit negative), so the
// totals come out to zero when the books balance. The tax line *name* is shown
// (not the numeric tax code) per the firm's review format. ExcelJS (free,
// browser) is dynamically imported to keep it out of the initial bundle.
// ---------------------------------------------------------------------------

const HEADER_FILL = "FF1F3864";
const CURRENCY_FMT = "#,##0.00";

const DETAIL_HEADERS = [
  "Account Number",
  "Account Name",
  "Amount",
  "Tax line",
] as const;
const DETAIL_WIDTHS = [18, 44, 16, 30];

const PIVOT_HEADERS = [
  "Tax line",
  "Account Number",
  "Account Name",
  "Amount",
] as const;
const PIVOT_WIDTHS = [30, 18, 44, 16];

const round2 = (n: number) => Number(n.toFixed(2));

function styleHeader(
  ws: Worksheet,
  headers: readonly string[],
  widths: number[],
) {
  const header = ws.getRow(1);
  header.values = [...headers];
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  ws.columns = widths.map((w) => ({ width: w }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function topBorder(ws: Worksheet, rowNumber: number, cols: number, style: "thin" | "double") {
  const row = ws.getRow(rowNumber);
  for (let c = 1; c <= cols; c++) {
    row.getCell(c).border = { top: { style } };
  }
}

// --- Sheet 1: flat detail, original trial-balance order ---------------------
function buildDetailSheet(wb: Workbook, accounts: TbAccount[]) {
  const ws = wb.addWorksheet("Trial Balance");
  styleHeader(ws, DETAIL_HEADERS, DETAIL_WIDTHS);

  const ordered = accounts.slice().sort((a, b) => a.sourceRow - b.sourceRow);
  let total = 0;
  for (const a of ordered) {
    total += a.amount;
    const row = ws.addRow([a.accountNumber, a.description, round2(a.amount), a.taxLine]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  }

  const totalRow = ws.addRow(["", "Total", round2(total), ""]);
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = CURRENCY_FMT;
  topBorder(ws, totalRow.number, DETAIL_HEADERS.length, "thin");
}

// --- Sheet 2: pivot grouped by tax line -------------------------------------
function sectionRank(s: Section | ""): number {
  const i = SECTION_ORDER.indexOf(s as Section);
  return i < 0 ? SECTION_ORDER.length : i;
}

function buildPivotSheet(wb: Workbook, accounts: TbAccount[]) {
  const ws = wb.addWorksheet("Tax line pivot");
  styleHeader(ws, PIVOT_HEADERS, PIVOT_WIDTHS);

  const groups = new Map<string, TbAccount[]>();
  for (const a of accounts) {
    const key = a.taxLine || "Unassigned";
    const arr = groups.get(key) ?? [];
    arr.push(a);
    groups.set(key, arr);
  }

  // Order groups by statement section, then alphabetically by tax line.
  const meta = Array.from(groups.entries()).map(([name, accts]) => ({
    name,
    accts,
    section: accts.map(effectiveSection).find(Boolean) ?? "",
  }));
  meta.sort(
    (a, b) =>
      sectionRank(a.section) - sectionRank(b.section) || a.name.localeCompare(b.name),
  );

  let grand = 0;
  for (const g of meta) {
    const accts = g.accts
      .slice()
      .sort(
        (a, b) =>
          a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }) ||
          a.sourceRow - b.sourceRow,
      );

    let subtotal = 0;
    accts.forEach((a, idx) => {
      subtotal += a.amount;
      const row = ws.addRow([
        idx === 0 ? g.name : "",
        a.accountNumber,
        a.description,
        round2(a.amount),
      ]);
      if (idx === 0) row.getCell(1).font = { bold: true };
      row.getCell(4).numFmt = CURRENCY_FMT;
    });
    grand += subtotal;

    const sub = ws.addRow(["", "", "Subtotal", round2(subtotal)]);
    sub.font = { bold: true };
    sub.getCell(4).numFmt = CURRENCY_FMT;
    topBorder(ws, sub.number, PIVOT_HEADERS.length, "thin");
    ws.addRow([]); // spacer between groups
  }

  const totalRow = ws.addRow(["", "", "Total", round2(grand)]);
  totalRow.font = { bold: true };
  totalRow.getCell(4).numFmt = CURRENCY_FMT;
  topBorder(ws, totalRow.number, PIVOT_HEADERS.length, "double");
}

export function buildWorkbook(
  ExcelJSCtor: typeof import("exceljs"),
  accounts: TbAccount[],
): Workbook {
  const wb = new ExcelJSCtor.Workbook();
  wb.creator = "LedgerLens";
  wb.created = new Date();
  buildDetailSheet(wb, accounts);
  buildPivotSheet(wb, accounts);
  return wb;
}

export function exportFileName(entity: EntityType): string {
  return `trial-balance-${entity.toLowerCase()}-tax-lines-${todayStamp()}.xlsx`;
}

export async function downloadWorkbook(
  accounts: TbAccount[],
  entity: EntityType,
): Promise<void> {
  const mod = await import("exceljs");
  const ExcelJSCtor = (mod.default ?? mod) as typeof import("exceljs");
  const wb = buildWorkbook(ExcelJSCtor, accounts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(entity);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
