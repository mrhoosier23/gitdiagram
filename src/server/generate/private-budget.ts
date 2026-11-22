/**
 * A strict spending gate for private GitDiagram.
 *
 * A configured $0 budget blocks every billable model request, including
 * requests using a visitor-provided API key. A missing or invalid budget
 * also fails closed. A future positive budget alone cannot enable paid calls:
 * that requires a separate explicit operator switch after provider-side
 * spending limits and authorization have been verified.
 */
export const PRIVATE_MODEL_SPEND_BLOCKED =
  "AI generation is disabled for this private GitDiagram's $0/month budget.";

export const PRIVATE_MODEL_SPEND_ERROR_CODE = "PRIVATE_MODEL_SPEND_BLOCKED";

export function privateModelSpendBlocked(): boolean {
  if (process.env.PRIVATE_INSTANCE_ENABLED !== "1") return false;
  const budget = process.env.PRIVATE_MONTHLY_BUDGET_USD?.trim();
  if (!budget || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budget)) {
    return true;
  }
  return (
    Number(budget) <= 0 ||
    process.env.PRIVATE_AI_PAID_CALLS_ENABLED !== "1"
  );
}

export function assertPrivateModelSpendAllowed(): void {
  if (privateModelSpendBlocked()) {
    throw new Error(PRIVATE_MODEL_SPEND_BLOCKED);
  }
}
