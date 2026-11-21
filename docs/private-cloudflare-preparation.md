# Andrew's private Cloudflare GitDiagram: implementation preparation

**Current release procedure:** [Private deployment runbook](private-deployment-runbook.md). The runbook includes the deny-by-default Access stub, safe offline checks, and blocked future promotion stages. This guide remains the technical context.

**Status: prepared on an isolated Git branch; NOT deployed or approved for deployment.**  
**Source:** `mrhoosier23/gitdiagram`, branch `private-cloudflare-isolation-prep`.  
**Requirements:** only Andrew may access the site and saved diagrams; OpenAI may process the selected source excerpts. This is not an offline-only deployment.

> DO NOT run `bun run cf:deploy` or `scripts/cf-deploy.sh` for this private deployment. Those are the upstream site's release scripts, with original GitDiagram Worker names, domains and account assumptions. Do not merge this branch into `main` to attempt deployment. No credentials or personal email addresses belong in this public fork.

## 1. What has been prepared in code

- `src/lib/private-instance.ts` and `src/lib/access-jwt.ts`: fail-closed owner identity checks. Prefer Cloudflare-attested `ctx.access` where available; when the static-assets router drops that context, cryptographically verify the `Cf-Access-Jwt-Assertion` JWT against the configured Cloudflare Access team's RS256 JWKS, issuer, exact audience, expiry and email. **Never trust an unverified JWT header.** An absent/disabled `PRIVATE_INSTANCE_ENABLED`, invalid JWT, wrong identity or incomplete configuration returns 403.
- `cloudflare/worker.ts`: gate **before** cached pages, generation APIs and video/container routes; set no-store and noindex on returned private responses.
- Private mode returns 404 for public MCP, browse feeds, galleries, video endpoints, sponsor/analytics endpoints, IndexNow, sitemap and robots endpoints, plus related public endpoints.
- Public browse-index updates and public preview writes are suppressed in private mode. IndexNow publishing is disabled regardless of inherited `INDEXNOW_ENABLED`.
- `src/lib/private-instance.test.ts` and `src/server/access-jwt.test.ts`: regression cases for absent/wrong Access identity, missing configuration, wrong audience, cryptographically signed versus tampered/expired JWTs, static-asset-router fallback, owner access, public endpoint denial and no-store/noindex headers.
- **Separate draft Wrangler configurations:** `wrangler.private.jsonc`, `wrangler.private.server.jsonc`, `wrangler.private.server-local.jsonc`. These use different Worker and cache-bucket names, turn IndexNow off, remove public cron triggers, Containers and tail-worker bindings, disable direct `workers.dev` and preview URLs, and set `PRIVATE_INSTANCE_ENABLED=1`.
- **Owner-only Access test stub:** `cloudflare/private-access-stub.ts`, `wrangler.private.stub.jsonc` and `private-access-fixture/access-proof.txt` supply a harmless, default-deny target for verifying Cloudflare Access before uploading GitDiagram.
- **Offline verifier and fixtures:** `scripts/private/offline-verify.sh` performs credential-free tests, build and Wrangler dry runs. `scripts/private/render-configs.mjs` emits private-origin configs locally. `scripts/private/probe-anonymous.mjs` is a separate read-only negative test to run later, only against a real protected stub.

**The new Wrangler files are deliberately drafts.** They cannot be considered deployed or runtime-verified. They do not create any Cloudflare resources. Their placeholder `SITE_ORIGIN` must be replaced with a verified private hostname. The upstream `wrangler.jsonc` and production deployment workflow are untouched. `src/lib/site.ts` now accepts the build-time `NEXT_PUBLIC_SITE_ORIGIN` override, but the private origin has not been selected or wired into a separate build/release process.

## 2. Intended private topology

```text
Your browser
  -> Cloudflare Access: allow one verified email only
  -> andrew-gitdiagram-private (routing Worker + static assets)
       -> andrew-gitdiagram-private-server (internal service binding only)
       -> andrew-gitdiagram-private-server-local (internal binding only)
       -> dedicated Cloudflare R2 diagram/cache buckets
       -> dedicated Upstash Redis
       -> OpenAI API (only source excerpts needed to generate diagrams)
```

**No `gitdiagram-edge` Worker in the private topology.** Cloudflare does not propagate `ctx.access` through service bindings. The routing Worker is the only direct ingress; downstream internal Workers remain unreachable via a public hostname.

Cloudflare Access must protect **the whole routing Worker**, including its static assets and all associated domains and preview URLs, not merely one hostname or `/api` path. Cloudflare's static-assets router can serve assets without invoking the application's `fetch` handler and does not reliably propagate `ctx.access`; signed JWT validation in the application's Worker is the defense-in-depth fallback. It does not replace Worker-level Access, especially for assets served before user code.

Cloudflare references:
- [Worker-level Access and its identity context](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access JWT verification and `ctx.access` limitations](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers `workers.dev` routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

## 3. Deployment blockers (do not skip)

1. **A separate deployment workspace.** The current GitHub fork and this prep branch are public. For private implementation history, move the vetted changes into a separately created, private standalone repository when explicitly authorized. Do not modify the fork's visibility or any sharing settings as part of this preparation.
2. **Cloudflare resource ownership.** Choose an account, but keep JARVIS's Workers, routes, R2, secrets, names and queues untouched. Create three *new* named Workers and a new R2 Next cache bucket matching the draft configs. Create **separate non-public R2 artifact buckets** for `R2_PUBLIC_BUCKET` and `R2_PRIVATE_BUCKET`; the first name is historical and must not imply a public website or R2 public hostname. Ensure `r2.dev` and custom-domain public access are disabled for these buckets.
3. **Zero Trust Access before exposure.** Provision a deny-all stub Worker first, then protect that *Worker* through Access for exactly one verified email and all traffic, including previews. Confirm static assets are gated before replacing the stub with GitDiagram. Never create a publicly reachable unprotected production GitDiagram Worker as a bootstrap step.
4. **Runtime credentials.** After permission to configure resources is explicitly granted, set `PRIVATE_ALLOWED_EMAIL`, `PRIVATE_ACCESS_AUD` and `PRIVATE_ACCESS_TEAM_DOMAIN` only as protected runtime values for the routing Worker. The last is the exact `<team>.cloudflareaccess.com` domain used to verify signed Access JWTs when `ctx.access` is unavailable. Use a separate OpenAI API project/key, R2 credentials, `CACHE_KEY_SECRET`, and dedicated Upstash Redis credentials. Do not put values in the fork, CLI arguments, logs, browser code, or chat. Enable spending controls appropriate to the account.
5. **Domain and generated links.** Replace `https://set-private-origin.invalid` in the private Wrangler configs with the verified private site origin. `src/lib/site.ts` now supports the build-time `NEXT_PUBLIC_SITE_ORIGIN` override, but no actual hostname or private build variable has been supplied. Audit other upstream `gitdiagram.com` URLs in UI links, social metadata and redirects. **This site-origin integration is only partially prepared**, not verified end-to-end.
6. **Private-only build/deploy procedure.** Create a dedicated deployment script or CI workflow that uses **only** the three private Wrangler configurations, scopes account IDs and build variables deliberately, does not deploy the upstream edge Worker, and never routes to `gitdiagram.com` or JARVIS. The original multi-Worker deployment script is **not safe to reuse as-is**. A credential-free build and dry-run procedure has been implemented on the branch but is not yet a deployment procedure. A restricted real-release script is intentionally held until the Access stub and isolated account resources are verified.
7. **Internal service calls.** Validate cache invalidation and read-back flows with the new Access gate. Service-binding invocations of the routing Worker do not inherit Access context, so some upstream self-reference paths may be denied until a narrowly scoped, separately authenticated internal-call mechanism is developed. **Do not bypass the gate globally.**
8. **Static-asset and route QA.** Access must protect every Worker-hosted static asset, HTML, `/_next` path, RSC response, API, Worker preview URL and optional domain. An application-level 403 on dynamic routes is not proof that static assets are private.
9. **Feature minimization.** Videos, browse galleries, anonymous public MCP, sponsor tracking, PostHog analytics, cron automation, feedback mail, Stripe and automatic search-engine indexing are out of scope and disabled at the request boundary. Ensure their scheduled tasks or third-party clients cannot make background requests when released. New video generation is not part of the first private release.

## 4. Before a future deployment: verification gate

Local commands are **checks only**, not deployment. The single verified-entry command is:

```bash
bash scripts/private/offline-verify.sh
```

It runs local checks and builds the app for a deliberately non-routable `.invalid` hostname. It then dry-runs the stub and the three generated private configurations; nothing is deployed and no Cloudflare credentials are accepted. See [the full runbook](private-deployment-runbook.md) for the authorized future Access-test sequence.

The build and dry runs must run in an isolated development environment, with no access to JARVIS production resources and no remote writes. A dry run validates packaging, not authentication or resource isolation. Do not run the upstream automatic deployment workflow.

Required live acceptance checks **after separate deployment authorization**:

| Check | Pass condition |
| --- | --- |
| Anonymous visit to site home, repository page, static JS, image, `/mcp`, generation API and preview URL | No HTML, diagram, image, JSON, or static asset disclosed; Access challenge or denial |
| Visitor with a different permitted Cloudflare account | Denied, even when signed into that account |
| Exact owner identity and correct Access AUD | Can open main UI, generate a small diagram and reopen its persisted result |
| Missing Access context, identity lookup failure, wrong AUD, or missing configured identity | All denied fail-closed |
| Diagram storage and browse/search | Results only in new dedicated private R2 resources, never upstream/public buckets or search feeds |
| Public discovery | No public MCP, sitemap, browse-index entry, IndexNow notification, or public video/gallery endpoint |
| Costs and external data | Only chosen OpenAI API receives bounded code excerpts; other model/analytics/video services disabled; API usage and limits checked |
| App lifecycle | Builds/tests pass; page refresh, diagram persistence, rate limiting and cancellation function end-to-end |
| Existing services | JARVIS, upstream GitDiagram, existing Workers/R2/Redis and public fork default branch unchanged |

## 5. Key privacy distinctions

- **Only Andrew can reach the site** is achievable with Worker-level Cloudflare Access plus the in-code fail-closed check. It still must be tested at every reachable endpoint.
- **No public diagrams** requires non-public dedicated buckets, disabled publishing and Access at the edge.
- **Source code sent to OpenAI** is specifically permitted for architecture generation in this design. The app should send only necessary bounded code excerpts; do not include secrets or private files unintentionally.
- **The fork's code is public today.** Nothing in this branch is a credential or private configuration value, but code, commit history and prep docs remain visible on GitHub until moved into a separate private repository.
- **No one else can see stored source analysis** is not identical to offline processing: the chosen cloud hosting and model providers process data under their respective contracts.

## 6. Honest status and smallest resume point

**Completed in the fork:** fail-closed private-mode gate with signed JWT fallback, public-surface restrictions, suppression of discovery writes, unit-test source, build-time site-origin override, isolated **draft** Wrangler configurations, static-assets worker-first protection, deny-by-default Access stub, safe fixture, offline build/verification commands, and read-only future anonymous Access probe.

**Not completed:** private standalone repository, new Cloudflare Access policy, private hostname, R2/Redis provisioning, secret setup, account-attested release script, protected UI smoke test, end-to-end persistence and live privacy verification. Offline CI status must be checked against its actual latest run; code presence is not passing QA.

**Resume here:** use the [stub-first runbook](private-deployment-runbook.md), verifying the actual Cloudflare Access policy with only the harmless deny-by-default stub before any full application promotion. Do not merge/deploy GitDiagram until the checks above pass.
