// Private GitDiagram core Worker, isolated from upstream and JARVIS services.
// No Durable Objects, R2, Redis, schedules, external analytics, or public assets.
import { PRIVATE_HTML } from "./private-diagram-ui.js";
import { analyze } from "./private-diagram-analysis.js";
const HOST = "gitdiagram.awolverton.com";
const ORIGIN = "https://" + HOST;
const KEY_OPENAI = "__Host-gd_openai";
const KEY_GITHUB = "__Host-gd_github";
const COOKIE_AGE = 60 * 60 * 6;
const BASE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
function headers(extra) {
  const x = new Headers(BASE);
  for (const [k, v] of Object.entries(extra || {})) x.set(k, v);
  return x;
}
function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: headers({
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    }),
  });
}
function error(message, status) {
  return json({ ok: false, error: message }, status || 400);
}
function cookie(request, name) {
  const h = request.headers.get("cookie") || "";
  for (const p of h.split(";")) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    if (p.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(p.slice(i + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}
function setCookie(name, value) {
  return (
    name +
    "=" +
    encodeURIComponent(value) +
    "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=" +
    (value ? COOKIE_AGE : 0)
  );
}
function verifiedInput(request) {
  const origin = request.headers.get("origin");
  const sec = request.headers.get("sec-fetch-site");
  return (
    origin === ORIGIN &&
    (!sec || sec === "same-origin" || sec === "none") &&
    new URL(request.url).hostname === HOST
  );
}
async function boundedJson(request, max) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("application/json"))
    throw Object.assign(new Error("Expected JSON request."), { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > max)
    throw Object.assign(new Error("Input too large."), { status: 413 });
  if (!request.body)
    throw Object.assign(new Error("Missing request body."), { status: 400 });
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > max)
        throw Object.assign(new Error("Input too large."), { status: 413 });
      parts.push(r.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  const bytes = new Uint8Array(size);
  let i = 0;
  for (const p of parts) {
    bytes.set(p, i);
    i += p.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}
async function authenticated(env, ctx) {
  if (
    env?.PRIVATE_INSTANCE_ENABLED !== "1" ||
    !env.PRIVATE_ALLOWED_EMAIL ||
    !env.PRIVATE_ACCESS_AUD
  )
    return false;
  if (!ctx?.access || ctx.access.aud !== env.PRIVATE_ACCESS_AUD) return false;
  try {
    const identity = await ctx.access.getIdentity();
    return (
      identity &&
      typeof identity.email === "string" &&
      identity.email.trim().toLowerCase() ===
        env.PRIVATE_ALLOWED_EMAIL.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}
function home() {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp =
    "default-src 'none'; script-src 'nonce-" +
    nonce +
    "'; style-src 'nonce-" +
    nonce +
    "'; connect-src 'self'; img-src 'self' data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
  return new Response(PRIVATE_HTML.replaceAll("__NONCE__", nonce), {
    headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    }),
  });
}
async function handle(request, env, ctx) {
  if (!(await authenticated(env, ctx)))
    return new Response("Access required", {
      status: 403,
      headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  const url = new URL(request.url);
  if (url.hostname !== HOST) return error("Unknown hostname.", 403);
  const path = url.pathname;
  if (request.method === "GET") {
    if (path === "/") return home();
    if (path === "/__access-check")
      return json({ private: true, authenticated: true, mode: "access-stub" });
    if (path === "/access-proof.txt")
      return new Response(
        "Harmless Cloudflare Access test fixture. No GitDiagram data.\n",
        { headers: headers({ "Content-Type": "text/plain; charset=utf-8" }) },
      );
    if (path === "/api/keys")
      return json({
        ok: true,
        openai: Boolean(cookie(request, KEY_OPENAI)),
        github: Boolean(cookie(request, KEY_GITHUB)),
        model: "gpt-5-mini",
        storage: "this browser only",
      });
    return error("Not found.", 404);
  }
  if (!verifiedInput(request))
    return error("Cross-origin action refused.", 403);
  if (
    request.method === "POST" &&
    (path === "/api/keys/openai" || path === "/api/keys/github")
  ) {
    const body = await boundedJson(request, 2600);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const isOpenAI = path.endsWith("/openai");
    const pattern = isOpenAI
      ? /^sk-[A-Za-z0-9_-]{12,2040}$/
      : /^(?:ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_-]{10,2000}$/;
    if (!pattern.test(key))
      return error(
        isOpenAI
          ? "Enter a valid OpenAI API key."
          : "Enter a valid GitHub access token.",
        400,
      );
    return json({ ok: true, saved: true }, 200, {
      "Set-Cookie": setCookie(isOpenAI ? KEY_OPENAI : KEY_GITHUB, key),
    });
  }
  if (
    request.method === "DELETE" &&
    (path === "/api/keys/openai" || path === "/api/keys/github")
  ) {
    return json({ ok: true, cleared: true }, 200, {
      "Set-Cookie": setCookie(
        path.endsWith("/openai") ? KEY_OPENAI : KEY_GITHUB,
        "",
      ),
    });
  }
  if (request.method === "POST" && path === "/api/diagram") {
    if (
      env.PRIVATE_OPENAI_CREDITS_ENABLED !== "1" ||
      env.PRIVATE_MONTHLY_BUDGET_USD !== "0"
    )
      return error("Prepaid-credit mode not configured.", 403);
    const apiKey = cookie(request, KEY_OPENAI);
    if (!apiKey)
      return error("Save your OpenAI API key using Key settings first.", 401);
    const body = await boundedJson(request, 1200);
    const result = await analyze(
      body?.repo,
      cookie(request, KEY_GITHUB),
      apiKey,
    );
    return json(result);
  }
  return error("Not found.", 404);
}
export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      return error(
        typeof e?.message === "string" && e.message.length < 250
          ? e.message
          : "Request failed.",
        Number.isInteger(e?.status) ? e.status : 502,
      );
    }
  },
};
export const PRIVATE_API_TEST = { authenticated, cookie, verifiedInput };
