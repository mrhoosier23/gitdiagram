import { PRIVATE_BUILD } from "~/lib/private-build";
import { getStarCount } from "~/server/github-stars";
import { HeaderClient } from "./header-client";

export function Header() {
  return (
    <HeaderClient
      starCount={PRIVATE_BUILD ? Promise.resolve(null) : getStarCount()}
    />
  );
}
