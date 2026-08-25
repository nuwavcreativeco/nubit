"use client";

import { useState } from "react";
import { createSlot } from "@/app/slots/actions";

export default function NewSlotPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await createSlot(formData);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      <h1 className="font-display text-3xl">Post a slot</h1>
      <p className="mt-2 text-ink-dim">
        Set the floor. Creators bid it up from there.
      </p>

      <form action={handleSubmit} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-sm">
          Title
          <input
            name="title"
            required
            placeholder="Half-day product shoot, Ballard studio"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Shoot date
            <input
              type="date"
              name="shoot_date"
              required
              className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
            />
          </label>
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Floor rate (USD)
            <input
              type="number"
              name="floor_rate"
              min="1"
              step="1"
              required
              placeholder="400"
              className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
            />
          </label>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          Location
          <input
            name="location"
            required
            placeholder="Ballard, Seattle"
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Details (optional)
          <textarea
            name="description"
            rows={4}
            placeholder="What the shoot needs, gear on site, anything a bidder should know."
            className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-brass"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-brass px-5 py-3 text-sm font-medium text-canvas transition hover:bg-brass-dim disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post slot"}
        </button>
      </form>
    </main>
  );
}
