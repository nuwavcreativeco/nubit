"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "@/app/auth/actions";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await signIn(formData);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
      <h1 className="text-3xl tracking-tight">Sign in</h1>
      <p className="mt-2 text-crew">
        New here?{" "}
        <Link href="/auth/sign-up" className="text-signal underline">
          Create an account
        </Link>
        .
      </p>

      <form action={handleSubmit} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="border border-line bg-rack px-3 py-2 text-key outline-none focus:border-signal"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Password
          <input
            type="password"
            name="password"
            required
            className="border border-line bg-rack px-3 py-2 text-key outline-none focus:border-signal"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 bg-signal px-5 py-3 text-sm font-medium text-stage transition hover:bg-signal-dim disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
