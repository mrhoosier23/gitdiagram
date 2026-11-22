/**
 * A strict spending gate for private GitDiagram.
 *
 * The owner has prepaid OpenAI API credits and wants $0 of NEW spending.
 * The credit-funded mode accepts a visitor-provided OpenAI key only, never
 * silently borrowing a server key. Missing or invalid settings fail closed.
 * This code cannot verify whether the owner's API account auto-recharges.
 */
export const PRIVATE_MODEL_SPEND_BLOCKED =
  "AI generation is disabled for this private GitDiagram's $0/month budget.";

export const PRIVATE_MODEL_SPEND_ERROR_CODE = "PRIVATE_MODEL_SPEND_BLOCKED";

const PRIVATE_STORAGE_SPEND_BLOCKED =
  "Remote storage is disabled for this private GitDiagram's $0/month budget.";

function hasPositivePrivateBudget(): boolean {
  const budget = process.env.PRIVATE_MONTHLY_BUDGET_USD?.trim();
  return Boolean(
    budget &&
    /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budget) &&
    Number(budget) > 0,
  );
}

/**
 * The owner confirmed existing OpenAI API credits. $0 is therefore the
 * out-of-pocket ceiling, not a request to disable their prepaid credits.
 * This mode authorizes only an API key supplied in GitDiagram's own credential
 * dialog. It does NOT inspect credits or guarantee the provider's billing
 * settings prevent automatic purchases.
 */
export function privateOpenAICreditsMode(): boolean {
  return (
    process.env.PRIVATE_INSTANCE_ENABLED === "1" &&
    process.env.PRIVATE_MONTHLY_BUDGET_USD?.trim() === "0" &&
    process.env.PRIVATE_OPENAI_CREDITS_ENABLED === "1"
  );
}

export function privateModelSpendBlocked(): boolean {
  if (process.env.PRIVATE_INSTANCE_ENABLED !== "1") return false;
  if (privateOpenAICreditsMode()) return false;
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
