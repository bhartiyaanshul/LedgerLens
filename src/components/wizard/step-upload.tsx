"use client";

import { useRef, useState } from "react";
import {
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Table2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn, formatNumber } from "@/lib/utils";
import {
  ParseError,
  isSupportedFile,
  isXlsxFile,
  parseCsvText,
  parseFile,
  readXlsxSheets,
} from "@/lib/parse";
import type { ParsedFile } from "@/lib/types";
import type { WorkbookSheets } from "@/lib/parse";

export function StepUpload({ onParsed }: { onParsed: (p: ParsedFile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a workbook with multiple tabs needs the user to pick one.
  const [workbook, setWorkbook] = useState<WorkbookSheets | null>(null);
  const [chosenSheet, setChosenSheet] = useState<string>("");

  async function handleFile(file: File) {
    setError(null);
    setWorkbook(null);
    setChosenSheet("");
    if (!isSupportedFile(file.name)) {
      setError(
        `"${file.name}" isn't a supported file. Please upload a .csv or .xlsx file.`,
      );
      return;
    }
    setLoading(true);
    try {
      if (isXlsxFile(file.name)) {
        const wb = await readXlsxSheets(file);
        // More than one tab → let the CPA confirm which one is the trial
        // balance instead of silently importing the first sheet.
        if (wb.sheets.length > 1) {
          const best = wb.sheets.reduce((a, b) => (b.rows > a.rows ? b : a));
          setWorkbook(wb);
          setChosenSheet(best.name);
          return;
        }
        onParsed(wb.parseSheet(wb.sheets[0].name));
        return;
      }
      onParsed(await parseFile(file));
    } catch (e) {
      setError(
        e instanceof ParseError
          ? e.message
          : "Sorry, we couldn't read that file. Please check the format and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  function importChosenSheet() {
    if (!workbook || !chosenSheet) return;
    setError(null);
    try {
      onParsed(workbook.parseSheet(chosenSheet));
    } catch (e) {
      setError(
        e instanceof ParseError
          ? e.message
          : `Couldn't read the "${chosenSheet}" tab. Try a different one.`,
      );
    }
  }

  function resetWorkbook() {
    setWorkbook(null);
    setChosenSheet("");
    setError(null);
  }

  async function handleSample() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/sample-trial-balance.csv");
      if (!res.ok) throw new ParseError("Sample file could not be loaded.");
      const text = await res.text();
      onParsed(parseCsvText(text, "sample-trial-balance.csv"));
    } catch {
      setError("Couldn't load the sample data. Please try uploading a file.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">
          Upload the trial balance
        </h2>
        <p className="text-muted-foreground">
          Drop the client&apos;s trial balance (CSV or Excel) below. It&apos;s
          parsed entirely in your browser — nothing is uploaded to a server at
          this step.
        </p>
      </div>

      {!workbook && (
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload file"
        onClick={() => !loading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !loading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging
            ? "border-primary bg-accent/60"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-accent/40",
          loading && "pointer-events-none opacity-70",
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {loading ? (
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          ) : (
            <UploadCloud className="h-7 w-7 text-primary" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-base font-medium">
            {loading ? "Reading your file…" : "Drag & drop your statement here"}
          </p>
          <p className="text-sm text-muted-foreground">
            or <span className="font-medium text-primary">browse</span> to choose
            a file · CSV, XLSX, or XLS
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      )}

      {workbook && (
        <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Table2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold">{workbook.fileName}</p>
              <p className="text-sm text-muted-foreground">
                This workbook has {workbook.sheets.length} tabs — choose the one
                to import.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {workbook.sheets.map((s) => {
              const active = s.name === chosenSheet;
              const empty = s.rows < 2;
              return (
                <button
                  key={s.name}
                  type="button"
                  disabled={empty}
                  onClick={() => setChosenSheet(s.name)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-accent/60 ring-1 ring-primary"
                      : "border-border hover:bg-accent/40",
                    empty && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {s.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {empty
                        ? "No data"
                        : `~${formatNumber(s.rows)} row${s.rows === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      active ? "border-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={resetWorkbook} className="gap-2">
              Choose a different file
            </Button>
            <Button onClick={importChosenSheet} disabled={!chosenSheet} className="gap-2">
              Import “{chosenSheet}” tab
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <FileSpreadsheet className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t read that file</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!workbook && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <span className="text-sm text-muted-foreground">
            Just want to see how it works?
          </span>
          <Button
            variant="outline"
            onClick={handleSample}
            disabled={loading}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Try sample data
          </Button>
        </div>
      )}
    </div>
  );
}
