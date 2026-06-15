"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AmountMode, ColumnMapping, ParsedFile } from "@/lib/types";

const NONE = "__none__";

function ColumnSelect({
  value,
  headers,
  onChange,
  allowNone,
}: {
  value: string | null;
  headers: string[];
  onChange: (v: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a column" />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">— None —</span>
          </SelectItem>
        )}
        {headers.map((h) => (
          <SelectItem key={h} value={h}>
            {h}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StepMapColumns({
  parsed,
  mapping,
  amountMode,
  onChange,
  onAmountModeChange,
  onBack,
  onContinue,
}: {
  parsed: ParsedFile;
  mapping: ColumnMapping;
  amountMode: AmountMode;
  onChange: (m: ColumnMapping) => void;
  onAmountModeChange: (m: AmountMode) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const setField = (field: keyof ColumnMapping, v: string | null) =>
    onChange({ ...mapping, [field]: v });

  const amountOk =
    amountMode === "single" ? !!mapping.balance : !!mapping.debit || !!mapping.credit;
  const canContinue = !!mapping.description && amountOk;
  const previewRows = parsed.rows.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Map columns</h2>
        <p className="text-muted-foreground">
          We auto-detected the columns in{" "}
          <span className="font-medium text-foreground">{parsed.fileName}</span>.
          Confirm them — the Account Description and a balance are required.
        </p>
      </div>

      <div className="space-y-2">
        <Label>How are balances stored?</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                mode: "split" as AmountMode,
                title: "Separate Debit & Credit",
                desc: "Two columns — typical trial-balance layout.",
              },
              {
                mode: "single" as AmountMode,
                title: "One net Balance column",
                desc: "A single signed balance (debit positive, credit negative).",
              },
            ]
          ).map((opt) => (
            <button
              key={opt.mode}
              type="button"
              onClick={() => onAmountModeChange(opt.mode)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                amountMode === opt.mode
                  ? "border-primary bg-accent/60 ring-1 ring-primary"
                  : "border-border hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                  amountMode === opt.mode ? "border-primary" : "border-muted-foreground/40",
                )}
              >
                {amountMode === opt.mode && (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
              </span>
              <span>
                <span className="block text-sm font-medium">{opt.title}</span>
                <span className="block text-xs text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>
            Account Number <span className="text-muted-foreground">(optional)</span>
          </Label>
          <ColumnSelect
            value={mapping.accountNumber}
            headers={parsed.headers}
            onChange={(v) => setField("accountNumber", v)}
            allowNone
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            Account Description <span className="text-destructive">*</span>
          </Label>
          <ColumnSelect
            value={mapping.description}
            headers={parsed.headers}
            onChange={(v) => setField("description", v)}
          />
        </div>

        {amountMode === "single" ? (
          <div className="space-y-1.5">
            <Label>
              Balance <span className="text-destructive">*</span>
            </Label>
            <ColumnSelect
              value={mapping.balance}
              headers={parsed.headers}
              onChange={(v) => setField("balance", v)}
            />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>
                Debit <span className="text-muted-foreground">(or one of both)</span>
              </Label>
              <ColumnSelect
                value={mapping.debit}
                headers={parsed.headers}
                onChange={(v) => setField("debit", v)}
                allowNone
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Credit <span className="text-muted-foreground">(or one of both)</span>
              </Label>
              <ColumnSelect
                value={mapping.credit}
                headers={parsed.headers}
                onChange={(v) => setField("credit", v)}
                allowNone
              />
            </div>
          </>
        )}
      </div>

      {!canContinue && (
        <div className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Select an <strong>Account Description</strong> column and{" "}
            {amountMode === "single"
              ? "a Balance column"
              : "at least one of Debit or Credit"}{" "}
            to continue.
          </span>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Preview — first {previewRows.length} of {parsed.rows.length} rows
        </div>
        <div className="scroll-thin overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {parsed.headers.map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row, i) => (
                <TableRow key={i}>
                  {parsed.headers.map((h) => (
                    <TableCell key={h} className="whitespace-nowrap">
                      {row[h] || <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onContinue} disabled={!canContinue} className="gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
