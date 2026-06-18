import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type {
  CategorizeAccount,
  CategorizeCategory,
  CategorizeResultItem,
  Confidence,
  Section,
} from "@/lib/types";
import { COA_RANGES, coaSectionsFromNumber } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Server-side LLM fallback categorizer.
//
//   POST /api/categorize
//     body: { accounts: {name, number?}[], categories: {name, section}[] }
//     ->   [{ index, category, confidence }]
//
// Each account is sent with its NAME and its account NUMBER. The number's
// chart-of-accounts series is an AUTHORITATIVE constraint: the prompt forbids,
// and this route then rejects, any tax line whose section conflicts with the
// type the number implies (e.g. an expense line on a 1xxx asset account).
//
// PRIVACY: this route receives account NAMES and NUMBERS only. The client never
// sends amounts, dates, balances, or any other values. The provider API key
// lives in server env vars and is read only here — never shipped to the browser.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"; // the provider SDKs need the Node runtime
export const maxDuration = 30; // bound a single batch well under Vercel limits

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const MAX_ACCOUNTS = 60; // a single batch; the client sends ~30–40

type Provider = "groq" | "gemini";

function getProvider(): Provider {
  return (process.env.LLM_PROVIDER ?? "groq").toLowerCase() === "gemini"
    ? "gemini"
    : "groq";
}

/** Sleep helper that does not depend on any timer being mocked. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  if (e?.status === 429) return true;
  return /\b429\b|rate.?limit|quota|resource.?exhausted/i.test(
    e?.message ?? "",
  );
}

/** Retry a provider call on 429 / transient errors with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;
  // 0.8s, 1.6s, 3.2s — keeps us polite to free-tier RPM limits.
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRateLimited(err)) throw err;
      await delay(800 * 2 ** (attempt - 1));
    }
  }
}

function buildPrompt(
  accounts: CategorizeAccount[],
  categories: CategorizeCategory[],
): string {
  // The COA convention comes from the tunable table in constants.ts, never
  // hardcoded here, so a firm can adjust the ranges without touching the prompt.
  const convention = COA_RANGES.map(
    (r) => `  ${r.range[0]}–${r.range[1]} → ${r.label} (${r.sections.join(" or ")})`,
  ).join("\n");
  const catLines = categories
    .map((c) => `- ${c.name}  [${c.section}]`)
    .join("\n");
  const listed = accounts
    .map((a, i) => `${i}. ${a.number ? `[#${a.number}] ` : ""}${a.name}`)
    .join("\n");
  return [
    "You categorize general-ledger (chart-of-accounts) accounts onto US tax-return lines.",
    "",
    "Each account is given as its NUMBER (in brackets) and NAME. In a standard chart of accounts the account number's leading digit encodes the account TYPE. This is AUTHORITATIVE — it outranks any hint from the name:",
    convention,
    "",
    "Rules:",
    "- Derive the account's statement section from its number using the table above.",
    "- Choose EXACTLY ONE tax line whose section matches that type.",
    "- NEVER pick a line from a conflicting section (e.g. never put an expense or income line on a 1xxx asset account). Such an answer is wrong and will be rejected.",
    '- If no listed line of the correct section fits, answer "Others".',
    "- Use the line names verbatim; do not invent new ones.",
    "",
    "Available tax lines (name and its section in brackets):",
    catLines,
    "",
    "Set confidence to high/medium/low based on how certain you are.",
    'Return JSON of the form:',
    '{ "results": [ { "index": <number>, "category": "<exact tax-line name or Others>", "confidence": "high|medium|low" } ] }',
    "Include one result object per account, using the index shown.",
    "",
    "Accounts:",
    listed,
  ].join("\n");
}

// --- Groq (OpenAI-compatible) ----------------------------------------------

async function categorizeWithGroq(
  accounts: CategorizeAccount[],
  categories: CategorizeCategory[],
): Promise<RawResult[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ConfigError("GROQ_API_KEY is not set on the server.");

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const completion = await withRetry(() =>
    client.chat.completions.create({
      model,
      temperature: 0,
      // JSON mode is supported across Groq's rotating catalog; we enforce the
      // category enum and the COA section constraint ourselves after parsing.
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output only valid JSON. Never wrap it in markdown fences.",
        },
        { role: "user", content: buildPrompt(accounts, categories) },
      ],
    }),
  );

  const text = completion.choices[0]?.message?.content ?? "{}";
  return parseModelJson(text);
}

// --- Google Gemini ----------------------------------------------------------

async function categorizeWithGemini(
  accounts: CategorizeAccount[],
  categories: CategorizeCategory[],
  categoryNames: string[],
): Promise<RawResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ConfigError("GEMINI_API_KEY is not set on the server.");

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          results: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                index: { type: SchemaType.INTEGER },
                category: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: categoryNames,
                },
                confidence: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: CONFIDENCES,
                },
              },
              required: ["index", "category", "confidence"],
            },
          },
        },
        required: ["results"],
      },
    },
  });

  const resp = await withRetry(() =>
    model.generateContent(buildPrompt(accounts, categories)),
  );
  return parseModelJson(resp.response.text());
}

// --- Shared parsing / validation -------------------------------------------

type RawResult = { index?: unknown; category?: unknown; confidence?: unknown };

class ConfigError extends Error {}

/** Tolerantly parse the model's JSON; accept either {results:[...]} or [...]. */
function parseModelJson(text: string): RawResult[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed as RawResult[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)) {
    return (parsed as { results: RawResult[] }).results;
  }
  return [];
}

/** Clamp model output to valid indices, the category enum, and confidences. */
function sanitizeResults(
  raw: RawResult[],
  count: number,
  validCategories: string[],
): CategorizeResultItem[] {
  const validSet = new Set(validCategories);
  const seen = new Set<number>();
  const out: CategorizeResultItem[] = [];
  for (const r of raw) {
    const index = Number(r.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    if (seen.has(index)) continue;
    seen.add(index);

    const category =
      typeof r.category === "string" && validSet.has(r.category)
        ? r.category
        : "Others";
    const confidence = CONFIDENCES.includes(r.confidence as Confidence)
      ? (r.confidence as Confidence)
      : "low";
    out.push({ index, category, confidence });
  }
  return out;
}

const SECTIONS: Section[] = ["income", "expense", "asset", "liability", "equity"];

function isAccount(v: unknown): v is CategorizeAccount {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    (o.number == null || typeof o.number === "string" || typeof o.number === "number")
  );
}

function isCategory(v: unknown): v is CategorizeCategory {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && SECTIONS.includes(o.section as Section);
}

/**
 * Final, authoritative guard: reject any pick whose section conflicts with the
 * account number's chart-of-accounts series. A rejected pick is turned into
 * "Others" so the client leaves the row for manual review rather than trusting
 * a cross-section answer the model shouldn't have given.
 */
function enforceCoaSections(
  results: CategorizeResultItem[],
  accounts: CategorizeAccount[],
  categories: CategorizeCategory[],
): CategorizeResultItem[] {
  const sectionByName = new Map(categories.map((c) => [c.name, c.section]));
  return results.map((r) => {
    const acct = accounts[r.index];
    const allowed = acct ? coaSectionsFromNumber(acct.number ?? "") : [];
    const sec = sectionByName.get(r.category);
    if (allowed.length > 0 && sec && !allowed.includes(sec)) {
      return { index: r.index, category: "Others", confidence: "low" };
    }
    return r;
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { accounts, categories } = (body ?? {}) as {
    accounts?: unknown;
    categories?: unknown;
  };

  if (!Array.isArray(accounts) || !accounts.every(isAccount)) {
    return NextResponse.json(
      { error: "`accounts` must be an array of { name, number? } objects." },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    !categories.every(isCategory)
  ) {
    return NextResponse.json(
      { error: "`categories` must be a non-empty array of { name, section } objects." },
      { status: 400 },
    );
  }
  if (accounts.length === 0) {
    return NextResponse.json([] satisfies CategorizeResultItem[]);
  }
  if (accounts.length > MAX_ACCOUNTS) {
    return NextResponse.json(
      { error: `Send at most ${MAX_ACCOUNTS} accounts per request.` },
      { status: 400 },
    );
  }

  // De-dupe the candidate lines and always allow "Others" as an escape hatch.
  const seen = new Set<string>();
  const validCategories: CategorizeCategory[] = [];
  for (const c of categories) {
    const name = c.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    validCategories.push({ name, section: c.section });
  }
  const categoryNames = [...validCategories.map((c) => c.name), "Others"];

  try {
    const provider = getProvider();
    const raw =
      provider === "gemini"
        ? await categorizeWithGemini(accounts, validCategories, categoryNames)
        : await categorizeWithGroq(accounts, validCategories);
    const results = enforceCoaSections(
      sanitizeResults(raw, accounts.length, categoryNames),
      accounts,
      validCategories,
    );
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = isRateLimited(err) ? 429 : 502;
    // Never crash the client flow — it will leave these rows for manual review.
    return NextResponse.json(
      { error: `LLM provider error: ${message}` },
      { status },
    );
  }
}
