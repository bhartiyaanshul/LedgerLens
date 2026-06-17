"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasSectionConflict, SECTION_LABELS, SECTION_ORDER } from "@/lib/engine";
import { downloadWorkbook, exportFileName } from "@/lib/export";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { entityMeta, REVIEW, UNASSIGNED } from "@/lib/constants";
import type { EntityType, Section, TbAccount } from "@/lib/types";

/** Credit-natural sections display positive when the balance is a credit. */
const CREDIT_NATURAL: Record<Section, boolean> = {
  income: true,
  liability: true,
  equity: true,
  expense: false,
  asset: false,
};

export function StepExport({
  accounts,
  entity,
  onBack,
  onStartOver,
}: {
  accounts: TbAccount[];
  entity: EntityType;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = entityMeta(entity);

  const stats = useMemo(() => {
    const bySection = new Map<Section, { count: number; total: number }>();
    let net = 0;
    for (const a of accounts) {
      net += a.amount;
      if (!a.section) continue;
      const s = bySection.get(a.section) ?? { count: 0, total: 0 };
      s.count += 1;
      s.total += a.amount; // signed (debit positive)
      bySection.set(a.section, s);
    }
    const natural = (section: Section) => {
      const t = bySection.get(section)?.total ?? 0;
      return CREDIT_NATURAL[section] ? -t : t;
    };
    const income = natural("income");
    const expense = natural("expense");
    const rows = SECTION_ORDER.filter((s) => bySection.has(s)).map((s) => ({
      section: s,
      count: bySection.get(s)!.count,
      total: natural(s),
    }));
    return {
      rows,
      net, // sum of (debit - credit); ~0 means the TB is in balance
      netIncome: income - expense,
      totalAssets: natural("asset"),
      totalLiabEquity: natural("liability") + natural("equity"),
    };
  }, [accounts]);

  const missingLine = useMemo(
    () =>
      accounts.filter(
        (a) => !a.taxLine || a.taxLine === UNASSIGNED || a.taxLine === REVIEW,
      ).length,
    [accounts],
  );
  // Unresolved section conflicts: the code's section disagrees with the
  // account-number series, and a human hasn't deliberately set it (manual).
  const conflicts = useMemo(
    () => accounts.filter((a) => a.method !== "manual" && hasSectionConflict(a)).length,
    [accounts],
  );
  const inBalance = Math.round(stats.net * 100) === 0;
  const previewRows = accounts.slice().sort((a, b) => a.sourceRow - b.sourceRow).slice(0, 6);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      await downloadWorkbook(accounts, entity);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong building the file.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Export</h2>
        <p className="text-muted-foreground">
          Download a two-sheet workbook for{" "}
          <span className="font-medium text-foreground">{meta.form}</span> — a
          detail sheet and a pivot grouped by tax line.
        </p>
      </div>

      {missingLine > 0 && (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>
            {formatNumber(missingLine)} account{missingLine === 1 ? "" : "s"}{" "}
            {missingLine === 1 ? "has" : "have"} no tax line
          </AlertTitle>
          <AlertDescription>
            They&apos;ll export under &ldquo;Unassigned.&rdquo; Go back to Review
            to resolve them, or export as-is.
          </AlertDescription>
        </Alert>
      )}

      {conflicts > 0 && (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>
            {formatNumber(conflicts)} account{conflicts === 1 ? "" : "s"} have a
            section conflict
          </AlertTitle>
          <AlertDescription>
            The assigned tax code&apos;s section doesn&apos;t match the account
            number series (e.g. an asset-numbered account mapped to an expense
            line). Go back to Review to confirm or correct them before exporting.
          </AlertDescription>
        </Alert>
      )}

      {missingLine === 0 && conflicts === 0 && (
        <Alert variant="info">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Every account has a tax line.{" "}
            {inBalance
              ? "The trial balance is in balance."
              : `Note: the trial balance is off by ${formatCurrency(stats.net)}.`}
          </AlertDescription>
        </Alert>
      )}

      {/* Return summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary label="Net rental income" value={formatCurrency(stats.netIncome)} strong />
        {meta.hasBalanceSheet && (
          <>
            <Summary label="Total assets" value={formatCurrency(stats.totalAssets)} />
            <Summary label="Liabilities & capital" value={formatCurrency(stats.totalLiabEquity)} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {/* Section breakdown */}
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Statement section</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.rows.map((r) => (
                  <TableRow key={r.section}>
                    <TableCell className="font-medium">{SECTION_LABELS[r.section]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Detail-sheet preview */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Preview — Sheet 1 “Trial Balance”
            </p>
            <div className="scroll-thin overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Account Number</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Tax line</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.accountNumber || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{a.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{a.taxLine}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Download card */}
        <div className="lg:col-span-2">
          <div className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-success/15">
                <FileSpreadsheet className="h-6 w-6 text-success" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold">{exportFileName(entity)}</p>
                <p className="text-sm text-muted-foreground">
                  {formatNumber(accounts.length)} accounts · two sheets
                </p>
              </div>
            </div>

            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Detail:
                Account # · Name · Amount · Tax line
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Pivot grouped
                by tax line, with subtotals
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Totals net to
                zero when in balance
              </li>
            </ul>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Export failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {done && !error && (
              <Alert variant="info">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>Downloaded. Check your downloads folder.</AlertDescription>
              </Alert>
            )}

            <Button onClick={handleDownload} disabled={downloading} size="lg" className="mt-auto w-full gap-2">
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Building file…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  {done ? "Download again" : "Download workbook"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button variant="outline" onClick={onStartOver} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Start over
        </Button>
      </div>
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={"mt-1 tabular-nums " + (strong ? "text-2xl font-semibold" : "text-xl font-semibold")}>
        {value}
      </div>
    </div>
  );
}
