/**
 * Runnable check (no test framework): `npm test`.
 *
 * Proves the two bug fixes:
 *   (a) Data/Sample.xlsx — whose real header is two stacked rows ("Ending" over
 *       "Balance") above 23 accounts and a totals line — parses to exactly 23
 *       accounts that net to zero, with the first account (1120.0000) kept.
 *   (b) The chart-of-accounts number is an authoritative constraint: a 1xxx
 *       (asset) account can never be assigned an income/expense tax line, even
 *       when its name matches an expense/income keyword.
 */
import * as XLSX from "xlsx";
import {
  autoDetectMapping,
  detectAmountMode,
  normalize,
  worksheetToParsed,
} from "../src/lib/parse";
import { coaCategoryFromNumber, defaultConfig } from "../src/lib/constants";
import { classify, compileRules } from "../src/lib/engine";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// --- (a) Sample.xlsx header detection + balance -----------------------------
const wb = XLSX.readFile("Data/Sample.xlsx");
const parsed = worksheetToParsed(wb, wb.SheetNames[0], "Sample.xlsx");

check(
  "Sample.xlsx: stacked header detected (not a data row)",
  parsed.headerDetected && parsed.headerRowCount === 2,
  `headerDetected=${parsed.headerDetected}, rows merged=${parsed.headerRowCount}`,
);

const mapping = autoDetectMapping(parsed.headers);
const amountMode = detectAmountMode(mapping);
const accounts = normalize(parsed, { mapping, amountMode });

check("Sample.xlsx: parses to 23 accounts", accounts.length === 23, `got ${accounts.length}`);

check(
  "Sample.xlsx: first account 1120.0000 kept (not eaten as header)",
  accounts[0]?.accountNumber.trim() === "1120.0000",
  `${accounts[0]?.accountNumber.trim()} — ${accounts[0]?.description}`,
);

const debit = accounts.reduce((s, a) => s + a.debit, 0);
const credit = accounts.reduce((s, a) => s + a.credit, 0);
const net = debit - credit;
check(
  "Sample.xlsx: trial balance nets to zero",
  Math.round(net * 100) === 0,
  `net=${net.toFixed(2)} (Dr ${debit.toFixed(2)} / Cr ${credit.toFixed(2)})`,
);

// --- (b) COA number is an authoritative constraint --------------------------
const cfg = defaultConfig();
const rules = compileRules(cfg.entities["1065"], cfg.weakTokens);

check(
  "COA: 1120.0000 derives to Assets",
  coaCategoryFromNumber("1120.0000")?.label === "Assets",
);
check(
  "COA: 3000.1001 sub-account derives to Equity",
  coaCategoryFromNumber("3000.1001")?.label === "Equity",
);
check(
  "COA: number stored as a JS number still derives",
  coaCategoryFromNumber(4500)?.label === "Revenue / Income",
);

// Names that match expense/income keywords, but on a 1xxx asset account they
// must never be assigned an expense or income line.
const expenseyNames = [
  "Insurance",
  "Repairs",
  "Advertising",
  "Utilities",
  "Interest Expense",
  "Cleaning and Maintenance",
  "Rental Income",
];
const assetNumbers = ["1120.0000", "1200", "1700.50"];
for (const num of assetNumbers) {
  for (const nm of expenseyNames) {
    const c = classify(nm, rules, num);
    const bad = c.section === "expense" || c.section === "income";
    check(
      `COA: "#${num} ${nm}" is not income/expense`,
      !bad,
      `→ ${c.taxLine} [${c.section || "—"}]`,
    );
  }
}

// Positive control: an asset name on a 1xxx number still maps to an asset line.
const cash = classify("Operating Account", rules, "1120.0000");
check(
  "COA: 1120.0000 'Operating Account' maps to an asset line",
  cash.section === "asset",
  `→ ${cash.taxLine}`,
);

console.log(
  failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
