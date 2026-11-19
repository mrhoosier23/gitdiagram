import { describe, expect, it, vi } from "vitest";
import {
  privateResponseHeaders,
  privateSurfaceDenied,
  rejectUnauthorizedPrivateRequest,
  type PrivateAccessContext,
  type PrivateInstanceEnv,
} from "./private-instance";

const env: PrivateInstanceEnv = {
  PRIVATE_INSTANCE_ENABLED: "1",
  PRIVATE_ALLOWED_EMAIL: "owner@example.com",
  PRIVATE_ACCESS_AUD: "the-private-access-app",
};

function signedIn(email: string, aud = "the-private-access-app"): PrivateAccessContext {
  return {
    access: {
      aud,
      getIdentity: vi.fn().mockResolvedValue({ email }),
    },
  };
}

describe("private instance Cloudflare Access gate", () => {
  it("leaves the existing public instance unchanged when explicitly disabled", async () => {
    const result = await rejectUnauthorizedPrivateRequest(
      { PRIVATE_INSTANCE_ENABLED: "0" },
      {},
      "/",
    );
    expect(result).toBeNull();
  });

  it("denies requests without Cloudflare-attested Access context", async () => {
    const result = await rejectUnauthorizedPrivateRequest(env, {}, "/");
    expect(result?.status).toBe(403);
    expect(result?.headers.get("cache-control")).toContain("no-store");
  });

  it("denies missing configuration even if Access authenticated the caller", async () => {
    for (const configured of [
      { ...env, PRIVATE_ALLOWED_EMAIL: "" },
      { ...env, PRIVATE_ACCESS_AUD: undefined },
    ]) {
      expect(
        (await rejectUnauthorizedPrivateRequest(configured, signedIn("owner@example.com"), "/"))
          ?.status,
      ).toBe(403);
    }
  });

  it("requires the exact Access application audience", async () => {
    const result = await rejectUnauthorizedPrivateRequest(
      env,
      signedIn("owner@example.com", "another-app"),
      "/",
    );
    expect(result?.status).toBe(403);
  });

  it("denies other users even if they have a valid Access session", async () => {
    const result = await rejectUnauthorizedPrivateRequest(
      env,
      signedIn("someone@example.com"),
      "/",
    );
    expect(result?.status).toBe(403);
  });

  it("fails closed on identity lookup errors", async () => {
    const result = await rejectUnauthorizedPrivateRequest(
      env,
      { access: { aud: env.PRIVATE_ACCESS_AUD, getIdentity: async () => { throw new Error("auth unavailable"); } } },
      "/",
    );
    expect(result?.status).toBe(403);
  });

  it("allows only the chosen email on normal diagram and generation routes", async () => {
    for (const path of ["/", "/owner/repo", "/api/generate/stream", "/api/diagram-state"]) {
      const result = await rejectUnauthorizedPrivateRequest(
        env,
        signedIn(" Owner@Example.com "),
        path,
      );
      expect(result).toBeNull();
    }
  });

  it("denies public features even to the owner", async () => {
    for (const path of [
      "/mcp", "/mcp/", "/browse", "/videos", "/api/video/generate",
      "/api/internal/audit", "/api/diagram-preview", "/api/admin",
      "/api/sponsor", "/phx9a/capture", "/admin", "/out/a",
      "/robots.txt", "/sitemap_index.xml", "/sitemap-1.xml",
      "/m%63p", "/API/VIDEO", "/api/indexnow-key",
    ]) {
      expect(privateSurfaceDenied(path)).toBe(true);
      const result = await rejectUnauthorizedPrivateRequest(
        env,
        signedIn("owner@example.com"),
        path,
      );
      expect(result?.status).toBe(404);
      expect(result?.headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("does not block expected diagram editor assets", () => {
    for (const path of ["/", "/_next/static/chunk.js", "/api/generate/cost", "/owner/repo"]) {
      expect(privateSurfaceDenied(path)).toBe(false);
    }
  });

  it("marks successful private responses non-cacheable and non-indexable", async () => {
    const initial = new Response("secret graph", {
      headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "text/plain" },
    });
    const result = privateResponseHeaders(initial, true);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-robots-tag")).toContain("noindex");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await result.text()).toBe("secret graph");
  });
});
