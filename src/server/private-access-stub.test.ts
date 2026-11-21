import { describe, expect, it, vi } from "vitest";

import stub from "../../cloudflare/private-access-stub";

const env = {
  PRIVATE_INSTANCE_ENABLED: "1",
  PRIVATE_ALLOWED_EMAIL: "owner@example.com",
  PRIVATE_ACCESS_AUD: "private-test",
  PRIVATE_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ASSETS: {
    fetch: vi.fn(async () => new Response("test asset")),
  },
};

function request(path: string) {
  return new Request(`https://private.example.com${path}`);
}

const owner = {
  access: {
    aud: "private-test",
    getIdentity: async () => ({ email: "owner@example.com" }),
  },
};

describe("private pre-deployment Access stub", () => {
  it("rejects anonymous dynamic routes and static assets", async () => {
    for (const path of ["/", "/__access-check", "/access-proof.txt"]) {
      const response = await stub.fetch(request(path), env, {});
      expect(response.status).toBe(403);
    }
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("permits the verified owner to read a safe fixture", async () => {
    const check = await stub.fetch(request("/__access-check"), env, owner);
    expect(check.status).toBe(200);
    expect((await check.json()).mode).toBe("access-stub");
    const asset = await stub.fetch(request("/access-proof.txt"), env, owner);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("no-store");
    expect(await asset.text()).toBe("test asset");
  });

  it("returns 404 on unexpected routes even for the owner", async () => {
    const response = await stub.fetch(
      request("/api/generate/stream"),
      env,
      owner,
    );
    expect(response.status).toBe(404);
  });
});
