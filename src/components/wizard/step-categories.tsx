"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, makeId } from "@/lib/utils";
import { defaultConfig, ENTITIES, entityMeta } from "@/lib/constants";
import { SECTION_LABELS, SECTION_ORDER } from "@/lib/engine";
import { exportConfigJson, importConfigJson } from "@/lib/config";
import type { EntityType, Section, TaxConfig, TaxLine } from "@/lib/types";

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full text-muted-foreground transition-colors hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function KeywordAdder({ onAdd }: { onAdd: (keywords: string[]) => void }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onAdd(parts);
    setText("");
  };
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
      placeholder="Add keyword + Enter"
      className="h-7 w-36 text-xs"
    />
  );
}

export function StepCategories({
  config,
  entity,
  onEntityChange,
  onChange,
  onBack,
  onContinue,
}: {
  config: TaxConfig;
  entity: EntityType;
  onEntityChange: (e: EntityType) => void;
  onChange: (c: TaxConfig) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const lines = config.entities[entity];

  const setLines = (next: TaxLine[]) =>
    onChange({ ...config, entities: { ...config.entities, [entity]: next } });

  const patchLine = (id: string, patch: Partial<TaxLine>) =>
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addKeywords = (id: string, keywords: string[]) => {
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    patchLine(id, {
      keywords: Array.from(new Set([...line.keywords, ...keywords])),
    });
  };

  const removeKeyword = (id: string, kw: string) => {
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    patchLine(id, { keywords: line.keywords.filter((k) => k !== kw) });
  };

  const addLine = (section: Section) =>
    setLines([
      ...lines,
      { id: makeId("line"), name: "", code: "", section, formLine: "", keywords: [] },
    ]);

  const removeLine = (id: string) => setLines(lines.filter((l) => l.id !== id));

  const resetEntity = () =>
    setLines(defaultConfig().entities[entity]);

  const handleExport = () => {
    const blob = new Blob([exportConfigJson(config)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ledgerlens-tax-config.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    setImportError(null);
    try {
      onChange(importConfigJson(await file.text()));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import that file.");
    }
  };

  const meta = entityMeta(entity);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Tax setup</h2>
          <p className="max-w-2xl text-muted-foreground">
            Pick the return type, then map each tax line to its UltraTax code.
            Keywords match account names with <strong>whole-word</strong>
            boundaries. Saved automatically to this browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={resetEntity} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> Reset {meta.id}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Entity selector */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ENTITIES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onEntityChange(e.id)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
              entity === e.id
                ? "border-primary bg-accent/60 ring-1 ring-primary"
                : "border-border hover:bg-accent/40",
            )}
          >
            <span className="text-sm font-semibold">{e.label}</span>
            <span className="text-xs font-medium text-primary">{e.form}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">{e.description}</span>
          </button>
        ))}
      </div>

      {importError && (
        <Alert variant="destructive">
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      )}

      {/* Tax lines grouped by section */}
      <div className="space-y-5">
        {SECTION_ORDER.map((section) => {
          const sectionLines = lines.filter((l) => l.section === section);
          if (sectionLines.length === 0) return null;
          return (
            <div key={section} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {SECTION_LABELS[section]}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addLine(section)}
                  className="h-7 gap-1 text-xs text-muted-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              <div className="space-y-2">
                {sectionLines.map((line) => (
                  <Card key={line.id}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={line.name}
                          onChange={(e) => patchLine(line.id, { name: e.target.value })}
                          placeholder="Tax line name"
                          className="h-8 flex-1 font-medium"
                        />
                        <Input
                          value={line.code}
                          onChange={(e) => patchLine(line.id, { code: e.target.value })}
                          placeholder="Code"
                          className="h-8 w-20 text-center font-mono text-sm"
                          aria-label="UltraTax tax code"
                        />
                        <Select
                          value={line.section}
                          onValueChange={(v) => patchLine(line.id, { section: v as Section })}
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SECTION_ORDER.map((s) => (
                              <SelectItem key={s} value={s}>
                                {SECTION_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(line.id)}
                          aria-label={`Delete ${line.name || "line"}`}
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {line.formLine && (
                          <span className="mr-1 text-xs text-muted-foreground">
                            {line.formLine} ·
                          </span>
                        )}
                        {line.keywords.map((kw) => (
                          <Chip key={kw} label={kw} onRemove={() => removeKeyword(line.id, kw)} />
                        ))}
                        <KeywordAdder onAdd={(kws) => addKeywords(line.id, kws)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onContinue} className="gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
