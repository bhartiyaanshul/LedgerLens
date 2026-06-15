import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { CategorizeResultItem, Confidence } from "@/lib/types";

// ---------------------------------------------------------------------------
// Server-side LLM fallback categorizer.
//
//   POST /api/categorize   body: { descriptions: string[], categories: string[] }
//   ->  [{ index, category, confidence }]
//
// PRIVACY: this route receives ONLY description strings. The client never sends
// amounts, dates, account numbers, balances, or names beyond what is already in
// the description. The provider API key lives in server env vars and is read
// only here — it is never shipped to the browser bundle.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"; // the provider SDKs need the Node runtime
export const maxDuration = 30; // bound a single batch well under Vercel limits

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const MAX_DESCRIPTIONS = 60; // a single batch; the client sends ~30–40

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

function buildPrompt(descriptions: string[], validCategories: string[]): string {
  const listed = descriptions.map((d, i) => `${i}. ${d}`).join("\n");
  return [
    "You are an accounting assistant for a Chartered Accountant.",
    "Categorise each bank-transaction description into EXACTLY ONE of these",
    "expense heads (use these names verbatim — do not invent new categories):",
    validCategories.map((c) => `- ${c}`).join("\n"),
    "",
    'Use "Others" only when nothing genuinely fits.',
    "Set confidence to high/medium/low based on how certain you are.",
    "",
    "Return JSON of the form:",
    '{ "results": [ { "index": <number>, "category": "<one of the heads>", "confidence": "high|medium|low" } ] }',
    "Include one result object per transaction, using the index shown.",
    "",
    "Transactions:",
    listed,
  ].join("\n");
}

// --- Groq (OpenAI-compatible) ----------------------------------------------

async function categorizeWithGroq(
  descriptions: string[],
  validCategories: string[],
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
      // category enum ourselves server-side after parsing.
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output only valid JSON. Never wrap it in markdown fences.",
        },
        { role: "user", content: buildPrompt(descriptions, validCategories) },
      ],
    }),
  );

  const text = completion.choices[0]?.message?.content ?? "{}";
  return parseModelJson(text);
}

// --- Google Gemini ----------------------------------------------------------

async function categorizeWithGemini(
  descriptions: string[],
  validCategories: string[],
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
                  enum: validCategories,
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
    model.generateContent(buildPrompt(descriptions, validCategories)),
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

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { descriptions, categories } = (body ?? {}) as {
    descriptions?: unknown;
    categories?: unknown;
  };

  if (
    !Array.isArray(descriptions) ||
    descriptions.some((d) => typeof d !== "string")
  ) {
    return NextResponse.json(
      { error: "`descriptions` must be an array of strings." },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    categories.some((c) => typeof c !== "string")
  ) {
    return NextResponse.json(
      { error: "`categories` must be a non-empty array of strings." },
      { status: 400 },
    );
  }
  if (descriptions.length === 0) {
    return NextResponse.json([] satisfies CategorizeResultItem[]);
  }
  if (descriptions.length > MAX_DESCRIPTIONS) {
    return NextResponse.json(
      { error: `Send at most ${MAX_DESCRIPTIONS} descriptions per request.` },
      { status: 400 },
    );
  }

  // Always allow "Others" so the model has an escape hatch.
  const validCategories = Array.from(
    new Set([...(categories as string[]).map((c) => c.trim()).filter(Boolean), "Others"]),
  );

  try {
    const provider = getProvider();
    const raw =
      provider === "gemini"
        ? await categorizeWithGemini(descriptions as string[], validCategories)
        : await categorizeWithGroq(descriptions as string[], validCategories);
    const results = sanitizeResults(raw, descriptions.length, validCategories);
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
