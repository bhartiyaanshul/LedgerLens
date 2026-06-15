export type StepId = 1 | 2 | 3 | 4 | 5 | 6;

export const STEPS: { id: StepId; title: string; description: string }[] = [
  { id: 1, title: "Upload", description: "Add the trial balance" },
  { id: 2, title: "Map columns", description: "Account, description, balance" },
  { id: 3, title: "Tax setup", description: "Entity & tax-code lines" },
  { id: 4, title: "Categorize", description: "Run rules + optional AI" },
  { id: 5, title: "Review", description: "Check & correct codes" },
  { id: 6, title: "Export", description: "UltraTax import sheet" },
];
