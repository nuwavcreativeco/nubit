"use client";

import Link from "next/link";
import { useState } from "react";
import { signUp } from "@/app/auth/actions";

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setMessage(null);
    setPending(true);
    const result = await signUp(formData);
    setPending(false);
    if (result?.error) setError(result.error);
    if (result?.message) setMessage(result.message);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
      <h1 className="font-display text-3xl">Create an account</h1>
      <p className="mt-2 text-ink-dim">
        Already have one?{" "}
        <Link href="/auth/sign-in" className="text-brass underline">
          Sign in
        </Link>
        .
      </p>

      <form action={handleSubmit} className="mt-8 flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">I&apos;m a...</legend>
          <div className="flex gap-4">
            <label className="flex flex-1 items-center gap-2 rounded-md border border-line bg-canvas-raised px-3 py-2 has-[:checked]:border-brass">
              <input type="radio" name="role" value="videographer" required />
              Videographer
            </label>
            <label className="flex flex-1 items-center gap-2 rounded-md border border-line bg-canvas-raised px-3 py-2 has-[:checked]:border-teal">
              <input type="radio" name="role" value="bidder" required />
              Bidder
            </label>
          </div>
        </fieldset>

        <label className="flex flex-col gap-2 text-sm">
          Display name
          <input
            name="display_name"
            required
            placeholder="Jordan Reyes"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          City (optional)
          <input
            name="city"
            placeholder="Seattle"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Password
          <input
            type="password"
            name="password"
            required
            minLength={6}
            placeholder="At least 6 characters"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-teal">{message}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-brass px-5 py-3 text-sm font-medium text-canvas transition hover:bg-brass-dim disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
