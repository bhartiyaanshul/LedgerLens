import { Badge } from "@/components/ui/badge";
import type { Confidence, Method } from "@/lib/types";

const CONFIDENCE_VARIANT: Record<Confidence, "success" | "warning" | "destructive"> = {
  high: "success",
  medium: "warning",
  low: "destructive",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge variant={CONFIDENCE_VARIANT[confidence]} className="capitalize">
      {confidence}
    </Badge>
  );
}

const METHOD_LABEL: Record<Method, string> = {
  rule: "Rule",
  llm: "AI",
  manual: "Manual",
};

export function MethodBadge({ method }: { method: Method }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {METHOD_LABEL[method]}
    </Badge>
  );
}
