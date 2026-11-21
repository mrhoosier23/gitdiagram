/**
 * Verify Cloudflare Access JWTs without a third-party runtime dependency.
 *
 * Workers with Static Assets can lose ctx.access at the internal asset router.
 * Cloudflare still forwards Cf-Access-Jwt-Assertion; only an RS256 signature
 * issued by the configured Cloudflare Access team may grant private access.
 *
 * Docs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */
const JWKS_CACHE_MS = 5 * 60 * 1000;
const MAX_TOKEN_LENGTH = 16 * 1024;
const MAX_CERTS_RESPONSE_LENGTH = 64 * 1024;
const CLOCK_SKEW_SECONDS = 30;

interface AccessJwk {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

interface AccessJwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface AccessJwtClaims {
  iss?: unknown;
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
}

const cachedKeys = new Map<string, { at: number; keys: AccessJwk[] }>();

function issuerFromTeamDomain(teamDomain: string): string | null {
  const raw = teamDomain.trim().toLowerCase();
  const hostname = raw.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(hostname)) {
    return null;
  }
  return `https://${hostname}`;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!value || value.length > MAX_TOKEN_LENGTH || !/^[\w-]+$/.test(value)) {
    return null;
  }
  try {
    const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const bytes = atob(padded);
    return Uint8Array.from(bytes, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJsonPart<T>(encoded: string): T | null {
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function readKeys(issuer: string, force = false): Promise<AccessJwk[]> {
  const cached = cachedKeys.get(issuer);
  if (!force && cached && Date.now() - cached.at < JWKS_CACHE_MS) {
    return cached.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Cloudflare Access keys unavailable");

  const body = await response.text();
  if (body.length > MAX_CERTS_RESPONSE_LENGTH) {
    throw new Error("Cloudflare Access key response too large");
  }

  const parsed = JSON.parse(body) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) {
    throw new Error("Cloudflare Access keys missing");
  }
  const keys: AccessJwk[] = parsed.keys.filter(
    (key: unknown): key is AccessJwk => {
      if (typeof key !== "object" || key === null) return false;
      const obj = key as Partial<AccessJwk>;
      return (
        obj.kty === "RSA" &&
        typeof obj.kid === "string" &&
        typeof obj.n === "string" &&
        typeof obj.e === "string" &&
        (!obj.alg || obj.alg === "RS256") &&
        (!obj.use || obj.use === "sig")
      );
    },
  );
  if (!keys.length) throw new Error("No valid Cloudflare Access signing keys");
  cachedKeys.set(issuer, { at: Date.now(), keys });
  return keys;
}

async function checkSignature(
  issuer: string,
  kid: string,
  input: string,
  signature: Uint8Array,
): Promise<boolean> {
  for (let refresh = 0; refresh < 2; refresh += 1) {
    const keys = await readKeys(issuer, refresh === 1);
    const jwk = keys.find((key) => key.kid === kid);
    if (!jwk) continue;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      // Copy to an ArrayBuffer-backed view for TypeScript 7's BufferSource type.
      new Uint8Array(signature),
      new TextEncoder().encode(input),
    );
  }
  return false;
}

export interface AccessJwtVerification {
  teamDomain: string;
  audience: string;
  allowedEmail: string;
}

/** Fail closed on malformed tokens, bad signatures, mismatched claims or JWKS errors. */
export async function verifyCloudflareAccessJwt(
  assertion: string | null,
  options: AccessJwtVerification,
): Promise<boolean> {
  const issuer = issuerFromTeamDomain(options.teamDomain);
  if (!issuer || !assertion || assertion.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const parts = assertion.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (!encodedHeader || !encodedClaims || !encodedSignature) return false;

  const header = decodeJsonPart<AccessJwtHeader>(encodedHeader);
  const claims = decodeJsonPart<AccessJwtClaims>(encodedClaims);
  const signature = decodeBase64Url(encodedSignature);
  if (
    !header ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    header.kid.length > 128 ||
    !claims ||
    !signature
  ) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const aud = claims.aud;
  const audienceMatches =
    aud === options.audience ||
    (Array.isArray(aud) && aud.includes(options.audience));
  if (
    claims.iss !== issuer ||
    !audienceMatches ||
    typeof claims.email !== "string" ||
    claims.email.trim().toLowerCase() !==
      options.allowedEmail.trim().toLowerCase() ||
    !Number.isSafeInteger(claims.exp) ||
    (claims.exp as number) <= now - CLOCK_SKEW_SECONDS ||
    (claims.nbf !== undefined &&
      (!Number.isSafeInteger(claims.nbf) ||
        (claims.nbf as number) > now + CLOCK_SKEW_SECONDS)) ||
    (claims.iat !== undefined &&
      (!Number.isSafeInteger(claims.iat) ||
        (claims.iat as number) > now + CLOCK_SKEW_SECONDS))
  ) {
    return false;
  }

  try {
    return await checkSignature(
      issuer,
      header.kid,
      `${encodedHeader}.${encodedClaims}`,
      signature,
    );
  } catch {
    return false;
  }
}
