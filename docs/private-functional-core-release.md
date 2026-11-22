# Private GitDiagram functional core: deployed release

**Release date:** November 22, 2026, New York
**Protected site:** https://gitdiagram.awolverton.com
**Worker:** `andrew-gitdiagram-private` in the existing connected Cloudflare account
**Deployed version:** `3bd969ca-e829-451b-afda-0d42033a3f37`
**Deployment ID:** `6f48ddf7-5444-46a8-85a0-0f993989d3e8`
**Verified source commit:** `5b4dd74bf40c25c297bbe0012ad43ec555dabd2a`
**Successful CI:** https://github.com/mrhoosier23/gitdiagram/actions/runs/45042047581

## What was delivered

An owner-only, functioning *focused GitDiagram edition* implemented as a small Cloudflare Worker. It is deliberately **not a full deployment of the upstream Next.js/OpenNext GitDiagram application**. The original application's video generation, paid integrations, galleries, cross-device storage, MCP server, browsing index and administrative interfaces are not included.

Core user-facing flow:

1. Open the protected domain and sign in with the same Cloudflare Access identity used in the original stub tests.
2. Select **Key settings**, paste an existing OpenAI API key directly into that protected form, and save. **Do not paste keys into ChatGPT or GitHub.** The key is stored as an HttpOnly, Secure, SameSite=Strict cookie for six hours, never echoed to the browser.
3. Enter a public GitHub `owner/repository` or full GitHub URL; optionally save a narrowly scoped GitHub PAT through Key settings for repositories requiring it.
4. The server fetches a bounded file tree and up to nine eligible source files (a total of up to about 14,500 source characters), then calls OpenAI `gpt-5-mini` with a structured graph schema.
5. The owner explores an interactive SVG architecture map, follows source links to GitHub, copies or downloads Mermaid, exports JSON, and reopens up to ten maps stored **only in the same browser's localStorage**.

This does **not** send repository source to external analytics or a public gallery. The source excerpts selected for a run do go to OpenAI under the owner's chosen API key; no automatic repository processing occurs.

## Private/security architecture

- Cloudflare Access is attached to the **existing Worker resource** with exactly one owner-email Allow policy, not a domain-only or account-wide policy.
- `workers.dev` and preview URLs remain disabled, and the single custom domain still points to the protected Worker.
- The Worker independently verifies `ctx.access.aud` and the exact email claim for **every** route. Missing identity or configuration fails closed. The frontend has no static-asset bypass.
- Strict Content Security Policy with request-specific script/style nonces, no external JavaScript or CSS, noindex/no-store and security response headers.
- Same-origin checks on every mutating request, strict host checking, capped request bodies and Github/OpenAI response limits, no interpolation of source content as HTML.
- OpenAI and GitHub tokens are held in protected cookies rather than localStorage, source, logs or GitHub. They expire after six hours and can be cleared in the UI.
- GitHub remote requests are restricted to GitHub API; the only model provider request is to OpenAI. Error responses deliberately omit raw provider bodies and credentials.

## Strict separation and spending posture

- **No R2 or Redis bindings.** Two previously created backend Worker resources remain undeployed and unexposed; three previously created R2 buckets remain empty, private and unbound.
- No paid model project, top-up, purchase, automatic workflow, cron, container, analytics or additional DNS route was created.
- The owner's stated **$0 in NEW spending** is not a hard enforcement promise for OpenAI billing. Existing API credits can fund calls, but the app **cannot read the provider's credit balance or prevent auto-recharge** if that is enabled in the owner's API account. Generation is manual and bounded by request/response limits; no paid model call was made in automated tests.
- This browser-storage edition is designed to avoid the R2/Redis metering that prevented a zero-new-infrastructure-cost pilot. Cloudflare Worker execution still depends on the user's existing Cloudflare plan and its applicable limits.

## Verification and acceptance

**Passed automatically:**

- Isolated branch CI: 2,199 tests in 247 files; four original private Wrangler dry-runs; separate standalone Worker tests using mocked GitHub and OpenAI (no live credentials or external model calls); format, lint, typecheck and build.
- Cloudflare API readback: production Worker version above is live, its three named JS modules are downloadable, Access still covers the same Worker, one owner-only Access policy remains, and public/preview URLs are disabled.
- Baseline old harmless stub Access behavior was previously tested by the user in a signed-in and incognito browser. The policy and worker identity were retained during the upgrade.

**Still needs a real browser check by the owner:** Visit https://gitdiagram.awolverton.com and confirm the new "See the shape of your code" interface loads. Sign in if necessary. Save your existing OpenAI API key in **Key settings** and try a small public GitHub repository. Verify a diagram is generated, can be exported, and reopens under **Saved in this browser**. In an incognito window that is not signed in, verify Cloudflare Access still requires login. This external browser test and a live paid-credit model call were **not** performed autonomously from ChatGPT because its browser/network integration did not have access to the protected site.

## Rollback

Previous known-good harmless stub version: `66ebd9e9-114d-48cf-b01a-5860b6f05c83`. To recover from a confirmed production regression, send a version-only Cloudflare deployment of that old version at 100% to **the same Worker**. Do not alter Access, domain, JARVIS or the other Workers. Retain the release history and re-verify the existing owner-only policy after rollback.

## Scope and future enhancements

This release accomplishes the owner-only GitHub-to-architecture-diagram workflow with no external storage. It does **not** claim parity with every GitDiagram feature or guarantee an exact zero invoice. Better persistence/sync, large-repository analysis, and full OpenNext UI parity need separately tested storage/cost design and must not silently activate R2, Redis or paid infrastructure.
