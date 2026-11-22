import { afterEach, describe, expect, it, vi } from "vitest";

import { getGenerationProvider, getProvider } from "./model-config";

afterEach(() => vi.unstubAllEnvs());

describe("private GitDiagram model-provider restriction", () => {
  it("only permits OpenAI in private mode", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(getProvider()).toBe("openai");
    expect(getGenerationProvider({})).toBe("openai");
    vi.stubEnv("AI_PROVIDER", "openrouter");
    expect(() => getProvider()).toThrow("only permits the OpenAI provider");
    vi.stubEnv("AI_PROVIDER", "meta");
    expect(() => getGenerationProvider({})).toThrow(
      "only permits the OpenAI provider",
    );
  });

  it("preserves public provider selection", () => {
    vi.stubEnv("PRIVATE_INSTANCE_ENABLED", "0");
    expect(getProvider("openrouter")).toBe("openrouter");
    expect(getProvider("meta")).toBe("meta");
  });
});
