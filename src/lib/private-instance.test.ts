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
  PRIVATE_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
};

function signedIn(
  email: string,
  aud = "the-private-access-app",
): PrivateAccessContext {
  return {
    access: { aud, getIdentity: vi.fn().mockResolvedValue({ email }) },
  };
}

function request(path: string): Request {
  return new Request(`https://private.example.com${path}`);
}

describe("private Cloudflare Access gate", () => {
  it("denies when private mode is missing or explicitly disabled", async () => {
    for (const value of [undefined, "0"]) {
      expect(
        (
          await rejectUnauthorizedPrivateRequest(
            { ...env, PRIVATE_INSTANCE_ENABLED: value },
            signedIn("owner@example.com"),
            request("/"),
          )
        )?.status,
      ).toBe(403);
    }
  });

  it("denies requests without Cloudflare-attested access or JWT", async () => {
    const response = await rejectUnauthorizedPrivateRequest(
      env,
      {},
      request("/"),
    );
    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toContain("no-store");
  });

  it("denies missing identity or Access configuration", async () => {
    for (const configured of [
      { ...env, PRIVATE_ALLOWED_EMAIL: "" },
      { ...env, PRIVATE_ACCESS_AUD: undefined },
      { ...env, PRIVATE_ACCESS_TEAM_DOMAIN: "" },
    ]) {
      const response = await rejectUnauthorizedPrivateRequest(
        configured,
        signedIn("owner@example.com"),
        request("/"),
      );
      expect(response?.status).toBe(403);
    }
  });

  it("requires the exact authenticated Access audience", async () => {
    const response = await rejectUnauthorizedPrivateRequest(
      env,
      signedIn("owner@example.com", "another-app"),
      request("/"),
    );
    expect(response?.status).toBe(403);
  });

  it("denies a different signed-in user", async () => {
    const response = await rejectUnauthorizedPrivateRequest(
      env,
      signedIn("someone@example.com"),
      request("/"),
    );
    expect(response?.status).toBe(403);
  });

  it("fails closed if an Access identity lookup throws", async () => {
    const response = await rejectUnauthorizedPrivateRequest(
      env,
      {
        access: {
          aud: env.PRIVATE_ACCESS_AUD,
          getIdentity: async () => {
            throw new Error("identity unavailable");
          },
        },
      },
      request("/"),
    );
    expect(response?.status).toBe(403);
  });

  it("permits the owner's normal diagram and generation routes", async () => {
    for (const path of [
      "/",
      "/owner/repo",
      "/api/generate/stream",
      "/api/diagram-state",
    ]) {
      const response = await rejectUnauthorizedPrivateRequest(
        env,
        signedIn(" Owner@Example.com "),
        request(path),
      );
      expect(response).toBeNull();
    }
  });

  it("blocks the public discovery, video, analytics and MCP surfaces", async () => {
    for (const path of [
      "/mcp",
      "/mcp/",
      "/browse",
      "/videos",
      "/api/video/generate",
      "/api/internal/audit",
      "/api/diagram-preview",
      "/api/admin",
      "/api/sponsor",
      "/phx9a/capture",
      "/admin",
      "/out/a",
      "/robots.txt",
      "/sitemap_index.xml",
      "/sitemap-1.xml",
      "/m%63p",
      "/API/VIDEO",
      "/api/indexnow-key",
    ]) {
      expect(privateSurfaceDenied(path)).toBe(true);
      const response = await rejectUnauthorizedPrivateRequest(
        env,
        signedIn("owner@example.com"),
        request(path),
      );
      expect(response?.status).toBe(404);
      expect(response?.headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("leaves the editor and ordinary static-file paths available to Access", () => {
    for (const path of [
      "/",
      "/_next/static/chunk.js",
      "/api/generate/cost",
      "/owner/repo",
    ]) {
      expect(privateSurfaceDenied(path)).toBe(false);
    }
  });

  it("sets private cache and search-engine headers", async () => {
    const response = privateResponseHeaders(
      new Response("secret graph", {
        headers: { "Cache-Control": "public, max-age=3600" },
      }),
      true,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("secret graph");
  });
});
