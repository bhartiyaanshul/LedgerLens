"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrivacyNotice } from "./privacy-notice";
import {
  flagSectionConflict,
  isFlagged,
  lineByName,
  needsLLM,
  runRuleEngine,
} from "@/lib/engine";
import { categorizeWithAI } from "@/lib/llm-client";
import { formatNumber } from "@/lib/utils";
import type { TaxLine, TbAccount } from "@/lib/types";

type AiPhase = "idle" | "running" | "done";

export function StepCategorize({
  baseAccounts,
  lines,
  weakTokens,
  useAI,
  onToggleAI,
  aiAcknowledged,
  onAcknowledgeAI,
  onComplete,
  onBack,
}: {
  baseAccounts: TbAccount[];
  lines: TaxLine[];
  weakTokens: string[];
  useAI: boolean;
  onToggleAI: (v: boolean) => void;
  aiAcknowledged: boolean;
  onAcknowledgeAI: () => void;
  onComplete: (accounts: TbAccount[]) => void;
  onBack: () => void;
}) {
  const [results, setResults] = useState<TbAccount[]>([]);
  const [aiPhase, setAiPhase] = useState<AiPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [aiInfo, setAiInfo] = useState<{
    placed: number;
    failedBatches: number;
    error: string | null;
  } | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setResults(runRuleEngine(baseAccounts, lines, weakTokens));
    setAiPhase("idle");
    setAiInfo(null);
    setProgress({ done: 0, total: 0 });
  }, [baseAccounts, lines, weakTokens]);

  const lineNames = useMemo(
    () => lines.map((l) => l.name.trim()).filter(Boolean),
    [lines],
  );

  const stats = useMemo(() => {
    const total = results.length;
    const review = results.filter(isFlagged).length;
    const assigned = total - review;
    return {
      total,
      review,
      assigned,
      coverage: total ? Math.round((assigned / total) * 100) : 0,
    };
  }, [results]);

  const leftovers = useMemo(() => results.filter(needsLLM), [results]);

  async function startAI() {
    if (leftovers.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiPhase("running");
    setProgress({ done: 0, total: leftovers.length });
    setAiInfo(null);

    const outcome = await categorizeWithAI(
      leftovers.map((a) => ({ id: a.id, description: a.description })),
      lineNames,
      { onProgress: setProgress, signal: controller.signal },
    );

    setResults((prev) =>
      prev.map((a) => {
        const assignment = outcome.assignments.get(a.id);
        if (!assignment) return a;
        const line = lineByName(lines, assignment.category);
        if (!line) return a; // model said "Others"/unknown -> leave for manual
        // Guardrail: the model only sees the account name, so cross-check its
        // pick against the account-number series before trusting it.
        return flagSectionConflict({
          ...a,
          taxLine: line.name,
          taxCode: line.code,
          section: line.section,
          confidence: assignment.confidence,
          method: "llm" as const,
          note: "categorised by model",
        });
      }),
    );
    setAiInfo({
      placed: outcome.assignments.size,
      failedBatches: outcome.failedBatches,
      error: outcome.errorMessage,
    });
    setAiPhase("done");
    abortRef.current = null;
  }

  function handleRunAIClick() {
    if (!aiAcknowledged) {
      setShowPrivacy(true);
      return;
    }
    void startAI();
  }

  function cancelAI() {
    abortRef.current?.abort();
    setAiPhase("done");
  }

  const aiRunning = aiPhase === "running";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Categorize</h2>
        <p className="text-muted-foreground">
          The rule engine has assigned tax codes to{" "}
          {formatNumber(stats.total)} accounts. Optionally let AI handle the ones
          it couldn&apos;t confidently place.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Accounts" value={formatNumber(stats.total)} icon={<Cpu className="h-4 w-4" />} />
        <StatTile
          label="Assigned"
          value={formatNumber(stats.assigned)}
          accent="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatTile
          label="Need review"
          value={formatNumber(stats.review)}
          accent={stats.review ? "warning" : undefined}
          icon={<TriangleAlert className="h-4 w-4" />}
        />
        <StatTile label="Coverage" value={`${stats.coverage}%`} />
      </div>

      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="use-ai" className="text-base">
                Use AI for unmatched accounts
              </Label>
              <p className="max-w-md text-sm text-muted-foreground">
                Sends only the account descriptions of low-confidence rows to your
                configured provider. Turn off for sensitive clients.
              </p>
            </div>
          </div>
          <Switch id="use-ai" checked={useAI} onCheckedChange={onToggleAI} disabled={aiRunning} />
        </div>

        {useAI && (
          <div className="mt-4 border-t pt-4">
            {leftovers.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Every account was confidently mapped by the rules — no AI needed.
              </p>
            ) : aiPhase === "idle" ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {formatNumber(leftovers.length)}
                  </span>{" "}
                  account{leftovers.length === 1 ? "" : "s"} need a closer look.
                </p>
                <Button onClick={handleRunAIClick} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Categorize {formatNumber(leftovers.length)} with AI
                </Button>
              </div>
            ) : aiRunning ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Asking the model… {formatNumber(progress.done)} /{" "}
                    {formatNumber(progress.total)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={cancelAI}>
                    Cancel
                  </Button>
                </div>
                <Progress value={pct} />
              </div>
            ) : (
              <div className="space-y-3">
                {aiInfo && (
                  <p className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    AI placed {formatNumber(aiInfo.placed)} of{" "}
                    {formatNumber(progress.total)} account
                    {progress.total === 1 ? "" : "s"}.
                  </p>
                )}
                {aiInfo && aiInfo.failedBatches > 0 && (
                  <Alert variant="warning">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>Some accounts were left for manual review</AlertTitle>
                    <AlertDescription>
                      {aiInfo.failedBatches} batch
                      {aiInfo.failedBatches === 1 ? "" : "es"} couldn&apos;t be
                      processed{aiInfo.error ? ` (${aiInfo.error})` : ""}. Assign
                      those by hand in the next step.
                    </AlertDescription>
                  </Alert>
                )}
                {leftovers.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleRunAIClick}>
                    Re-run AI on remaining {formatNumber(leftovers.length)}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2" disabled={aiRunning}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button
          onClick={() => onComplete(results)}
          disabled={aiRunning || results.length === 0}
          className="gap-2"
        >
          Review results <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <PrivacyNotice
        open={showPrivacy}
        onOpenChange={setShowPrivacy}
        onAcknowledge={() => {
          onAcknowledgeAI();
          setShowPrivacy(false);
          void startAI();
        }}
        onDisableAI={() => {
          onToggleAI(false);
          setShowPrivacy(false);
        }}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: "success" | "warning";
}) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={
          "mt-1 text-xl font-semibold tabular-nums " +
          (accent === "success"
            ? "text-success"
            : accent === "warning"
              ? "text-warning"
              : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
