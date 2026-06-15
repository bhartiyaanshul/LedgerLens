import type { Workbook, Worksheet } from "exceljs";
import type { EntityType, TbAccount } from "./types";
import { todayStamp } from "./utils";

// ---------------------------------------------------------------------------
// Export ONE sheet in UltraTax CS's Trial Balance Import layout:
//   Account Number | Account Description | Unit | Tax Code | Amount
// Nothing else is added — this file is meant to be imported directly via
// UltraTax CS  ▸  Utilities ▸ Trial Balance Import (map the five columns).
//
// `Amount` is the signed net balance (debit positive, credit negative); the
// account's UltraTax tax code routes it to the correct form line. Accounts with
// no assigned code are left blank so they're visible/unmapped in UltraTax until
// resolved. ExcelJS (free, browser) is dynamically imported to keep it out of
// the initial bundle.
// ---------------------------------------------------------------------------

const HEADERS = [
  "Account Number",
  "Account Description",
  "Unit",
  "Tax Code",
  "Amount",
] as const;

const COL_WIDTHS = [18, 44, 8, 12, 16];
const HEADER_FILL = "FF1F3864";
const CURRENCY_FMT = "#,##0.00";

function styleSheet(ws: Worksheet) {
  const header = ws.getRow(1);
  header.values = [...HEADERS];
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export function buildWorkbook(
  ExcelJSCtor: typeof import("exceljs"),
  accounts: TbAccount[],
): Workbook {
  const wb = new ExcelJSCtor.Workbook();
  wb.creator = "LedgerLens";
  wb.created = new Date();

  const ws = wb.addWorksheet("Trial Balance");
  styleSheet(ws);

  // Preserve the original trial-balance order for traceability.
  const ordered = accounts.slice().sort((a, b) => a.sourceRow - b.sourceRow);
  for (const a of ordered) {
    const row = ws.addRow([
      a.accountNumber,
      a.description,
      a.unit,
      a.taxCode, // blank until assigned; 99999 = exclude from import
      Number(a.amount.toFixed(2)),
    ]);
    row.getCell(5).numFmt = CURRENCY_FMT;
  }
  return wb;
}

export function exportFileName(entity: EntityType): string {
  return `ultratax-${entity.toLowerCase()}-trial-balance-${todayStamp()}.xlsx`;
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
