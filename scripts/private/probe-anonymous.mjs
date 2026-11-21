#!/usr/bin/env node
/**
 * Read-only NEGATIVE access smoke test for a future protected stub hostname.
 *
 * This script is not run by offline CI. It makes outbound requests only when
 * explicitly invoked with --origin after Cloudflare Access is configured.
 * It does not accept, read, save or log credentials.
 *
 * Example (only after separate infrastructure authorization):
 *   node scripts/private/probe-anonymous.mjs --origin https://private.example.org
 *
 * The public read-only smoke test does NOT prove that the owner's login works
 * or that the Worker-level Access policy covers every deployment URL. Perform
 * the owner and alternate-hostname tests in the runbook as well.
 */
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--origin") {
  console.error("Usage: node scripts/private/probe-anonymous.mjs --origin https://protected.example.org");
  process.exit(2);
}
let origin;
try {
  const url = new URL(args[1]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname === "gitdiagram.com" ||
    url.hostname.endsWith(".gitdiagram.com") ||
    url.hostname.endsWith(".invalid") ||
    url.hostname.endsWith(".workers.dev") ||
    url.hostname.endsWith(".pages.dev")
  ) {
    throw new Error("unsafe probe URL");
  }
  origin = url.origin;
} catch {
  console.error("Refusing to probe an unapproved or invalid origin.");
  process.exit(2);
}

const paths = [
  "/",
  "/__access-check",
  "/access-proof.txt",
  "/mcp",
  "/api/generate/stream",
];
let failed = false;
for (const path of paths) {
  try {
    const response = await fetch(new URL(path, origin), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "Cache-Control": "no-store" },
    });
    // An Access challenge/redirect or a denied request counts as a safe
    // NEGATIVE observation. A 404 is inconclusive (it might just not exist).
    const denied = [301, 302, 303, 307, 308, 401, 403].includes(
      response.status,
    );
    await response.body?.cancel();
    console.log(`${path}: HTTP ${response.status} — ${denied ? "denied" : "FAIL / INCONCLUSIVE"}`);
    if (!denied) failed = true;
  } catch {
    failed = true;
    console.error(`${path}: no verifiable denial response`);
  }
}
if (failed) {
  console.error(
    "NOT VERIFIED: Do not expose source code, use private repos or promote the app.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Anonymous checks denied. Next: verify owner login and alternate domains,",
    "then test persisted diagrams and resource isolation. No deployment done.",
  );
}
