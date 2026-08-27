"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { messageUser } from "@/app/u/actions";

/**
 * Opens a thread with someone. Nothing gates this — a cold message is allowed,
 * it just lands in the recipient's requests box rather than their primary one.
 */
export default function MessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await messageUser(userId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/inbox/${result.id}`);
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        onClick={open}
        disabled={pending}
        className="btn-ghost h-10 px-6 text-sm disabled:opacity-60"
      >
        {pending ? "Opening…" : "Message"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
