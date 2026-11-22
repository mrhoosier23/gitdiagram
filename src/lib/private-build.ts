/**
 * Build-time flag for the owner-only UI, not an authentication mechanism.
 * Cloudflare Access and server-side verification protect actual requests.
 */
export const PRIVATE_BUILD = process.env.NEXT_PUBLIC_PRIVATE_INSTANCE === "1";
