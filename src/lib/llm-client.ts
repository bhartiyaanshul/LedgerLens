import type { CategorizeResultItem, Confidence } from "./types";

// ---------------------------------------------------------------------------
// Client-side wrapper around POST /api/categorize.
//
// Batches the leftover descriptions (~35 per request), calls the route once per
// batch SEQUENTIALLY (to stay under free-tier RPM limits), reports progress,
// and tolerates a failed batch — those rows are simply left for manual review.
//
// ONLY description strings are sent. Amounts, dates, and account numbers stay
// in the browser.
// ---------------------------------------------------------------------------

export const LLM_BATCH_SIZE = 35;
const INTER_BATCH_DELAY_MS = 250;

export type LLMInput = { id: string; description: string };

export type LLMOutcome = {
  /** id -> assigned category & confidence for rows the model placed. */
  assignments: Map<string, { category: string; confidence: Confidence }>;
  processed: number;
  /** Number of batches that failed entirely (left for manual review). */
  failedBatches: number;
  /** First user-facing error message encountered, if any. */
  errorMessage: string | null;
};

export type LLMProgress = { done: number; total: number };

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function categorizeWithAI(
  rows: LLMInput[],
  categories: string[],
  opts: {
    onProgress?: (p: LLMProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<LLMOutcome> {
  const assignments = new Map<string, { category: string; confidence: Confidence }>();
  const batches = chunk(rows, LLM_BATCH_SIZE);
  let processed = 0;
  let failedBatches = 0;
  let errorMessage: string | null = null;

  for (let b = 0; b < batches.length; b++) {
    if (opts.signal?.aborted) break;
    const batch = batches[b];

    try {
      const res = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: opts.signal,
        body: JSON.stringify({
          descriptions: batch.map((r) => r.description),
          categories,
        }),
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }

      const items = (await res.json()) as CategorizeResultItem[];
      for (const item of items) {
        const target = batch[item.index];
        if (target) {
          assignments.set(target.id, {
            category: item.category,
            confidence: item.confidence,
          });
        }
      }
    } catch (err) {
      if (opts.signal?.aborted) break;
      failedBatches += 1;
      if (!errorMessage) {
        errorMessage = err instanceof Error ? err.message : "AI request failed";
      }
      // Swallow and continue: never crash the flow over a failed batch.
    }

    processed += batch.length;
    opts.onProgress?.({ done: processed, total: rows.length });
    if (b < batches.length - 1) await delay(INTER_BATCH_DELAY_MS);
  }

  return { assignments, processed, failedBatches, errorMessage };
}
