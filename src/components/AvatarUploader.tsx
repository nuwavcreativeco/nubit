"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveAvatar } from "@/app/u/actions";
import { humanSize, uploadWithProgress } from "@/lib/upload";

const MAX_BYTES = 5 * 1024 * 1024; // matches the avatars bucket limit

export default function AvatarUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(`That's ${humanSize(file.size)}. Pictures need to be under 5 MB.`);
      return;
    }

    setBusy(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const uploaded = await uploadWithProgress({
      bucket: "avatars",
      path: `${userId}/${Date.now()}.${ext}`,
      file,
    });

    if ("cancelled" in uploaded) {
      setBusy(false);
      return;
    }
    if ("error" in uploaded) {
      setBusy(false);
      setError(uploaded.error);
      return;
    }

    const result = await saveAvatar(uploaded.url);
    setBusy(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="text-xs text-crew underline transition hover:text-signal disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Change picture"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
