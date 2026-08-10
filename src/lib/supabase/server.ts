import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { publicEnv, serverEnv } from "@/lib/env";

/** Request-scoped client that carries the signed-in user, so RLS applies. */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0]) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are readonly.
          // Session refresh is handled by middleware, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Secret-key client. Bypasses RLS — use only where there is no user session
 * (gateway postbacks, the subscription cron) or where the write must be
 * trusted (minting a token, marking an order paid). Never return its results
 * to a client without filtering by user_id yourself.
 */
export function getSupabaseAdminClient() {
  return createClient(publicEnv.supabaseUrl(), serverEnv.supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getCurrentUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

/** True for a profile flagged `is_admin`. Read with the secret key so the
 *  answer does not depend on the caller being able to see their own row. */
export async function isAdmin(userId: string) {
  const { data } = await getSupabaseAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

/** Gate for the gateway configuration screen and its write endpoint. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) throw new Error("FORBIDDEN");
  return user;
}
