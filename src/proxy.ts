import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

export async function proxy(req: NextRequest) {
  const token = req.cookies.get("guardrail_session")?.value;
  let authed = false;
  if (token) {
    try {
      await jwtVerify(token, secret);
      authed = true;
    } catch {
      authed = false;
    }
  }

  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/dashboard") && !authed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if ((pathname === "/login" || pathname === "/signup") && authed) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
