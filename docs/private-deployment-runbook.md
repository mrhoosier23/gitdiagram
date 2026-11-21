# Private GitDiagram: isolated Cloudflare deployment runbook

**Current state:** implementation and offline verification only. **NOT deployed or approved for deployment.**  
**Preparation branch:** `private-cloudflare-isolation-prep` in `mrhoosier23/gitdiagram` (currently public).  
**Owner-only requirement:** Cloudflare Access must permit one exact owner identity; generated diagrams must not be accessible to other users. OpenAI may process bounded source-code excerpts.  
**Boundary:** JARVIS resources, the original `gitdiagram.com` service, all existing account routes, existing credentials, and default-branch deployment automation are not touched.

This runbook is an executable *procedure*, but steps involving Cloudflare writes are deliberately blocked until separate authorization and real Access test evidence exist. There is **no automatic deployment workflow** for this private app.

## A. Safe preparation now (no Cloudflare writes)

1. Keep all edits on the isolation branch. Never merge it into `main` to deploy. If private implementation history becomes necessary, copy into a separately authorized **private standalone** GitHub repository. This public fork cannot provide private source history.
2. In a clean checkout, with no `.env`, `.dev.vars`, `CF_ENV_FILE`, Cloudflare token, model API key or production R2/Upstash credentials present, run:

   ```bash
   bash scripts/private/offline-verify.sh
   ```

   This builds against `https://gitdiagram-private-qa.invalid`, a deliberately unroutable fixture. It runs the offline security checks, lint, typecheck, formatting check, dependency-boundary check, tests, OpenNext build and **Wrangler --dry-run** for the stub and all three isolated Worker configurations. It does not upload or provision anything. It must fail if a required check fails.

3. For an actual future hostname that has already been verified as controlled by the target account, render the intended production configs **without deploying**:

   ```bash
   PRIVATE_SITE_ORIGIN=https://YOUR-PROTECTED-HOST.example.org \
     bash scripts/private/offline-verify.sh
   ```

   The script refuses the original GitDiagram host, `workers.dev` / preview origins, local hosts, credentials and ambiguous URLs. The hostname above is a placeholder; do not deploy a placeholder. The generated configurations at the repository root are ignored by Git:

   - `.wrangler-private-server-generated.jsonc`
   - `.wrangler-private-server-local-generated.jsonc`
   - `.wrangler-private-generated.jsonc`

   The site URL is compiled via `NEXT_PUBLIC_SITE_ORIGIN`. **Use a clean build for each different host.** No actual hostname has been selected here.

4. Check the credential-free workflow on the isolated branch:
   [Private offline preflight](../.github/workflows/private-preflight.yml). It has `contents: read` permission, runs on GitHub-hosted CI, and receives **no Cloudflare deployment token, account ID, user token or secrets**. GitHub Actions completion is not Cloudflare deployment.

## B. Protected Access stub (future authorized infrastructure stage)

Do not start this section until Cloudflare resource/account authorization is explicitly provided. The goal is to validate the actual **Worker-level** Access policy while the real GitDiagram application is still absent.

1. Identify a private hostname inside a Cloudflare zone the owner controls, and the intended account. Verify that none of the target names or resources already belong to JARVIS or an unrelated service. Use newly created, isolated names, or stop if any collision exists.
2. Provision **only** the empty routing Worker named `andrew-gitdiagram-private` using `wrangler.private.stub.jsonc`, with `workers_dev=false`, `preview_urls=false`, and no public route. This stub returns **403 by default**, has no model, storage or GitHub API access, and no scheduled work. It serves a non-sensitive static fixture only after a verified owner identity.
3. Attach a **Worker-level Cloudflare Access application** to that exact Worker, allowing one exact owner email, not an email domain or every Cloudflare account member. Do not bypass Access with a broad rule. Protect static assets and all Worker URLs; avoid preview and `workers.dev` exposure.
4. Set these three private runtime values on the stub Worker using authorized secret storage (never GitHub, chat, shell history or log output):
   - `PRIVATE_ALLOWED_EMAIL`: the authenticated owner's exact email
   - `PRIVATE_ACCESS_AUD`: the Access application's actual audience tag
   - `PRIVATE_ACCESS_TEAM_DOMAIN`: the team's `<team>.cloudflareaccess.com` hostname

   The source gate additionally requires `PRIVATE_INSTANCE_ENABLED=1`. Without all the necessary values, it fails closed.
5. Attach the custom domain **to the stub only** after the Worker-level policy is attached. Inspect its exact routing/Access status in the actual Cloudflare dashboard or read-only API result. No source material or application code is deployed to that hostname in this stage.
6. Test the stub's two controlled surfaces in the browser:
   - Anonymous browser: `/`, `/__access-check`, and **the real static asset** `/access-proof.txt` must be redirected to Access or denied. No successful asset body is acceptable.
   - Signed-in exact owner: `/__access-check` returns `{"private":true,"authenticated":true,"mode":"access-stub"}`, and `/access-proof.txt` returns only the harmless test sentence.
   - Wrong identity, expired session, wrong audience, unknown alternate host, missing signing key or bad assertion: **denied**.
   - `/api/generate/stream` and `/mcp` do not function on the stub, even for the owner.
7. Run the **anonymous-only** read-only probe after the stub is available:

   ```bash
   node scripts/private/probe-anonymous.mjs \
     --origin https://YOUR-PROTECTED-HOST.example.org
   ```

   This is not part of offline CI because it contacts the protected hostname. It accepts only redirect/denial responses for known routes and the static fixture, never a 2xx or a misleading 404. It does **not** verify owner login, other hostname variants, storage, or runtime behavior. Those need separate checks and evidence.

**Stop condition:** if any unauthenticated request gets an asset, page, API response or diagram, do not upload GitDiagram. Repair the Access policy and repeat testing with the harmless stub only.

Official guidance: [Cloudflare Worker-level Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) · [Static-assets worker-first behavior](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) · [Access JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## C. Resource preparation after the stub passes (future authorized stage)

Keep everything separate from existing services. A dedicated new Cloudflare account is possible but not mandatory if isolated resources and permission boundaries are verified.

| Component | Proposed isolated resource | Non-negotiable check |
| --- | --- | --- |
| Routing Worker | `andrew-gitdiagram-private` | Existing protected stub, Worker-level owner-only Access retained through updates |
| Backend Workers | `andrew-gitdiagram-private-server`; `andrew-gitdiagram-private-server-local` | Internal service bindings only, no public hostname or preview |
| Next cache | `andrew-gitdiagram-private-next-cache` | Newly provisioned, not linked to public GitDiagram or JARVIS |
| Diagram artifacts | Two new R2 buckets for `R2_PUBLIC_BUCKET` and `R2_PRIVATE_BUCKET` | Despite the historical name `PUBLIC`, both buckets must have **no public r2.dev or custom-domain access** |
| Coordination | Dedicated Upstash Redis | Never reuse JARVIS or upstream rate-limit state |
| Models | Dedicated OpenAI API project/key | Limit source excerpts; no fallback to other paid providers; set an intentional spending ceiling |
| GitHub source reads | Narrow, read-only GitHub credential if private repositories are needed | Do not grant write or organization-wide permissions by default |
| Access | One owner-only Worker-level application | Verify policy, team issuer, audience, and JWT behavior on every reachable URL |

The new full-application config intentionally omits the paid explainer-video Containers and upstream scheduled tasks. It also blocks public MCP, browse, videos, analytics, sponsor endpoints, public preview artifacts and automatic IndexNow submission.

Do **not** supply the original deployment script `scripts/cf-deploy.sh` or its default `CF_ENV_FILE`: it contains upstream resource/account assumptions and can affect the real GitDiagram service.

## D. Application promotion, only after Access is proven (future authorized stage)

1. Verify the private config renderer, clean OpenNext build and all three Wrangler dry-runs again against the exact hostname. Check that every bound Worker and R2 cache name has the private prefix and that there are no original `gitdiagram` Worker targets, old account IDs, unprotected URLs or production credentials in build artifacts.
2. Provision and configure the two **internal-only** backend Workers first using the generated server/server-local configurations. They must have no `workers.dev` or preview entry point. Bind dedicated R2, Upstash and model credentials, with no secrets committed to source. **No app traffic is routed to them yet.**
3. Replace the verified protected stub using only the generated **private front** config. Confirm the same Worker-level Access application still covers the routing Worker before and immediately after activation. Do not create a second public front or Cloudflare edge Worker.
4. Do not rely on the upstream rollout script's version-override, container, cron, route-swap or account-default behavior. A future deployment script must validate account ID, Worker names, identity policy and source revision and fail closed if any field is missing or outside the isolated scope. This is an intentional implementation/authorization hold, not permission to use the upstream script.
5. If an internal service-binding request to the routing Worker is rejected due to missing Access context, **do not disable the gate globally or trust a caller-supplied header**. Investigate the exact cache-refresh or revalidation route and add a narrowly scoped cryptographically authenticated internal call only for that route, with regression tests. This remains a possible integration blocker until a genuine protected test is run.

## E. Required live acceptance test after promotion

These must be run on the actual protected host after deployment is separately authorized. Mark each as **not tested** until observed and recorded.

| Test | Pass condition |
| --- | --- |
| Anonymous HTML + real static JS/CSS/image + RSC | Redirected/denied; no private content visible |
| Anonymous direct APIs + `/mcp` + alternate hosts | Redirected/denied; no data, diagrams or generated responses |
| Different identity/expired session/invalid JWT | Denied at Access and/or in code |
| Exact owner access | Home, diagram editor, generation and reopen work |
| Private input repository | Only authorized GitHub files read; bounded excerpts sent to chosen OpenAI API |
| Output storage | New isolated non-public R2 buckets; no upstream/public previews, browse index or IndexNow |
| Availability | Generated diagram persists across refresh; cancel/limits/revalidation still work |
| App minimization | Videos, payments, sponsor/tracking, email, anonymous MCP and scheduled automations remain unavailable |
| Cost and secret exposure | Explicit caps and no keys in browser, logs, Git or rendered bundles |
| Independent system preservation | JARVIS and original GitDiagram Cloudflare resources, DNS, routes, queues and deployed versions unchanged |

**Release decision:** Only a successful recorded owner/anonymous Access test AND successful application QA qualify this installation for personal use. A successful build or a successful `--dry-run` alone is not a privacy proof.

## F. Current state and resume point

- **Built:** private authentication logic, signed-JWT fallback, isolated app configuration drafts, run-worker-first asset routing, deny-by-default Access stub, harmless static test fixture, optional anonymous test probe, source-level tests, credential-free CI and local Wrangler dry-run procedure.
- **Not built/deployed:** a private standalone repository, final selected custom hostname, Cloudflare Access policy, R2/Upstash resources, secrets, actual deployment script with account attestation, live private API/diagram behavior, access logs and production acceptance.
- **Resume point:** Reopen this runbook. The first authorized infrastructure action will be to provision **only the deny-by-default stub Worker**, with no private repository data or real GitDiagram code, and establish owner-only Access before attaching the private hostname.
