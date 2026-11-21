#!/usr/bin/env node
/**
 * Build the three private GitDiagram Wrangler configurations without touching
 * Cloudflare, changing checked-in files, or reading the upstream secret store.
 *
 * The generated files are ignored by Git. They contain NO credentials.
 * This command has no deploy or Cloudflare API operation.
 *
 * Example:
 *   node scripts/private/render-configs.mjs --origin https://private.example.org
 *   node scripts/private/render-configs.mjs --origin https://gitdiagram-qa.invalid --fixture
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const templates = [
  ["wrangler.private.jsonc", ".wrangler-private-generated.jsonc"],
  ["wrangler.private.server.jsonc", ".wrangler-private-server-generated.jsonc"],
  [
    "wrangler.private.server-local.jsonc",
    ".wrangler-private-server-local-generated.jsonc",
  ],
];
const sentinel = "https://set-private-origin.invalid";

function fail(message) {
  console.error(`Private config preparation refused: ${message}`);
  process.exit(2);
}

function args() {
  const input = process.argv.slice(2);
  const fixture = input.includes("--fixture");
  const idx = input.indexOf("--origin");
  if (idx < 0 || !input[idx + 1]) fail("pass --origin https://your-private-host");
  if (input.some((arg, i) => (
    !["--origin", "--fixture"].includes(arg) &&
    i !== idx + 1
  ))) fail("unexpected argument; only --origin and --fixture are supported");
  return { origin: input[idx + 1], fixture };
}

function validateOrigin(raw, fixture) {
  let url;
  try { url = new URL(raw); } catch { fail("invalid origin URL"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password ||
      url.port || url.pathname !== "/" || url.search || url.hash) {
    fail("origin must be https://hostname with no path, port, query or credentials");
  }
  if (!/^[a-z0-9.-]+$/.test(host) ||
      host === "gitdiagram.com" ||
      host.endsWith(".gitdiagram.com") ||
      host === "localhost" ||
      host.endsWith(".workers.dev") ||
      host.endsWith(".pages.dev")) {
    fail("upstream, preview, localhost and hosted-provider origins are forbidden");
  }
  if (host.endsWith(".invalid") && !fixture) {
    fail(".invalid hosts are accepted only in explicitly offline --fixture mode");
  }
  if (fixture && !host.endsWith(".invalid")) {
    fail("--fixture requires a non-routable .invalid hostname");
  }
  if (!fixture && (!host.includes(".") || host.endsWith(".invalid") ||
      host.endsWith(".example") || host.endsWith(".test"))) {
    fail("production preparation needs a real private domain under your control");
  }
  return url.origin;
}

function checkNoInheritedSecrets() {
  const forbidden = [
    "CF_ENV_FILE",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "META_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "UPSTASH_REDIS_REST_TOKEN",
    "GITHUB_PAT",
    "GITHUB_PATS",
  ];
  const present = forbidden.filter((name) => Boolean(process.env[name]));
  if (present.length) {
    fail(`remove credential/account environment variables first: ${present.join(", ")}`);
  }
}

const { origin: originArg, fixture } = args();
checkNoInheritedSecrets();
const origin = validateOrigin(originArg, fixture);

for (const [template, destination] of templates) {
  const source = readFileSync(resolve(root, template), "utf8");
  if (source.split(sentinel).length !== 2) {
    fail(`expected exactly one private origin placeholder in ${template}`);
  }
  if (!source.includes('"PRIVATE_INSTANCE_ENABLED": "1"') ||
      !source.includes('"workers_dev": false') ||
      !source.includes('"preview_urls": false') ||
      source.includes('"triggers":') ||
      source.includes('"routes":') ||
      source.includes('"tail_consumers":') ||
      source.includes('"containers":') ||
      source.includes('"ratelimits":')) {
    fail(`unsafe deployment surface in ${template}`);
  }
  if (template === "wrangler.private.jsonc" &&
      !source.includes('"run_worker_first": true')) {
    fail("the private ingress Worker must run its auth gate before static assets");
  }
  const generated = source.replace(sentinel, origin);
  writeFileSync(resolve(root, destination), generated, {
    encoding: "utf8",
    mode: 0o600,
    flag: "w",
  });
  console.log(`Generated ${destination} for ${origin}`);
}

console.log(
  fixture
    ? "OFFLINE FIXTURE ONLY. Never deploy this origin."
    : "CONFIGURATION ONLY. Access and live privacy have NOT been verified; do not deploy.",
);
