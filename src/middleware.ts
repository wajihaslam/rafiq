import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

const PROTECTED = ["/cart", "/checkout", "/orders", "/wallets", "/subscriptions"];

/**
 * Refreshes the Supabase session cookie on every request — Server Components
 * cannot write cookies, so this is the only place the refreshed token can be
 * persisted.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0]) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && PROTECTED.some((p) => pathname.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets and the gateway-facing postback
    "/((?!_next/static|_next/image|favicon.ico|api/collection/postback|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
