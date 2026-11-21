/**
 * A deliberately inert Worker to test Cloudflare Access before installing
 * GitDiagram. It performs no GitHub, storage, model, logging, or other API
 * calls. All traffic fails closed without the verified owner identity.
 */
import {
  privateResponseHeaders,
  rejectUnauthorizedPrivateRequest,
  type PrivateAccessContext,
  type PrivateInstanceEnv,
} from "../src/lib/private-instance";

interface Env extends PrivateInstanceEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, nosnippet",
};

export default {
  async fetch(request: Request, env: Env, ctx: PrivateAccessContext) {
    const blocked = await rejectUnauthorizedPrivateRequest(env, ctx, request);
    if (blocked) return blocked;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers });
    }
    const path = new URL(request.url).pathname;
    if (path === "/__access-check") {
      return Response.json(
        { private: true, authenticated: true, mode: "access-stub" },
        { headers },
      );
    }
    if (path === "/access-proof.txt") {
      return privateResponseHeaders(
        await env.ASSETS.fetch(request),
        true,
      );
    }
    return new Response("Not found", { status: 404, headers });
  },
};
