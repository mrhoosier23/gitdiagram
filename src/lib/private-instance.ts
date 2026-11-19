/**
 * Opt-in privacy gate for a dedicated, private Cloudflare Workers deployment.
 *
 * IMPORTANT: This protects dynamic Worker requests. Cloudflare serves some
 * static assets before invoking this Worker, so an owner-only, WORKER-LEVEL
 * Access policy must also cover the deployed Worker and ALL of its URLs.
 * Never use a hostname-only Access policy as the sole protection.
 *
 * Service bindings do not propagate ctx.access. The private topology therefore
 * enters through this routing Worker directly; do not use gitdiagram-edge.
 */
import { verifyCloudflareAccessJwt } from "./access-jwt";

export interface PrivateInstanceEnv {
  PRIVATE_INSTANCE_ENABLED?: string;
  /** Your Cloudflare Access team domain, e.g. team.cloudflareaccess.com. */
  PRIVATE_ACCESS_TEAM_DOMAIN?: string;
  /** Set as a runtime secret, never checked into Git. */
  PRIVATE_ALLOWED_EMAIL?: string;
  /** Cloudflare Access application AUD tag; different from a user's email. */
  PRIVATE_ACCESS_AUD?: string;
}

export interface PrivateAccessContext {
  access?: {
    aud?: string;
    getIdentity(): Promise<{ email?: string | null } | null | undefined>;
  };
}

function blocked(status: 403 | 404): Response {
  return new Response(status === 403 ? "Access required" : "Not found", {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The standalone installation is a private diagram editor, not the upstream
 * public diagram gallery, MCP server, analytics site, or video marketplace.
 * The denied surfaces are checked even after Cloudflare Access authenticated.
 */
export function privateSurfaceDenied(pathname: string): boolean {
  let path: string;
  try {
    path =
      decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return true;
  }

  const exact = new Set([
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/llms.txt",
    "/llms-full.txt",
    "/mcp",
    "/browse",
    "/videos",
    "/reels",
    "/admin",
    "/advertise",
    "/sponsor",
    "/most-starred-repositories",
    "/architecture-examples",
    "/best-codebase-visualization-tools",
  ]);
  if (exact.has(path) || /^\/sitemap[-/]/.test(path)) return true;

  const prefixes = [
    "/mcp/",
    "/browse/",
    "/videos/",
    "/video/",
    "/reels/",
    "/admin/",
    "/advertise/",
    "/sponsor/",
    "/out/",
    "/api/admin",
    "/api/analytics-context",
    "/api/browse-index",
    "/api/diagram-preview",
    "/api/internal",
    "/api/openai-apps-challenge",
    "/api/indexnow-key",
    "/api/video",
    "/api/sponsor",
    "/phx9a",
    "/.well-known/openai-apps-challenge",
  ];
  return prefixes.some(
    (prefix) =>
      path === prefix ||
      path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

/**
 * `ctx.access` is trustworthy when present, but the Cloudflare static-assets
 * router often drops it. Then validate the signed Access assertion against
 * the tenant's JWKS; NEVER trust the unverified JWT payload or request email.
 *
 * PRIVATE_INSTANCE_ENABLED must be explicitly set: an omitted configuration
 * does not silently turn a private branch into a public installation.
 */
export async function rejectUnauthorizedPrivateRequest(
  env: PrivateInstanceEnv,
  ctx: PrivateAccessContext,
  request: Request,
): Promise<Response | null> {
  if (env.PRIVATE_INSTANCE_ENABLED !== "1") return blocked(403);

  const allowedEmail = env.PRIVATE_ALLOWED_EMAIL?.trim().toLowerCase();
  const allowedAudience = env.PRIVATE_ACCESS_AUD?.trim();
  const teamDomain = env.PRIVATE_ACCESS_TEAM_DOMAIN?.trim();
  if (!allowedEmail || !allowedAudience || !teamDomain) return blocked(403);

  let authenticated = false;
  if (ctx.access) {
    if (ctx.access.aud !== allowedAudience) return blocked(403);
    try {
      const identity = await ctx.access.getIdentity();
      authenticated =
        identity?.email?.trim().toLowerCase() === allowedEmail;
    } catch {
      return blocked(403);
    }
  } else {
    authenticated = await verifyCloudflareAccessJwt(
      request.headers.get("cf-access-jwt-assertion"),
      {
        teamDomain,
        audience: allowedAudience,
        allowedEmail,
      },
    );
  }

  if (!authenticated) return blocked(403);
  const pathname = new URL(request.url).pathname;
  return privateSurfaceDenied(pathname) ? blocked(404) : null;
}

/** Even authorized private pages must not advertise themselves to crawlers. */
export function privateResponseHeaders(
  response: Response,
  enabled: boolean,
): Response {
  if (!enabled || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
