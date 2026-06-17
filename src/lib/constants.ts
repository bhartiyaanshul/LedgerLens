import type { EntityType, Section, TaxConfig, TaxLine } from "./types";

// ---------------------------------------------------------------------------
// Tax-code seeds. Codes are the standard "Tax Code Listing for Chart of
// Accounts Setup" values (1065, 1120S, 1120) and the 1040 listing (Schedule E).
// They route a GL account to a specific form line. Everything here is editable
// by the firm — nothing is fixed.
//
// (Rental real estate income/expense uses the Rent & Royalty schedule, which
//  flows to Form 8825 for 1065/1120S returns.)
// ---------------------------------------------------------------------------

export const CONFIG_VERSION = 3;
export const STORAGE_KEY = "ledgerlens.taxconfig.v3";

/** Special, non-tax-line outcomes/buckets. */
export const UNASSIGNED = "Unassigned"; // rules found no match
export const REVIEW = "Needs Review"; // two+ lines collided
export const EXCLUDE = "Do not import"; // maps to code 99999 (skip on import)
export const EXCLUDE_CODE = "99999";

export const DEFAULT_WEAK_TOKENS = [
  "fee", "fees", "expense", "expenses", "other", "misc", "miscellaneous",
  "income", "charge", "charges", "general",
];

export type EntityMeta = {
  id: EntityType;
  label: string;
  form: string;
  description: string;
  hasBalanceSheet: boolean;
};

export const ENTITIES: EntityMeta[] = [
  {
    id: "1065",
    label: "Partnership",
    form: "Form 1065",
    description: "Rental real estate (Form 8825) + Schedule L balance sheet",
    hasBalanceSheet: true,
  },
  {
    id: "1120S",
    label: "S-Corporation",
    form: "Form 1120-S",
    description: "Rental real estate (Form 8825) + Schedule L balance sheet",
    hasBalanceSheet: true,
  },
  {
    id: "1120",
    label: "C-Corporation",
    form: "Form 1120",
    description: "Rental income/expense + Schedule L balance sheet",
    hasBalanceSheet: true,
  },
  {
    id: "1040E",
    label: "Individual",
    form: "Form 1040, Schedule E",
    description: "Rental & royalty income/expenses (no balance sheet)",
    hasBalanceSheet: false,
  },
];

export function entityMeta(id: EntityType): EntityMeta {
  return ENTITIES.find((e) => e.id === id) ?? ENTITIES[0];
}

// [name, code, section, formLine, keywords]
type Seed = [string, string, Section, string, string[]];

// --- Shared rental real estate income/expense (Form 8825) -------------------
// The tax code is the stable key: per the standard "Tax Code Listing for Chart
// of Accounts Setup", a code routes a GL account to a form line, and the
// code→line mapping is maintained as the forms change — so the code is what we
// assign, and the formLine below is just a human label. Those labels reflect
// the Form 8825 (Rev. December 2025) layout, which reordered the expense lines
// (Interest L8 / Legal L9 / Real estate taxes L10 / Repairs L11) and moved
// "Other" to Line 17 (Schedule A). Shared across 1065 / 1120S / 1120 (Rent &
// Royalty); codes are identical.
const RENTAL_8825: Seed[] = [
  ["Gross rents", "502", "income", "Form 8825, Line 2a", [
    "gross rents", "rental income", "rent income", "rents received", "rental revenue", "rent revenue", "lease income", "rents", "tenant rent", "base rent",
  ]],
  ["Other rental income", "590", "income", "Form 8825, Line 2b", [
    "other rental income", "other income", "laundry", "laundry income", "vending", "vending income", "late fee", "late fees", "application fee", "application fees", "pet fee", "pet rent", "parking income", "storage income", "forfeited deposit", "forfeited deposits",
  ]],
  ["Advertising", "503", "expense", "Form 8825, Line 3", [
    "advertising", "marketing", "promotion", "listing fee",
  ]],
  ["Auto and travel", "504", "expense", "Form 8825, Line 4", [
    "auto", "travel", "mileage", "vehicle", "transportation",
  ]],
  ["Cleaning and maintenance", "505", "expense", "Form 8825, Line 5", [
    "cleaning", "maintenance", "repairs and maintenance", "janitorial", "landscaping", "lawn", "lawn care", "pest control", "snow removal", "grounds", "groundskeeping", "turnover",
  ]],
  ["Commissions", "506", "expense", "Form 8825, Line 6", [
    "commission", "commissions", "leasing commission", "leasing commissions", "broker fee",
  ]],
  ["Insurance", "507", "expense", "Form 8825, Line 7", [
    "insurance", "liability insurance", "property insurance", "hazard insurance", "flood insurance",
  ]],
  ["Interest", "509", "expense", "Form 8825, Line 8", [
    "interest", "mortgage interest", "loan interest", "interest expense",
  ]],
  ["Legal and professional fees", "508", "expense", "Form 8825, Line 9", [
    "legal", "attorney", "professional fees", "legal and professional", "accounting", "bookkeeping", "audit", "tax prep", "cpa", "consulting",
  ]],
  ["Real estate taxes", "511", "expense", "Form 8825, Line 10", [
    "real estate tax", "real estate taxes", "property tax", "property taxes", "taxes",
  ]],
  ["Repairs", "510", "expense", "Form 8825, Line 11", [
    "repairs", "repair",
  ]],
  ["Utilities", "512", "expense", "Form 8825, Line 12", [
    "utilities", "electric", "electricity", "water", "sewer", "trash", "garbage", "gas", "internet", "telephone", "phone",
  ]],
  ["Wages and salaries", "513", "expense", "Form 8825, Line 13", [
    "wages", "salaries", "salary", "payroll", "labor",
  ]],
  ["Depreciation", "514", "expense", "Form 8825, Line 14", [
    "depreciation", "depreciation expense",
  ]],
  ["Amortization", "587", "expense", "Form 8825, Line 17 (Sch A)", [
    "amortization", "amortization expense",
  ]],
  ["Other expenses", "515", "expense", "Form 8825, Line 17 (Sch A)", [
    "other expenses", "supplies", "office supplies", "office", "management fee", "management fees", "property management", "hoa", "dues", "bank charges", "service charges", "bank service charges", "licenses", "permits",
  ]],
];

// --- Schedule L assets shared across 1065 / 1120S / 1120 (codes match) ------
const SCHED_L_ASSETS_COMMON: Seed[] = [
  ["Cash", "400", "asset", "Sch L, Line 1", [
    "cash", "checking", "savings", "money market", "petty cash",
    "bank account", "checking account", "savings account", "operating account",
  ]],
  ["Accounts receivable", "401", "asset", "Sch L, Line 2a", [
    "accounts receivable", "trade receivable", "receivable", "a/r", "tenant receivable",
  ]],
  ["Allowance for bad debts", "402", "asset", "Sch L, Line 2b", [
    "allowance for bad debts", "allowance for doubtful", "bad debt allowance",
  ]],
  ["Inventories", "403", "asset", "Sch L, Line 3", ["inventory", "inventories"]],
  ["U.S. government obligations", "404", "asset", "Sch L, Line 4", [
    "u.s. government", "us government", "treasury", "government obligation",
  ]],
  ["Tax-exempt securities", "405", "asset", "Sch L, Line 5", [
    "tax-exempt", "tax exempt securities", "municipal bond", "muni bond",
  ]],
  ["Other current assets", "406", "asset", "Sch L, Line 6", [
    "prepaid", "prepaid expense", "prepaid insurance", "escrow", "other current asset", "deposits held",
  ]],
  ["Other investments", "416", "asset", "Sch L, Line 8", [
    "investment", "investments", "marketable securities", "securities",
  ]],
  ["Buildings and other depreciable assets", "425", "asset", "Sch L, Line 9a", [
    "building", "buildings", "depreciable", "furniture", "fixtures", "equipment", "improvements", "leasehold",
  ]],
  ["Accumulated depreciation", "426", "asset", "Sch L, Line 9b", [
    "accumulated depreciation", "accum depreciation", "accum depr",
  ]],
  ["Depletable assets", "427", "asset", "Sch L, Line 10a", ["depletable"]],
  ["Accumulated depletion", "428", "asset", "Sch L, Line 10b", [
    "accumulated depletion",
  ]],
  ["Land", "429", "asset", "Sch L, Line 11", ["land"]],
  ["Intangible assets", "430", "asset", "Sch L, Line 12a", [
    "intangible", "goodwill", "organization cost", "organizational cost",
  ]],
  ["Accumulated amortization", "431", "asset", "Sch L, Line 12b", [
    "accumulated amortization", "accum amort",
  ]],
  ["Other assets", "432", "asset", "Sch L, Line 13", [
    "other asset", "other assets", "security deposit",
  ]],
];

// --- Schedule L liabilities/capital — PARTNERSHIP (1065) --------------------
const SCHED_L_LIAB_1065: Seed[] = [
  ["Accounts payable", "440", "liability", "Sch L, Line 15", [
    "accounts payable", "trade payable", "a/p",
  ]],
  ["Mortgages/notes payable < 1 year", "441", "liability", "Sch L, Line 16", [
    "current portion", "note payable current", "short-term", "short term",
  ]],
  ["Other current liabilities", "442", "liability", "Sch L, Line 17", [
    "accrued", "accrued expense", "accrued liabilities", "payroll liabilities", "tenant deposit", "security deposits", "prepaid rent", "deferred",
  ]],
  ["All nonrecourse loans", "443", "liability", "Sch L, Line 18", ["nonrecourse"]],
  ["Loans from partners", "444", "liability", "Sch L, Line 19a", [
    "loan from partner", "due to partner", "partner loan", "partner advance",
  ]],
  ["Mortgages/notes payable ≥ 1 year", "450", "liability", "Sch L, Line 19b", [
    "mortgage payable", "note payable", "long-term debt", "long term debt", "bonds payable", "loan payable", "notes payable",
  ]],
  ["Other liabilities", "451", "liability", "Sch L, Line 20", [
    "other liability", "other liabilities",
  ]],
  ["Partners' capital accounts", "465", "equity", "Sch L, Line 21", [
    "capital", "partner capital", "member equity", "members equity", "equity", "retained earnings", "draws", "distributions",
  ]],
];

const LOANS_TO_PARTNERS: Seed = [
  "Loans to partners", "407", "asset", "Sch L, Line 7a", [
    "loan to partner", "due from partner", "note receivable partner",
  ],
];
const MORTGAGE_RE_LOANS: Seed = [
  "Mortgage and real estate loans", "415", "asset", "Sch L, Line 7b", [
    "mortgage receivable", "real estate loan",
  ],
];

// --- Schedule L liabilities/capital — S-CORP (1120S) ------------------------
const SCHED_L_LIAB_1120S: Seed[] = [
  ["Accounts payable", "440", "liability", "Sch L, Line 16", [
    "accounts payable", "trade payable", "a/p",
  ]],
  ["Mortgages/notes payable < 1 year", "441", "liability", "Sch L, Line 17", [
    "current portion", "note payable current", "short-term", "short term",
  ]],
  ["Other current liabilities", "442", "liability", "Sch L, Line 18", [
    "accrued", "accrued expense", "payroll liabilities", "tenant deposit", "security deposits", "deferred",
  ]],
  ["Loans from shareholders", "445", "liability", "Sch L, Line 19", [
    "loan from shareholder", "due to shareholder", "shareholder loan", "officer loan",
  ]],
  ["Mortgages/notes payable ≥ 1 year", "450", "liability", "Sch L, Line 20", [
    "mortgage payable", "note payable", "long-term debt", "long term debt", "bonds payable", "loan payable", "notes payable",
  ]],
  ["Other liabilities", "451", "liability", "Sch L, Line 21", [
    "other liability", "other liabilities",
  ]],
  ["Capital stock", "466", "equity", "Sch L, Line 22", [
    "capital stock", "common stock", "preferred stock",
  ]],
  ["Paid-in or capital surplus", "467", "equity", "Sch L, Line 23", [
    "paid-in capital", "paid in capital", "additional paid", "capital surplus", "apic",
  ]],
  ["Retained earnings", "468", "equity", "Sch L, Line 24", [
    "retained earnings", "accumulated adjustments", "distributions", "equity",
  ]],
  ["Less cost of treasury stock", "472", "equity", "Sch L, Line 26", [
    "treasury stock",
  ]],
];
const LOANS_TO_SHAREHOLDERS: Seed = [
  "Loans to shareholders", "409", "asset", "Sch L, Line 7", [
    "loan to shareholder", "due from shareholder", "officer receivable",
  ],
];

// --- Schedule L liabilities/capital — C-CORP (1120) -------------------------
const SCHED_L_LIAB_1120: Seed[] = [
  ["Accounts payable", "440", "liability", "Sch L, Line 16", [
    "accounts payable", "trade payable", "a/p",
  ]],
  ["Mortgages/notes payable < 1 year", "441", "liability", "Sch L, Line 17", [
    "current portion", "note payable current", "short-term", "short term",
  ]],
  ["Other current liabilities", "442", "liability", "Sch L, Line 18", [
    "accrued", "accrued expense", "income tax payable", "deferred",
  ]],
  ["Loans from stockholders", "445", "liability", "Sch L, Line 19", [
    "loan from stockholder", "due to stockholder", "shareholder loan",
  ]],
  ["Mortgages/notes payable ≥ 1 year", "450", "liability", "Sch L, Line 20", [
    "mortgage payable", "note payable", "long-term debt", "long term debt", "bonds payable", "loan payable",
  ]],
  ["Other liabilities", "451", "liability", "Sch L, Line 21", [
    "other liability", "other liabilities",
  ]],
  ["Capital stock", "466", "equity", "Sch L, Line 22b", [
    "capital stock", "common stock", "preferred stock",
  ]],
  ["Paid-in or capital surplus", "467", "equity", "Sch L, Line 23", [
    "paid-in capital", "paid in capital", "additional paid", "capital surplus", "apic",
  ]],
  ["Retained earnings (unappropriated)", "469", "equity", "Sch L, Line 25", [
    "retained earnings", "earnings",
  ]],
  ["Less cost of treasury stock", "471", "equity", "Sch L, Line 27", [
    "treasury stock",
  ]],
];

// --- 1040 Schedule E (rental & royalty) -------------------------------------
const SCHED_E_1040: Seed[] = [
  ["Rental income", "503", "income", "Sch E, Line 3", [
    "rental income", "rent income", "gross rents", "rents received", "rental revenue", "rents",
  ]],
  ["Royalty income", "504", "income", "Sch E, Line 4", ["royalty", "royalties"]],
  ["Advertising", "505", "expense", "Sch E, Line 5", ["advertising", "marketing", "promotion"]],
  ["Auto and travel", "506", "expense", "Sch E, Line 6", ["auto", "travel", "mileage", "vehicle"]],
  ["Cleaning and maintenance", "507", "expense", "Sch E, Line 7", [
    "cleaning", "maintenance", "janitorial", "landscaping", "lawn", "pest control", "snow removal",
  ]],
  ["Commissions", "508", "expense", "Sch E, Line 8", ["commission", "commissions"]],
  ["Insurance", "509", "expense", "Sch E, Line 9", ["insurance"]],
  ["Legal and other professional fees", "510", "expense", "Sch E, Line 10", [
    "legal", "attorney", "professional fees", "accounting", "bookkeeping", "tax prep", "cpa",
  ]],
  ["Management fees", "511", "expense", "Sch E, Line 11", [
    "management fee", "management fees", "property management", "mgmt fee",
  ]],
  ["Mortgage interest", "512", "expense", "Sch E, Line 12", [
    "mortgage interest", "interest paid to banks", "home mortgage",
  ]],
  ["Other interest", "513", "expense", "Sch E, Line 13", ["other interest", "interest"]],
  ["Repairs", "514", "expense", "Sch E, Line 14", ["repairs", "repair"]],
  ["Supplies", "515", "expense", "Sch E, Line 15", ["supplies"]],
  ["Taxes", "516", "expense", "Sch E, Line 16", [
    "property tax", "real estate tax", "property taxes", "real estate taxes", "taxes",
  ]],
  ["Utilities", "517", "expense", "Sch E, Line 17", [
    "utilities", "electric", "electricity", "water", "sewer", "trash", "gas", "internet",
  ]],
  ["Depreciation", "520", "expense", "Sch E, Line 18", ["depreciation", "depr"]],
  ["Other expenses", "518", "expense", "Sch E, Line 19", [
    "other expenses", "miscellaneous", "hoa", "dues", "bank charges", "office", "wages", "salaries",
  ]],
];

function toLines(seeds: Seed[], entity: EntityType): TaxLine[] {
  return seeds.map(([name, code, section, formLine, keywords]) => ({
    id: `${entity}-${code}`,
    name,
    code,
    section,
    formLine,
    keywords: [...keywords],
  }));
}

function build1065(): TaxLine[] {
  return toLines(
    [
      ...RENTAL_8825,
      ...SCHED_L_ASSETS_COMMON.slice(0, 8), // through Other current assets
      LOANS_TO_PARTNERS,
      MORTGAGE_RE_LOANS,
      ...SCHED_L_ASSETS_COMMON.slice(8), // investments onward
      ...SCHED_L_LIAB_1065,
    ],
    "1065",
  );
}

function build1120S(): TaxLine[] {
  return toLines(
    [
      ...RENTAL_8825,
      ...SCHED_L_ASSETS_COMMON.slice(0, 8),
      LOANS_TO_SHAREHOLDERS,
      MORTGAGE_RE_LOANS,
      ...SCHED_L_ASSETS_COMMON.slice(8),
      ...SCHED_L_LIAB_1120S,
    ],
    "1120S",
  );
}

function build1120(): TaxLine[] {
  return toLines(
    [
      ...RENTAL_8825,
      ...SCHED_L_ASSETS_COMMON.slice(0, 8),
      LOANS_TO_SHAREHOLDERS,
      MORTGAGE_RE_LOANS,
      ...SCHED_L_ASSETS_COMMON.slice(8),
      ...SCHED_L_LIAB_1120,
    ],
    "1120",
  );
}

function build1040E(): TaxLine[] {
  return toLines(SCHED_E_1040, "1040E");
}

export function defaultConfig(): TaxConfig {
  return {
    version: CONFIG_VERSION,
    entities: {
      "1065": build1065(),
      "1120S": build1120S(),
      "1120": build1120(),
      "1040E": build1040E(),
    },
    weakTokens: [...DEFAULT_WEAK_TOKENS],
  };
}

// ---------------------------------------------------------------------------
// Trial-balance column auto-detection.
// ---------------------------------------------------------------------------

export const COLUMN_ALIASES: Record<
  "accountNumber" | "description" | "balance" | "debit" | "credit",
  string[]
> = {
  accountNumber: [
    "account number", "account no", "acct no", "acct #", "account #", "acct number", "gl account", "account code", "acct", "number",
  ],
  description: [
    "account description", "account name", "description", "account title", "acct description", "acct name", "name", "account", "gl description", "particulars",
  ],
  balance: [
    "balance", "net balance", "ending balance", "amount", "current balance", "net", "balance (net)", "trial balance",
  ],
  debit: ["debit", "debits", "dr", "debit balance", "debit amount"],
  credit: ["credit", "credits", "cr", "credit balance", "credit amount"],
};
