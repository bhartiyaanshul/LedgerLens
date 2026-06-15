import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner used by every UI component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Collision-resistant id generator that works in both the browser and Node,
 * without depending on crypto.randomUUID being present everywhere.
 */
let counter = 0;
export function makeId(prefix = "id"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

/**
 * Format a number as USD for on-screen display (negatives parenthesized, the
 * accounting convention). Export to Excel keeps raw numbers + a number format,
 * so this is display-only.
 */
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount < 0) return `(${usdFormatter.format(Math.abs(amount))})`;
  return usdFormatter.format(amount);
}

const numberFormatter = new Intl.NumberFormat("en-US");
export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

/** Today's date as YYYY-MM-DD, for export filenames. */
export function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
