/**
 * The hosted private instance sets NEXT_PUBLIC_SITE_ORIGIN at build time.
 * Public upstream behavior remains unchanged when the override is absent.
 * This is a public configuration value (NOT a secret).
 */
const customOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim();

export const SITE_URL = customOrigin
  ? new URL(customOrigin).origin
  : "https://gitdiagram.com";

export const GITHUB_REPO_URL =
  "https://github.com/ahmedkhaleel2004/gitdiagram";
