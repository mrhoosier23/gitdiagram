import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifyCloudflareAccessJwt } from "~/lib/access-jwt";
import { rejectUnauthorizedPrivateRequest } from "~/lib/private-instance";

const teamDomain = "andrew-access-test.cloudflareaccess.com";
const audience = "private-worker-audience";
const allowedEmail = "owner@example.com";
const options = { teamDomain, audience, allowedEmail };

let privateKey: webcrypto.CryptoKey;
let publicJwk: JsonWebKey;

function b64(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64url");
}

async function sign(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test-1", typ: "JWT" },
): Promise<string> {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64(signature)}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://${teamDomain}`,
    aud: [audience],
    email: allowedEmail,
    iat: now - 60,
    nbf: now - 60,
    exp: now + 600,
    ...overrides,
  };
}

beforeAll(async () => {
  const keys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = keys.privateKey;
  publicJwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockCloudflareCerts(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        keys: [{ ...publicJwk, kid: "test-1", alg: "RS256", use: "sig" }],
      }),
    ),
  );
}

describe("Cloudflare Access signed JWT fallback", () => {
  it("accepts a valid RS256 token only for the configured issuer, email and AUD", async () => {
    mockCloudflareCerts();
    const token = await sign(claims());
    expect(await verifyCloudflareAccessJwt(token, options)).toBe(true);
    expect(
      await verifyCloudflareAccessJwt(token, {
        ...options,
        audience: "different-app",
      }),
    ).toBe(false);
    expect(
      await verifyCloudflareAccessJwt(token, {
        ...options,
        allowedEmail: "someone-else@example.com",
      }),
    ).toBe(false);
  });

  it("rejects tampered, unsigned and expired tokens", async () => {
    mockCloudflareCerts();
    const valid = await sign(claims());
    const parts = valid.split(".");
    const encodedSignature = parts[2];
    if (!encodedSignature) throw new Error("Missing test signature");
    const tampered = `${parts[0]}.${parts[1]}.${encodedSignature.charAt(0) === "A" ? "B" : "A"}${encodedSignature.slice(1)}`;
    expect(await verifyCloudflareAccessJwt(tampered, options)).toBe(false);
    expect(await verifyCloudflareAccessJwt(await sign(claims({ exp: 1 })), options)).toBe(false);
    expect(
      await verifyCloudflareAccessJwt(
        await sign(claims(), { alg: "none", kid: "test-1" }),
        options,
      ),
    ).toBe(false);
  });

  it("accepts a valid assertion when static asset routing removes ctx.access", async () => {
    mockCloudflareCerts();
    const token = await sign(claims());
    const request = new Request("https://private.example.com/owner/repo", {
      headers: { "cf-access-jwt-assertion": token },
    });
    const response = await rejectUnauthorizedPrivateRequest(
      {
        PRIVATE_INSTANCE_ENABLED: "1",
        PRIVATE_ALLOWED_EMAIL: allowedEmail,
        PRIVATE_ACCESS_AUD: audience,
        PRIVATE_ACCESS_TEAM_DOMAIN: teamDomain,
      },
      {},
      request,
    );
    expect(response).toBeNull();
  });

  it("does not accept a fake Access assertion with an unverifiable issuer", async () => {
    mockCloudflareCerts();
    const token = await sign(claims({ iss: "https://evil.example" }));
    expect(await verifyCloudflareAccessJwt(token, options)).toBe(false);
    expect(
      await verifyCloudflareAccessJwt(token, {
        ...options,
        teamDomain: "https://evil.example",
      }),
    ).toBe(false);
  });
});
