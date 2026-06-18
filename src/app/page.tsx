"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { Stepper } from "@/components/wizard/stepper";
import type { StepId } from "@/components/wizard/steps";
import { StepUpload } from "@/components/wizard/step-upload";
import { StepMapColumns } from "@/components/wizard/step-map-columns";
import { StepCategories } from "@/components/wizard/step-categories";
import { StepCategorize } from "@/components/wizard/step-categorize";
import { StepReview } from "@/components/wizard/step-review";
import { StepExport } from "@/components/wizard/step-export";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { autoDetectMapping, detectAmountMode, normalize, ParseError } from "@/lib/parse";
import { loadConfig, saveConfig } from "@/lib/config";
import { defaultConfig } from "@/lib/constants";
import type {
  AmountMode,
  ColumnMapping,
  EntityType,
  ParsedFile,
  TaxConfig,
  TbAccount,
} from "@/lib/types";

const AI_ACK_KEY = "ledgerlens.aiAck";
const ENTITY_KEY = "ledgerlens.entity";
const ENTITY_VALUES: EntityType[] = ["1065", "1120S", "1120", "1040E"];

const EMPTY_MAPPING: ColumnMapping = {
  accountNumber: null,
  description: null,
  balance: null,
  debit: null,
  credit: null,
};

export default function Home() {
  const [step, setStep] = useState<StepId>(1);
  const [maxReached, setMaxReached] = useState<StepId>(1);
  const [flowError, setFlowError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [amountMode, setAmountMode] = useState<AmountMode>("split");

  const [config, setConfig] = useState<TaxConfig>(defaultConfig());
  const [entity, setEntity] = useState<EntityType>("1065");
  const [baseAccounts, setBaseAccounts] = useState<TbAccount[]>([]);
  const [accounts, setAccounts] = useState<TbAccount[]>([]);

  const [useAI, setUseAI] = useState(true);
  const [aiAck, setAiAck] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    try {
      setAiAck(localStorage.getItem(AI_ACK_KEY) === "1");
      const e = localStorage.getItem(ENTITY_KEY);
      if (e && (ENTITY_VALUES as string[]).includes(e)) setEntity(e as EntityType);
    } catch {
      /* ignore */
    }
  }, []);

  function goTo(target: StepId) {
    setFlowError(null);
    setStep(target);
    setMaxReached((prev) => (target > prev ? target : prev));
  }

  function handleParsed(p: ParsedFile) {
    setParsed(p);
    const m = autoDetectMapping(p.headers);
    setMapping(m);
    setAmountMode(detectAmountMode(m));
    goTo(2);
  }

  function handleMappingContinue() {
    if (!parsed) return;
    try {
      setBaseAccounts(normalize(parsed, { mapping, amountMode }));
      goTo(3);
    } catch (e) {
      setFlowError(
        e instanceof ParseError
          ? e.message
          : "We couldn't read accounts with that column mapping.",
      );
    }
  }

  function handleConfigChange(c: TaxConfig) {
    setConfig(c);
    saveConfig(c);
  }

  function handleEntityChange(e: EntityType) {
    setEntity(e);
    try {
      localStorage.setItem(ENTITY_KEY, e);
    } catch {
      /* ignore */
    }
  }

  function acknowledgeAI() {
    setAiAck(true);
    try {
      localStorage.setItem(AI_ACK_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function startOver() {
    setParsed(null);
    setMapping(EMPTY_MAPPING);
    setAmountMode("split");
    setBaseAccounts([]);
    setAccounts([]);
    setStep(1);
    setMaxReached(1);
    setFlowError(null);
  }

  const lines = config.entities[entity];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ScanLine className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="font-semibold tracking-tight">LedgerLens</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Trial balance → tax lines
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success md:inline-block">
              Runs in your browser
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <Stepper current={step} maxReached={maxReached} onStepClick={goTo} />
        </div>

        {flowError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>{flowError}</AlertDescription>
          </Alert>
        )}

        <div className="animate-fade-in rounded-xl border bg-card p-5 shadow-sm sm:p-7">
          {step === 1 && <StepUpload onParsed={handleParsed} />}

          {step === 2 && parsed && (
            <StepMapColumns
              parsed={parsed}
              mapping={mapping}
              amountMode={amountMode}
              onChange={setMapping}
              onAmountModeChange={setAmountMode}
              onBack={() => goTo(1)}
              onContinue={handleMappingContinue}
            />
          )}

          {step === 3 && (
            <StepCategories
              config={config}
              entity={entity}
              onEntityChange={handleEntityChange}
              onChange={handleConfigChange}
              onBack={() => goTo(2)}
              onContinue={() => goTo(4)}
            />
          )}

          {step === 4 && (
            <StepCategorize
              baseAccounts={baseAccounts}
              lines={lines}
              weakTokens={config.weakTokens}
              useAI={useAI}
              onToggleAI={setUseAI}
              aiAcknowledged={aiAck}
              onAcknowledgeAI={acknowledgeAI}
              onComplete={(a) => {
                setAccounts(a);
                goTo(5);
              }}
              onBack={() => goTo(3)}
            />
          )}

          {step === 5 && (
            <StepReview
              accounts={accounts}
              lines={lines}
              onChange={setAccounts}
              onBack={() => goTo(4)}
              onContinue={() => goTo(6)}
            />
          )}

          {step === 6 && (
            <StepExport
              accounts={accounts}
              entity={entity}
              onBack={() => goTo(5)}
              onStartOver={startOver}
            />
          )}
        </div>

        <footer className="mx-auto mt-8 max-w-3xl text-center text-xs text-muted-foreground">
          <p>
            The trial balance is parsed and categorized in your browser. Only the
            account name and number of low-confidence rows are sent to the AI
            provider, and only when you enable AI categorization.
          </p>
        </footer>
      </main>
    </div>
  );
}
