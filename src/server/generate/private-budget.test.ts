import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPrivateMeteredStorageAllowed,
  assertPrivateModelSpendAllowed,
  privateMeteredStorageBlocked,
  privateModelSpendBlocked,
  privateOpenAICreditsMode,
} from "./private-budget";

afterEach(() => vi.unstubAllEnvs());

describe("private $0 model spending gate", () => {
  it("blocks when the private budget is $0, even with an enable flag", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "0");
    vi.stubEnv("PRIVATE_AI_PAID_CALLS_ENABLED", "1");

    expect(privateModelSpendBlocked()).toBe(true);
    expect(privateMeteredStorageBlocked()).toBe(true);
    expect(() => assertPrivateModelSpendAllowed()).toThrow(/\$0\/month budget/);
    expect(() => assertPrivateMeteredStorageAllowed()).toThrow(
      /\$0\/month budget/,
    );
  });

  it("permits prepaid OpenAI credits with a $0 new-spending limit", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "0");
    vi.stubEnv("PRIVATE_OPENAI_CREDITS_ENABLED", "1");
    vi.stubEnv("PRIVATE_AI_PAID_CALLS_ENABLED", "0");

    expect(privateOpenAICreditsMode()).toBe(true);
    expect(privateModelSpendBlocked()).toBe(false);
    expect(() => assertPrivateModelSpendAllowed()).not.toThrow();
    expect(privateMeteredStorageBlocked()).toBe(true);
  });

  it("refuses credit mode without an exact $0 budget and explicit flag", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_OPENAI_CREDITS_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "5");
    expect(privateOpenAICreditsMode()).toBe(false);
    expect(privateModelSpendBlocked()).toBe(true);
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

  it("requires a separate storage switch even with a positive budget", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "5");
    vi.stubEnv("PRIVATE_METERED_STORAGE_ENABLED", "0");
    expect(privateMeteredStorageBlocked()).toBe(true);
  });

  it("does not change the upstream public application", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "0");
    vi.stubEnv("PRIVATE_MONTHLY_BUDGET_USD", "0");
    expect(privateModelSpendBlocked()).toBe(false);
    expect(privateMeteredStorageBlocked()).toBe(false);
    expect(() => assertPrivateModelSpendAllowed()).not.toThrow();
    expect(() => assertPrivateMeteredStorageAllowed()).not.toThrow();
  });
});
