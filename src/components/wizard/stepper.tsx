"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, type StepId } from "./steps";

export function Stepper({
  current,
  maxReached,
  onStepClick,
}: {
  current: StepId;
  maxReached: StepId;
  onStepClick: (id: StepId) => void;
}) {
  return (
    <nav aria-label="Progress" className="w-full">
      {/* Desktop / tablet: full horizontal stepper */}
      <ol className="hidden items-center sm:flex">
        {STEPS.map((step, idx) => {
          const isComplete = step.id < current;
          const isCurrent = step.id === current;
          const isReachable = step.id <= maxReached;
          return (
            <li
              key={step.id}
              className={cn("flex items-center", idx < STEPS.length - 1 && "flex-1")}
            >
              <button
                type="button"
                disabled={!isReachable}
                onClick={() => isReachable && onStepClick(step.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
                  isReachable ? "cursor-pointer hover:bg-accent/60" : "cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                    isCurrent && "border-primary bg-primary text-primary-foreground shadow",
                    isComplete && "border-primary bg-primary text-primary-foreground",
                    !isCurrent &&
                      !isComplete &&
                      "border-border bg-background text-muted-foreground",
                  )}
                >
                  {isComplete ? <Check className="h-4 w-4" /> : step.id}
                </span>
                <span className="hidden flex-col lg:flex">
                  <span
                    className={cn(
                      "text-sm font-medium leading-tight",
                      isCurrent ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {step.description}
                  </span>
                </span>
              </button>
              {idx < STEPS.length - 1 && (
                <span
                  className={cn(
                    "mx-2 h-0.5 flex-1 rounded-full transition-colors",
                    step.id < current ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: compact "Step X of 6" + title */}
      <div className="flex items-center gap-3 sm:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {current}
        </span>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-muted-foreground">
            Step {current} of {STEPS.length}
          </span>
          <span className="text-sm font-semibold">
            {STEPS[current - 1].title}
          </span>
        </div>
        <div className="ml-auto flex gap-1">
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                s.id === current
                  ? "bg-primary"
                  : s.id < current
                    ? "bg-primary/50"
                    : "bg-border",
              )}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
