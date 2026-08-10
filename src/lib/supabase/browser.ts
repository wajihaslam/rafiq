"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  cached ??= createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey());
  return cached;
}
