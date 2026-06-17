// ---------------------------------------------------------------------------
// Account-name normalization for the categorizer.
//
// Real trial balances name accounts inconsistently: "Cash - Operating",
// "A/R - Trade", "Depr Exp - Bldg", "R&M", "Util Expense". To match these
// against a keyword lexicon robustly we first fold them onto a canonical form:
//
//   - lower-cased, ASCII-folded
//   - "&" -> " and ", "/" and other punctuation -> spaces
//   - common accounting abbreviations expanded to their full words
//   - whitespace collapsed
//
// The expansion list is deliberately CONSERVATIVE: every entry is an
// abbreviation a CPA reads only one way in a chart-of-accounts context. We
// avoid ambiguous stems (e.g. "comm" could be commission or communication;
// "dep" could be deposit or depreciation) so normalization never changes the
// meaning of an account.
// ---------------------------------------------------------------------------

/** Slash / ampersand abbreviations resolved before punctuation is stripped. */
const PUNCT_ABBREVIATIONS: [RegExp, string][] = [
  [/\ba\s*\/\s*r\b/gi, " accounts receivable "],
  [/\ba\s*\/\s*p\b/gi, " accounts payable "],
  [/\bn\s*\/\s*p\b/gi, " notes payable "],
  [/\bn\s*\/\s*r\b/gi, " notes receivable "],
  [/\br\s*\/\s*e\b/gi, " real estate "],
  [/\bp\s*&\s*l\b/gi, " profit and loss "],
];

/** Single-token abbreviations, expanded only as whole words. */
const TOKEN_ABBREVIATIONS: Record<string, string> = {
  // depreciation / amortization
  depr: "depreciation",
  deprec: "depreciation",
  deprn: "depreciation",
  amort: "amortization",
  accum: "accumulated",
  accumd: "accumulated",
  // insurance / interest / expense
  ins: "insurance",
  insur: "insurance",
  int: "interest",
  exp: "expense",
  exps: "expense",
  // property / mortgage / utilities / management
  mtg: "mortgage",
  mtge: "mortgage",
  mort: "mortgage",
  util: "utilities",
  utils: "utilities",
  utl: "utilities",
  mgmt: "management",
  mgt: "management",
  prop: "property",
  // receivable / payable
  recv: "receivable",
  rcvbl: "receivable",
  pybl: "payable",
  paybl: "payable",
  // fixed assets
  equip: "equipment",
  eqpt: "equipment",
  bldg: "building",
  bldgs: "buildings",
  furn: "furniture",
  fixt: "fixtures",
  // misc
  maint: "maintenance",
  mtce: "maintenance",
  prof: "professional",
  admin: "administrative",
  misc: "miscellaneous",
  svc: "service",
  svcs: "services",
  serv: "service",
  ppd: "prepaid",
  advt: "advertising",
  advtg: "advertising",
  advert: "advertising",
};

/** Multi-word forms expanded after token-level normalization. */
const PHRASE_ABBREVIATIONS: [RegExp, string][] = [
  [/\br and m\b/g, "repairs and maintenance"],
  [/\bg and a\b/g, "general and administrative"],
  [/\bf and f\b/g, "furniture and fixtures"],
];

/**
 * Fold a raw account name onto the canonical matching form. Idempotent: running
 * it on an already-normalized string returns the same string.
 */
export function normalizeName(raw: string): string {
  let s = (raw ?? "").toString().toLowerCase();

  // Strip accents so "café"/"resumé"-style entries fold to ASCII.
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

  // Resolve punctuated abbreviations while their separators still exist.
  for (const [re, rep] of PUNCT_ABBREVIATIONS) s = s.replace(re, rep);

  // "&" reads as "and"; every other non-alphanumeric becomes a space.
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Whole-word abbreviation expansion.
  s = s
    .split(" ")
    .map((t) => TOKEN_ABBREVIATIONS[t] ?? t)
    .join(" ");

  for (const [re, rep] of PHRASE_ABBREVIATIONS) s = s.replace(re, rep);

  return s.replace(/\s+/g, " ").trim();
}
