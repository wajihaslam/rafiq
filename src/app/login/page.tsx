import { Suspense } from "react";

import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Rafiq</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use a password, or have a one-tap link emailed to you.
        </p>
      </div>
      <Suspense fallback={<div className="card h-64" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
