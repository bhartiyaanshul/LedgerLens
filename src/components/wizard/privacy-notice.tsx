"use client";

import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Shown the first time AI categorization is used. Explains that descriptions
 * (and only descriptions) are sent to the configured LLM provider, and that
 * free tiers may train on submitted prompts.
 */
export function PrivacyNotice({
  open,
  onAcknowledge,
  onDisableAI,
  onOpenChange,
}: {
  open: boolean;
  onAcknowledge: () => void;
  onDisableAI: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-warning/15">
            <ShieldAlert className="h-5 w-5 text-warning" />
          </div>
          <DialogTitle>Before using AI categorization</DialogTitle>
          <DialogDescription className="space-y-3 pt-1 text-left">
            <span className="block">
              The <strong>account names/descriptions</strong> for the accounts
              the rule engine couldn&apos;t place will be sent to your configured
              LLM provider (Groq or Gemini) to suggest a tax code.
            </span>
            <span className="block rounded-md bg-success/10 p-2.5 text-sm text-foreground">
              ✓ Only the account description text is sent — never amounts,
              balances, account numbers, or client identifiers.
            </span>
            <span className="block">
              Account names can themselves contain client info (e.g. a property
              address). Review your chart of accounts before enabling AI.
            </span>
            <span className="block">
              <strong>Free LLM tiers (both Groq and Gemini) may use submitted
              prompts to train their models.</strong> For real client data we
              recommend a paid / no-training tier (or Vertex AI for Gemini), or
              keeping AI off and categorizing manually.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onDisableAI}>
            Keep AI off
          </Button>
          <Button onClick={onAcknowledge}>I understand, continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
