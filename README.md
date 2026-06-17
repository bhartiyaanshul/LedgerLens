# LedgerLens — Trial Balance → Tax Lines

**Upload a client's trial balance → auto-assign US tax codes → review & correct → export a categorized workbook with a tax-line pivot.**

LedgerLens is a focused web app for CPAs and bookkeepers who prepare **rental real estate** returns. It turns a raw trial balance into a categorized workbook in a 6-step wizard — mapping each GL account to the correct **tax line** and its **tax code** (the number that routes an account to a specific form line).

- 🇺🇸 **US tax–aware**, with the standard tax-code sets for **Form 1065** (partnership), **Form 1120-S** (S-corp), **Form 1120** (C-corp), and **Form 1040 Schedule E** (individual rental).
- 🧮 **Fast local rule engine** with **word-boundary** keyword matching and **specificity disambiguation** (so "Accumulated Depreciation – Building" maps to *Accumulated depreciation*, not *Building*).
- 🤖 **Optional AI fallback** for accounts the rules can't place — provider-agnostic (Groq or Gemini), API key kept **server-side only**.
- 📄 **Two-sheet export** — a detail sheet (*Account Number · Account Name · Amount · Tax line*) and a **pivot grouped by tax line** with subtotals. Totals net to zero when the books balance.
- ✅ **Built-in trial-balance check** (debits = credits) and a full audit trail for every account.
- 💾 **No database** — tax-code config persists in `localStorage` with JSON import/export.

> ⚠️ **This is a categorization aid, not tax advice.** Every assignment is editable and must be reviewed by the preparer. Confirm tax codes against your tax software's current code list — they're revised over time.

---

## How it works

A 6-step wizard:

1. **Upload** — drag & drop the trial balance (CSV/XLSX), or click *Try sample data*. Parsed entirely in the browser; if the workbook has several tabs, pick which one to import.
2. **Map columns** — auto-detects *Account Number*, *Account Description*, and either separate *Debit*/*Credit* columns or one signed *Balance*, and shows a live **balance check** (debits = credits) on the chosen tab.
3. **Tax setup** — pick the return type (1065 / 1120-S / 1120 / 1040 Sch E) and review/edit the tax lines, their **tax codes**, and matching keywords. Saved to `localStorage`.
4. **Categorize** — the rule engine runs locally; optionally send the leftovers to the LLM. Live progress + coverage %.
5. **Review** — an editable, sortable, filterable table with inline tax-line dropdowns (auto-filling the code), bulk re-assign, low-confidence highlighting, and a live **trial-balance balance check**.
6. **Export** — download the two-sheet `.xlsx` (detail + tax-line pivot), with a return summary (net income, total assets, liabilities & capital).

### The rule engine (client-side)

Each account maps to **exactly one** tax line:

- **One line matches** → assign it (`high`, or `medium` if it matched only a weak/generic token like *fee* or *other*).
- **Several lines match** → the line with the **most specific (longest) keyword** wins, assigned at `medium` so it still surfaces for review (e.g. *Prepaid Insurance* → *Other current assets*, not *Insurance*). A genuine tie → **Needs Review**.
- **No match** → **Unassigned** (you assign it in Review, or let AI suggest).

Keywords match the **account name** with word-boundary regex (`\bkeyword\b`), so `rent` never matches inside `current`. Every account records *why* it landed where it did (matched keyword, collision, or "categorised by model") plus its original row — a non-negotiable audit trail, because the preparer signs the return.

### The tax codes

Tax codes are the standard values from the *"Tax Code Listing for Chart of Accounts Setup"* (1065/1120-S/1120) and the 1040 listing (Schedule E). Examples for **Form 8825 / 1065**:

| Form 8825 line | Code | | Schedule L line | Code |
|---|---|---|---|---|
| Gross rents | 502 | | Cash | 400 |
| Advertising | 503 | | Accounts receivable | 401 |
| Auto and travel | 504 | | Buildings / depreciable assets | 425 |
| Cleaning and maintenance | 505 | | Accumulated depreciation | 426 |
| Insurance | 507 | | Land | 429 |
| Legal and professional | 508 | | Accounts payable | 440 |
| Interest | 509 | | Mortgages/notes ≥ 1 yr | 450 |
| Repairs | 510 | | Loans from partners | 444 |
| Taxes | 511 | | Partners' capital | 465 |
| Utilities | 512 | | … | … |

All codes and keywords are editable in **Tax setup** and exportable/importable as JSON, so your firm can tune them once and reuse across clients.

### The export

Two sheets in one `.xlsx`:

1. **Trial Balance** — one row per account: *Account Number · Account Name · Amount · Tax line*, in the original trial-balance order, ending with a bold **Total** row.
2. **Tax line pivot** — the same accounts grouped by **tax line**, ordered by statement section (income, expense, assets, liabilities, capital), with a **subtotal** per tax line and a grand total.

Notes:

- The **tax line name** is shown (not the numeric code), matching the firm's review format.
- **Amount sign** = signed net balance (**debit positive, credit negative**) — the standard trial-balance convention, so every total nets to **zero** when the books balance.
- Accounts you leave **Unassigned** export under an *Unassigned* group so they're visibly unmapped until resolved.

---

## Quick start

Requirements: **Node 18.18+** (20/22/24 recommended) and npm.

```bash
npm install

# optional — only needed for the AI fallback
cp .env.example .env.local      # then add GROQ_API_KEY or GEMINI_API_KEY

npm run dev                     # http://localhost:3000
```

Click **"Try sample data"** to run a bundled rental-real-estate partnership trial balance through the whole flow with no API key.

Production build:

```bash
npm run build && npm run start
```

> The app is fully usable with AI **off** — the rule engine runs in the browser and needs no API key.

---

## Environment variables

All variables are **server-only** (no `NEXT_PUBLIC_` prefix), read only inside the `/api/categorize` route — the API key never ships to the browser.

| Variable        | Required        | Description                                              |
| --------------- | --------------- | ------------------------------------------------------- |
| `LLM_PROVIDER`  | for AI          | `groq` (default) or `gemini`                             |
| `GROQ_API_KEY`  | if using Groq   | Free key from [console.groq.com](https://console.groq.com) |
| `GROQ_MODEL`    | optional        | Default `llama-3.3-70b-versatile`                       |
| `GEMINI_API_KEY`| if using Gemini | Free key from [aistudio.google.com](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL`  | optional        | Default `gemini-2.5-flash`                               |

> Model IDs rotate — confirm the current one at console.groq.com or Google AI Studio.

---

## ⚠️ Data privacy — please read

This app handles **confidential client financial data**.

- The trial balance is **parsed and categorized in your browser**. The raw file is never uploaded.
- When AI is on, **only the account name/description text** of low-confidence accounts is sent to the LLM — never amounts, balances, or account numbers.
- **Account names can themselves contain client info** (e.g. a property address). Review your chart of accounts before enabling AI.
- The first time you use AI, a notice explains this and that **free LLM tiers (Groq and Gemini) may train on submitted prompts**. For real client data, use a paid / no-training tier (or **Vertex AI** for Gemini), or keep AI off.

---

## Tech & a note on the Excel library

- **Next.js (App Router) + TypeScript**, **Tailwind CSS + shadcn/ui**.
- **Reading** uploads uses **SheetJS (`xlsx`)** — an excellent parser (patched `xlsx@0.20.3` from the SheetJS CDN).
- **Writing** the export uses **ExcelJS** — the free/community SheetJS build can't produce bold headers or frozen panes; ExcelJS can, runs in the browser, and is dynamically imported to stay out of the initial bundle.
- **LLM** access is provider-agnostic (Groq via the OpenAI SDK, or Gemini), entirely behind the server route.
- **No database** — config lives in `localStorage` (`src/lib/config.ts`); the seam to add Supabase/Vercel Postgres later is to swap `loadConfig`/`saveConfig` for async calls keeping the same `TaxConfig` shape.

### Project structure

```
src/
  app/
    page.tsx                 # the 6-step wizard orchestrator
    api/categorize/route.ts  # SERVER-ONLY LLM route (Groq / Gemini switch)
  lib/
    types.ts                 # TaxLine, TbAccount, TaxConfig, EntityType, …
    constants.ts             # standard tax-code seeds per entity
    engine.ts                # rule engine (word-boundary + specificity)
    parse.ts                 # trial-balance parsing + column auto-detect
    export.ts                # two-sheet workbook builder: detail + pivot (ExcelJS)
    config.ts                # localStorage load/save + JSON import/export
    llm-client.ts            # client wrapper: batching, progress, retry-tolerant
  components/wizard/         # stepper + the six steps + privacy notice
public/
  sample-trial-balance.csv   # balanced rental-real-estate partnership sample
```

---

## Deploying to Vercel (free tier)

1. Push to GitHub.
2. [vercel.com](https://vercel.com) → **New Project** → import the repo (auto-detects Next.js).
3. **Project Settings → Environment Variables** → add the variables above (no `NEXT_PUBLIC_`).
4. **Deploy.** `/api/categorize` runs as a serverless function on the free tier. No database or paid services required.

---

## Phase 2 — roadmap (not built yet)

- **More entity coverage** — full ordinary-business P&L (not just rental), 1041, 990; per-line meals/officer-comp nuances.
- **PDF / scanned trial balances** with OCR; per-software TB export templates.
- **Persistence + per-client mapping profiles** (Supabase or Vercel Postgres free tier).
- **Learning loop** — feed the preparer's corrections back into the rule set so coverage grows over time.
- **Multi-property units** — auto-assign the *Unit* column for multi-activity 8825 returns.
- **Auth** for multi-user firms.

---

## License

Provided as-is for the project owner's use. Not tax, legal, or accounting advice.
```
