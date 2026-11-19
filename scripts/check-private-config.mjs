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
    '"INDEXNOW_ENABLED": "0"',
    '"bucket_name": "andrew-gitdiagram-private-next-cache"',
  ];
  const forbidden = [
    /"workers_dev"\s*:\s*true/,
    /"triggers"\s*:/,
    /"routes"\s*:/,
    /"route"\s*:/,
    /"tail_consumers"\s*:/,
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

const routing = readFileSync("cloudflare/worker.ts", "utf8");
const gate = readFileSync("src/lib/private-instance.ts", "utf8");
const index = readFileSync("src/server/storage/diagram-state.ts", "utf8");
const indexNow = readFileSync("src/server/visibility/indexnow.ts", "utf8");

for (const [name, condition] of [
  ["routing Worker owner gate", routing.includes("rejectUnauthorizedPrivateRequest")],
  ["Cloudflare Access identity check", gate.includes("ctx.access")],
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
