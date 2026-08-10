import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import { getCurrentUser, isAdmin } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "Rafiq",
  description:
    "Rafiq — one app for Collection and Remittance. Stage 1: shop and subscribe with your mobile wallet.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const admin = user ? await isAdmin(user.id) : false;

  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 dark:border-slate-800">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Rafiq
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/" className="hover:underline">
                Shop
              </Link>
              <Link href="/subscriptions" className="hover:underline">
                Plans
              </Link>
              {user && (
                <>
                  <Link href="/orders" className="hover:underline">
                    Orders
                  </Link>
                  <Link href="/wallets" className="hover:underline">
                    Wallets
                  </Link>
                </>
              )}
              {admin && (
                <Link href="/settings" className="hover:underline">
                  Configuration
                </Link>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <Link href="/cart" className="btn-ghost">
                Cart
              </Link>
              {user ? (
                <SignOutButton />
              ) : (
                <Link href="/login" className="btn-primary">
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-slate-500">
          Stage 1 — Collection. Payments run over the Collection gateway
          (Easypaisa · JazzCash).
        </footer>
      </body>
    </html>
  );
}
