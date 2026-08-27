"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createReel, type Aspect } from "@/app/u/actions";

const MAX_BYTES = 500 * 1024 * 1024; // matches the bucket's file_size_limit

/**
 * Reads what the file already knows — its shape and its length — so nobody
 * has to hand-tag 16:9 vs 9:16. The aspect is what the board filters on, so
 * getting it from the pixels beats trusting a dropdown.
 *
 * Also grabs a frame for the poster, which is what the grid shows before
 * anyone presses play.
 */
function probe(file: File): Promise<{
  aspect: Aspect;
  durationSeconds: number | null;
  poster: Blob | null;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const give = (aspect: Aspect, durationSeconds: number | null, poster: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve({ aspect, durationSeconds, poster });
    };

    video.onerror = () => give("16:9", null, null);

    video.onloadedmetadata = () => {
      const aspect: Aspect =
        video.videoHeight > video.videoWidth ? "9:16" : "16:9";
      const durationSeconds = Number.isFinite(video.duration)
        ? Math.round(video.duration)
        : null;

      // A frame a second in is usually past the fade from black.
      video.currentTime = Math.min(1, (video.duration || 1) / 2);

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return give(aspect, durationSeconds, null);
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(
            (blob) => give(aspect, durationSeconds, blob),
            "image/jpeg",
            0.8
          );
        } catch {
          give(aspect, durationSeconds, null);
        }
      };
    };

    video.src = url;
  });
}

export default function ReelUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<null | "reading" | "uploading" | "saving">(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== null;

  async function handleFile(file: File) {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError("That file is over 500MB. Export it smaller and try again.");
      return;
    }

    const supabase = createClient();

    setStage("reading");
    const { aspect, durationSeconds, poster } = await probe(file);

    setStage("uploading");
    const stamp = Date.now();
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    // Storage policies pin writes to a folder named for the uploader's uid.
    const videoPath = `${userId}/${stamp}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("reels")
      .upload(videoPath, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setStage(null);
      setError(upErr.message);
      return;
    }

    const videoUrl = supabase.storage.from("reels").getPublicUrl(videoPath)
      .data.publicUrl;

    let posterUrl: string | null = null;
    if (poster) {
      const posterPath = `${userId}/${stamp}-poster.jpg`;
      const { error: posterErr } = await supabase.storage
        .from("reels")
        .upload(posterPath, poster, { contentType: "image/jpeg", upsert: false });
      if (!posterErr) {
        posterUrl = supabase.storage.from("reels").getPublicUrl(posterPath)
          .data.publicUrl;
      }
    }

    setStage("saving");
    const result = await createReel({
      videoUrl,
      posterUrl,
      caption,
      aspect,
      durationSeconds,
    });
    setStage(null);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setCaption("");
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="border border-line bg-rack p-4">
      <p className="label">Add work</p>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
        className="mt-3 block w-full text-sm text-crew file:mr-3 file:border file:border-line file:bg-rack-2 file:px-4 file:py-2 file:text-sm file:font-medium file:text-key hover:file:border-crew disabled:opacity-60"
      />

      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        disabled={busy}
        placeholder="Caption (optional)"
        className="mt-3 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal disabled:opacity-60"
      />

      <p className="meta mt-3">
        {stage === "reading"
          ? "Reading the file…"
          : stage === "uploading"
            ? "Uploading…"
            : stage === "saving"
              ? "Saving…"
              : "MP4, MOV or WebM · up to 500MB · shape and length read automatically"}
      </p>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
