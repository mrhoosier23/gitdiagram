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

export const PRIVATE_STORAGE_SPEND_BLOCKED =
  "Remote storage is disabled for this private GitDiagram's $0/month budget.";

function hasPositivePrivateBudget(): boolean {
  const budget = process.env.PRIVATE_MONTHLY_BUDGET_USD?.trim();
  return Boolean(
    budget &&
    /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budget) &&
    Number(budget) > 0,
  );
}

export function privateModelSpendBlocked(): boolean {
  if (process.env.PRIVATE_INSTANCE_ENABLED !== "1") return false;
  return (
    !hasPositivePrivateBudget() ||
    process.env.PRIVATE_AI_PAID_CALLS_ENABLED !== "1"
  );
}

export function assertPrivateModelSpendAllowed(): void {
  if (privateModelSpendBlocked()) {
    throw new Error(PRIVATE_MODEL_SPEND_BLOCKED);
  }
}

/**
 * R2 and Redis can charge past provider free allowances. Do not send any
 * requests at $0, even if credentials were mistakenly installed. A future
 * paid pilot needs a separately reviewed storage plan before this switch
 * can be enabled.
 */
export function privateMeteredStorageBlocked(): boolean {
  if (process.env.PRIVATE_INSTANCE_ENABLED !== "1") return false;
  return (
    !hasPositivePrivateBudget() ||
    process.env.PRIVATE_METERED_STORAGE_ENABLED !== "1"
  );
}

export function assertPrivateMeteredStorageAllowed(): void {
  if (privateMeteredStorageBlocked()) {
    throw new Error(PRIVATE_STORAGE_SPEND_BLOCKED);
  }
}
