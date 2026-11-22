/**
 * Static preflight checks for Andrew's isolated private Wrangler drafts.
 * No network access, credentials, provisioning or deployment.
 *
 * Usage: node scripts/check-private-config.mjs
 */
import { readFileSync } from "node:fs";

const configFiles = {
  "wrangler.private.jsonc": "andrew-gitdiagram-private",
  "wrangler.private.server.jsonc": "andrew-gitdiagram-private-server",
  "wrangler.private.server-local.jsonc": "andrew-gitdiagram-private-server-local",
};

let failed = false;
for (const [file, name] of Object.entries(configFiles)) {
  const source = readFileSync(file, "utf8");
  const expected = [
    `"name": "${name}"`,
    '"workers_dev": false',
    '"preview_urls": false',
    '"PRIVATE_INSTANCE_ENABLED": "1"',
    '"PRIVATE_MONTHLY_BUDGET_USD": "0"',
    '"PRIVATE_AI_PAID_CALLS_ENABLED": "0"',
    '"PRIVATE_OPENAI_CREDITS_ENABLED": "1"',
    '"PRIVATE_METERED_STORAGE_ENABLED": "0"',
    '"INDEXNOW_ENABLED": "0"',
    '"bucket_name": "andrew-gitdiagram-private-next-cache"',
  ];
  const forbidden = [
    /"workers_dev"\s*:\s*true/,
    /"triggers"\s*:/,
    /"routes"\s*:/,
    /"route"\s*:/,
    /"tail_consumers"\s*:/,
    /"ratelimits"\s*:/,
    /"INDEXNOW_ENABLED"\s*:\s*"1"/,
    /"SITE_ORIGIN"\s*:\s*"https:\/\/gitdiagram\.com"/,
    /"(?:name|service|script_name)"\s*:\s*"gitdiagram(?:-server(?:-local)?)?"/,
    /"bucket_name"\s*:\s*"gitdiagram-next-cache"/,
  ];
  const missing = expected.filter((item) => !source.includes(item));
  const violations = forbidden.filter((pattern) => pattern.test(source));
  if (missing.length > 0 || violations.length > 0) {
    failed = true;
    console.error(file, {
      missing,
      forbiddenMatches: violations.map(String),
    });
  } else {
    console.log(`${file}: isolated draft structure OK`);
  }
}

const stubConfig = readFileSync("wrangler.private.stub.jsonc", "utf8");
const stubCode = readFileSync("cloudflare/private-access-stub.ts", "utf8");
if (!stubConfig.includes('"workers_dev": false') ||
    !stubConfig.includes('"PRIVATE_MONTHLY_BUDGET_USD": "0"') ||
    !stubConfig.includes('"PRIVATE_AI_PAID_CALLS_ENABLED": "0"') ||
    !stubConfig.includes('"PRIVATE_OPENAI_CREDITS_ENABLED": "1"') ||
    !stubConfig.includes('"PRIVATE_METERED_STORAGE_ENABLED": "0"') ||
    !stubConfig.includes('"preview_urls": false') ||
    !stubConfig.includes('"run_worker_first": true') ||
    !stubCode.includes("rejectUnauthorizedPrivateRequest") ||
    !stubConfig.includes("private-access-stub-worker.ts") ||
    !stubConfig.includes('"new_sqlite_classes"')) {
  failed = true;
  console.error("Private Access stub must be fail-closed and protect static assets");
}

const offlineBuild = readFileSync("scripts/private/offline-verify.sh", "utf8");
const privateBuild = readFileSync("src/lib/private-build.ts", "utf8");
const providers = readFileSync("src/app/providers.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const modelProvider = readFileSync("src/server/generate/model-config.ts", "utf8");

const routing = readFileSync("cloudflare/worker.ts", "utf8");
const gate = readFileSync("src/lib/private-instance.ts", "utf8");
const signedJwt = readFileSync("src/lib/access-jwt.ts", "utf8");
const index = readFileSync("src/server/storage/diagram-state.ts", "utf8");
const indexNow = readFileSync("src/server/visibility/indexnow.ts", "utf8");

for (const [name, condition] of [
  ["private compiled UI flag", offlineBuild.includes("NEXT_PUBLIC_PRIVATE_INSTANCE=1")],
  ["private UI flag read", privateBuild.includes("NEXT_PUBLIC_PRIVATE_INSTANCE")],
  ["private mode skips analytics", providers.includes("!PRIVATE_BUILD && <AnalyticsAfterCredentialMigration")],
  ["private mode skips sponsor polling", layout.includes("PRIVATE_BUILD ? (")],
  ["private mode only uses OpenAI", modelProvider.includes("Private GitDiagram only permits the OpenAI provider")],
  ["routing Worker owner gate", routing.includes("rejectUnauthorizedPrivateRequest")],
  ["Cloudflare Access identity check", gate.includes("ctx.access")],
  ["signed JWT verification", gate.includes("verifyCloudflareAccessJwt")],
  ["cryptographic JWT validation", signedJwt.includes("crypto.subtle.verify")],
  ["private public-index suppression", index.includes('PRIVATE_INSTANCE_ENABLED === "1"')],
  ["private IndexNow suppression", indexNow.includes('PRIVATE_INSTANCE_ENABLED !== "1"')],
]) {
  if (!condition) {
    failed = true;
    console.error(`Missing: ${name}`);
  }
}

if (failed) process.exitCode = 1;
else {
  console.log(
    "Private structural preflight passed. This is NOT deployment readiness:",
    "Access, resources, runtime configuration and live privacy still need verification.",
  );
}
