import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPrivateModelSpendAllowed,
  privateModelSpendBlocked,
} from "./private-budget";

afterEach(() => vi.unstubAllEnvs());

describe("private $0 model spending gate", () => {
  it("blocks when the private budget is $0, even with an enable flag", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "0");
    vi.stubEnv("PRIVATE_AI_PAID_CALLS_ENABLED", "1");

    expect(privateModelSpendBlocked()).toBe(true);
    expect(() => assertPrivateModelSpendAllowed()).toThrow(
      /\$0\/month budget/,
    );
  });

  it.each(["", "unknown", "-1", "0.01x"])(
    "fails closed for a missing or invalid private budget %s",
    (budget) => {
      vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
      vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", budget);
      vi.stubEnv("PRIVATE_AI_PAID_CALLS_ENABLED", "1");
      expect(privateModelSpendBlocked()).toBe(true);
    },
  );

  it("requires a separate paid-call switch even with positive budget", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "5");
    vi.stubEnv("PRIVATE_AI_PAID_CALLS_ENABLED", "0");
    expect(privateModelSpendBlocked()).toBe(true);
  });

  it("does not change the upstream public application", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "0");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "0");
    expect(privateModelSpendBlocked()).toBe(false);
    expect(() => assertPrivateModelSpendAllowed()).not.toThrow();
  });
});
