import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_AUTH_COOKIE } from "./lib/admin-auth";

// Gates /admin pages and the /api/flagship endpoints those pages call --
// the API is admin-only (see route.ts comments, no public consumer), so
// leaving it unmatched would make the page-level gate cosmetic only.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  if (cookie && cookie === process.env.ADMIN_PASSWORD) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/flagship")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/flagship/:path*"],
};
