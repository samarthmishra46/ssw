import { NextResponse, type NextRequest } from "next/server";
import { centreProgrammes, DEFAULT_CENTRE } from "@ssw/content";

/**
 * Only real pages are served; any other address goes to the default centre page (/ahmedabad),
 * keeping the query string so ad tracking (utm_*, fbclid, gclid) survives the redirect.
 * 307 (temporary): addresses for other cities will become real pages later.
 */
const OTHER_PAGES = new Set(["/privacy", "/terms", "/refund-policy", "/contact"]);

function isKnownPage(path: string): boolean {
  if (OTHER_PAGES.has(path)) return true;
  if (/^\/booking\/[^/]+$/.test(path)) return true; // personal booking page from the confirmation
  const [centre, programme, ...rest] = path.split("/").filter(Boolean);
  if (!centre || rest.length > 0) return false;
  const list = centreProgrammes[centre];
  if (!list) return false;
  return programme === undefined || list.includes(programme);
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (isKnownPage(path)) return NextResponse.next();
  const to = req.nextUrl.clone();
  to.pathname = `/${DEFAULT_CENTRE}`;
  return NextResponse.redirect(to, 307);
}

export const config = {
  // Pages only: not the API, Next's own files, or anything with a file extension (images, icons).
  matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
