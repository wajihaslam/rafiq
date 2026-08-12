import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * `/subscriptions` is deliberately absent: the plans page is a shop window and
 * renders for signed-out visitors, swapping the subscribe control for a sign-in
 * link. The API routes behind it still require a user.
 */
const PROTECTED = ["/orders", "/wallets", "/pay", "/settings", "/logs"];

/**
 * Refreshes the Supabase session cookie on every request — Server Components
 * cannot write cookies, so this is the only place the refreshed token can be
 * persisted.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  /**
   * A missing NEXT_PUBLIC_* value used to throw here, and a throw in middleware
   * is a 500 on *every* path the matcher covers — one unset variable took the
   * whole site down with MIDDLEWARE_INVOCATION_FAILED, including pages that
   * need no session at all.
   *
   * Degrading is safe because middleware is not the access control: every
   * protected page and route calls `requireUser()`, which fails closed on its
   * own. Skipping the refresh costs a redirect, not a door left open.
   */
  let supabaseUrl: string;
  let supabaseKey: string;
  try {
    supabaseUrl = publicEnv.supabaseUrl();
    supabaseKey = publicEnv.supabasePublishableKey();
  } catch (error) {
    console.error("[middleware] Supabase env missing, skipping session refresh", error);
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
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

  // Same reasoning as above: an unreachable auth host must not 500 the site.
  // Treating the caller as signed out sends them to /login, which is the honest
  // answer when we cannot confirm a session — and `requireUser()` still guards
  // the data either way.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    console.error("[middleware] session refresh failed", error);
  }

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
    // Everything except static assets and the endpoints that outside systems
    // call: the gateway postback, the cron, and the webhook catcher. Those have
    // no session to refresh, and running this would only add a Supabase round
    // trip to a request that must stay cheap to be safe to hammer.
    "/((?!_next/static|_next/image|favicon.ico|api/collection/postback|api/cron|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
