"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfidenceBadge, MethodBadge } from "./confidence-badge";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { isFlagged, lineByName } from "@/lib/engine";
import { EXCLUDE, EXCLUDE_CODE, REVIEW, UNASSIGNED } from "@/lib/constants";
import type { Confidence, TaxLine, TbAccount } from "@/lib/types";

type SortKey =
  | "sourceRow"
  | "accountNumber"
  | "description"
  | "amount"
  | "taxLine"
  | "taxCode"
  | "confidence";
type SortDir = "asc" | "desc";

const GRID_COLS =
  "34px 100px minmax(190px,1.3fr) 120px 200px 70px 104px 80px minmax(140px,1fr)";
const MIN_WIDTH = 1180;
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const ALL = "__all__";

export function StepReview({
  accounts,
  lines,
  onChange,
  onBack,
  onContinue,
}: {
  accounts: TbAccount[];
  lines: TaxLine[];
  onChange: (a: TbAccount[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState<string>(ALL);
  const [confFilter, setConfFilter] = useState<string>(ALL);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "sourceRow",
    dir: "asc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLine, setBulkLine] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dropdown options: every configured tax line + the three special buckets.
  const options = useMemo(() => {
    const fromLines = lines.map((l) => l.name);
    const present = accounts.map((a) => a.taxLine);
    const specials = [UNASSIGNED, REVIEW, EXCLUDE];
    return Array.from(new Set([...fromLines, ...specials, ...present])).filter(Boolean);
  }, [lines, accounts]);

  const summary = useMemo(() => {
    const total = accounts.length;
    const review = accounts.filter(isFlagged).length;
    const net = accounts.reduce((s, a) => s + a.amount, 0);
    return { total, review, assigned: total - review, net };
  }, [accounts]);

  const inBalance = Math.abs(summary.net) < 0.005;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = accounts.filter((a) => {
      if (
        q &&
        !a.description.toLowerCase().includes(q) &&
        !a.accountNumber.toLowerCase().includes(q)
      )
        return false;
      if (lineFilter !== ALL && a.taxLine !== lineFilter) return false;
      if (confFilter !== ALL && a.confidence !== confFilter) return false;
      if (reviewOnly && !isFlagged(a)) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "confidence":
          cmp = CONF_RANK[a.confidence] - CONF_RANK[b.confidence];
          break;
        case "sourceRow":
          cmp = a.sourceRow - b.sourceRow;
          break;
        default:
          cmp = String(a[sort.key]).localeCompare(String(b[sort.key]));
      }
      if (cmp === 0) cmp = a.sourceRow - b.sourceRow;
      return cmp * dir;
    });
  }, [accounts, search, lineFilter, confFilter, reviewOnly, sort]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });

  function assignmentFor(name: string): Partial<TbAccount> {
    if (name === EXCLUDE) {
      return { taxLine: EXCLUDE, taxCode: EXCLUDE_CODE, section: "", method: "manual", confidence: "high", note: "excluded from import" };
    }
    if (name === UNASSIGNED || name === REVIEW) {
      return { taxLine: name, taxCode: "", section: "", method: "manual", confidence: "low", note: "manually set" };
    }
    const line = lineByName(lines, name);
    return {
      taxLine: name,
      taxCode: line?.code ?? "",
      section: line?.section ?? "",
      method: "manual",
      confidence: "high",
      note: "manually set",
    };
  }

  function patchRows(ids: Set<string>, patch: Partial<TbAccount>) {
    onChange(accounts.map((a) => (ids.has(a.id) ? { ...a, ...patch } : a)));
  }

  function setRowLine(id: string, name: string) {
    patchRows(new Set([id]), assignmentFor(name));
  }

  function applyBulk() {
    if (!bulkLine || selected.size === 0) return;
    patchRows(selected, assignmentFor(bulkLine));
    setSelected(new Set());
    setBulkLine("");
  }

  const filteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  const items = rowVirtualizer.getVirtualItems();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Review & correct</h2>
        <p className="text-muted-foreground">
          Change any tax code inline, bulk-assign selected rows, and filter to
          what needs attention. Every change is tracked for the audit trail.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card p-4 text-sm">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="font-semibold tabular-nums">{formatNumber(summary.assigned)}</span>
          <span className="text-muted-foreground">assigned</span>
        </span>
        <span className="flex items-center gap-2">
          <TriangleAlert className={cn("h-4 w-4", summary.review ? "text-warning" : "text-muted-foreground")} />
          <span className="font-semibold tabular-nums">{formatNumber(summary.review)}</span>
          <span className="text-muted-foreground">need review</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Trial balance</span>
          {inBalance ? (
            <span className="font-semibold text-success">In balance ✓</span>
          ) : (
            <span className="font-semibold text-destructive">
              Off by {formatCurrency(summary.net)}
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={lineFilter} onValueChange={setLineFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All tax lines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tax lines</SelectItem>
              {options.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={confFilter} onValueChange={setConfFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All confidence" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All confidence</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="review-only" checked={reviewOnly} onCheckedChange={setReviewOnly} />
            <Label htmlFor="review-only" className="cursor-pointer whitespace-nowrap">
              Needs review only
            </Label>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-accent/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium">
            {formatNumber(selected.size)} row{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={bulkLine} onValueChange={setBulkLine}>
              <SelectTrigger className="w-[210px]">
                <SelectValue placeholder="Set tax line to…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={applyBulk} disabled={!bulkLine} size="sm">
              Apply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="gap-1">
              <X className="h-4 w-4" /> Clear
            </Button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="scroll-thin h-[56vh] min-h-[340px] overflow-auto rounded-lg border">
        <div style={{ minWidth: MIN_WIDTH }}>
          <div
            className="sticky top-0 z-10 grid items-center border-b bg-muted/95 px-3 py-2 text-xs font-medium text-muted-foreground backdrop-blur"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all"
            />
            <SortHeader label="Acct #" col="accountNumber" sort={sort} onSort={toggleSort} />
            <SortHeader label="Account description" col="description" sort={sort} onSort={toggleSort} />
            <SortHeader label="Amount" col="amount" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="Tax line" col="taxLine" sort={sort} onSort={toggleSort} />
            <SortHeader label="Code" col="taxCode" sort={sort} onSort={toggleSort} />
            <SortHeader label="Confidence" col="confidence" sort={sort} onSort={toggleSort} />
            <span>Method</span>
            <span>Note</span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Search className="h-6 w-6" />
              <p className="text-sm">No accounts match these filters.</p>
            </div>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {items.map((vi) => {
                const a = filtered[vi.index];
                const flagged = isFlagged(a);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "absolute left-0 top-0 grid w-full items-center gap-1 border-b px-3 text-sm",
                      a.taxLine === UNASSIGNED
                        ? "bg-destructive/[0.04]"
                        : a.taxLine === REVIEW
                          ? "bg-warning/[0.06]"
                          : "hover:bg-muted/40",
                      selected.has(a.id) && "bg-accent/60",
                    )}
                    style={{
                      gridTemplateColumns: GRID_COLS,
                      height: vi.size,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <Checkbox
                      checked={selected.has(a.id)}
                      onCheckedChange={() => toggleRow(a.id)}
                      aria-label={`Select ${a.description}`}
                    />
                    <span className="truncate font-mono text-xs text-muted-foreground" title={a.accountNumber}>
                      {a.accountNumber || "—"}
                    </span>
                    <span className="truncate font-medium" title={a.description}>
                      {a.description}
                    </span>
                    <span
                      className={cn(
                        "text-right font-medium tabular-nums",
                        a.amount < 0 && "text-muted-foreground",
                      )}
                    >
                      {formatCurrency(a.amount)}
                    </span>
                    <Select value={a.taxLine} onValueChange={(v) => setRowLine(a.id, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="font-mono text-xs">
                      {a.taxCode || <span className="text-muted-foreground/50">—</span>}
                    </span>
                    <span>
                      <ConfidenceBadge confidence={a.confidence} />
                    </span>
                    <span>
                      <MethodBadge method={a.method} />
                    </span>
                    <span className="truncate text-xs text-muted-foreground" title={a.note}>
                      {flagged && <TriangleAlert className="mr-1 inline h-3 w-3 text-warning" />}
                      {a.note || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
        <span>
          Showing {formatNumber(filtered.length)} of {formatNumber(accounts.length)}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onContinue} className="gap-2">
          Continue to export <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  align,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={cn(
        "flex items-center gap-1 font-medium transition-colors hover:text-foreground",
        align === "right" && "justify-end",
        active && "text-foreground",
      )}
    >
      {label}
      {active ? (
        sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}
