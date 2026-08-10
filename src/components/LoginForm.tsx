"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Mode = "password" | "signup" | "magic";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const supabase = getSupabaseBrowserClient();

    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setNotice({ tone: "info", text: "Check your email for a sign-in link." });
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setNotice({
          tone: "info",
          text: "Account created. Check your email to confirm it, then sign in.",
        });
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace(next);
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not sign in.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {mode !== "magic" && (
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy
          ? "Working…"
          : mode === "signup"
            ? "Create account"
            : mode === "magic"
              ? "Email me a link"
              : "Sign in"}
      </button>

      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
        {mode !== "password" && (
          <button type="button" className="hover:underline" onClick={() => setMode("password")}>
            Sign in with a password
          </button>
        )}
        {mode !== "signup" && (
          <button type="button" className="hover:underline" onClick={() => setMode("signup")}>
            Create an account
          </button>
        )}
        {mode !== "magic" && (
          <button type="button" className="hover:underline" onClick={() => setMode("magic")}>
            Email me a link instead
          </button>
        )}
      </div>
    </form>
  );
}
