"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createReel } from "@/app/u/actions";
import type { Aspect } from "@/lib/types";
import { humanSize, uploadWithProgress } from "@/lib/upload";

/**
 * Supabase caps uploads globally by plan, and that global cap overrides any
 * per-bucket limit. On Free it is 50MB, full stop. The bucket used to say
 * 500MB, so the app accepted a real reel, spent minutes uploading it, and
 * Storage rejected it at the end — which reads as "uploads are broken".
 *
 * Raise NEXT_PUBLIC_MAX_UPLOAD_MB (and the bucket, and the project's Storage
 * setting) together after moving to Pro.
 */
const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50);
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type Probe = {
  ok: boolean;
  aspect: Aspect;
  durationSeconds: number | null;
  poster: Blob | null;
};

/**
 * Reads what the file already knows — its shape and its length — so nobody
 * has to hand-tag 16:9 vs 9:16. The aspect is what the board filters on, so
 * getting it from the pixels beats trusting a dropdown.
 *
 * Browsers disagree about codecs, though: plenty of camera MOVs (ProRes,
 * HEVC in some builds) will not decode in a <video> element even though the
 * file is perfectly good. When that happens `ok` comes back false and the UI
 * asks the person for the shape instead of silently guessing 16:9 and
 * shipping a reel with the wrong filter tag and no poster.
 */
function probe(file: File): Promise<Probe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const give = (result: Probe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const failed: Probe = {
      ok: false,
      aspect: "16:9",
      durationSeconds: null,
      poster: null,
    };

    // A file the browser cannot decode often just never fires an event.
    const timer = setTimeout(() => give(failed), 15_000);

    video.onerror = () => give(failed);

    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) return give(failed);

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
          if (!ctx) return give({ ok: true, aspect, durationSeconds, poster: null });
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(
            (poster) => give({ ok: true, aspect, durationSeconds, poster }),
            "image/jpeg",
            0.8
          );
        } catch {
          // A tainted or oversized canvas costs us the poster, not the reel.
          give({ ok: true, aspect, durationSeconds, poster: null });
        }
      };
    };

    video.src = url;
  });
}

export default function ReelUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [stage, setStage] = useState<null | "reading" | "uploading" | "saving">(null);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set only when the browser could not read the file itself.
  const [manualAspect, setManualAspect] = useState<Aspect | null>(null);

  const busy = stage !== null;

  function reset() {
    setStage(null);
    setProgress(0);
    setFile(null);
    setCaption("");
    setManualAspect(null);
    abortRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(picked: File, aspectOverride?: Aspect) {
    setError(null);
    setNotice(null);

    if (picked.size > MAX_BYTES) {
      setError(
        `That file is ${humanSize(picked.size)}, over the ${MAX_UPLOAD_MB} MB limit. ` +
          `Export it as H.264 MP4 at 1080p — a minute of reel usually lands ` +
          `between 10 and 25 MB.`
      );
      return;
    }

    setFile(picked);

    let aspect: Aspect;
    let durationSeconds: number | null = null;
    let poster: Blob | null = null;

    if (aspectOverride) {
      aspect = aspectOverride;
    } else {
      setStage("reading");
      const probed = await probe(picked);

      if (!probed.ok) {
        // Stop and ask rather than tagging it 16:9 and hoping.
        setStage(null);
        setManualAspect("16:9");
        setNotice(
          "This browser couldn't read the video — often a camera codec like ProRes. The file will still upload; just tell us its shape."
        );
        return;
      }

      aspect = probed.aspect;
      durationSeconds = probed.durationSeconds;
      poster = probed.poster;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setStage("uploading");
    setProgress(0);

    const stamp = Date.now();
    const ext = picked.name.split(".").pop()?.toLowerCase() || "mp4";
    // Storage policies pin writes to a folder named for the uploader's uid.
    const videoPath = `${userId}/${stamp}.${ext}`;

    const uploaded = await uploadWithProgress({
      bucket: "reels",
      path: videoPath,
      file: picked,
      onProgress: setProgress,
      signal: controller.signal,
    });

    if ("cancelled" in uploaded) {
      reset();
      setNotice("Upload cancelled.");
      return;
    }
    if ("error" in uploaded) {
      setStage(null);
      setError(uploaded.error);
      return;
    }

    let posterUrl: string | null = null;
    if (poster) {
      const posterUp = await uploadWithProgress({
        bucket: "reels",
        path: `${userId}/${stamp}-poster.jpg`,
        file: poster,
      });
      if ("url" in posterUp) posterUrl = posterUp.url;
      // A missing poster is cosmetic — the grid falls back to a placeholder.
    }

    setStage("saving");
    const result = await createReel({
      videoUrl: uploaded.url,
      posterUrl,
      caption,
      aspect,
      durationSeconds,
    });

    if ("error" in result) {
      setStage(null);
      setError(result.error);
      return;
    }

    reset();
    setNotice("Added to your grid.");
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
          const picked = e.target.files?.[0];
          if (picked) void handleFile(picked);
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

      {/* The codec fallback: the file is fine, the browser just can't read it. */}
      {manualAspect && file && !busy && (
        <div className="mt-3 border border-line bg-rack-2 p-3">
          <p className="label">What shape is it?</p>
          <div className="mt-2 flex gap-px bg-line">
            {(["16:9", "9:16"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setManualAspect(option)}
                className={`px-4 py-1.5 text-sm transition ${
                  manualAspect === option
                    ? "bg-rack font-medium text-key"
                    : "bg-rack-2 text-crew hover:text-key"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            onClick={() => void handleFile(file, manualAspect)}
            className="btn-signal mt-3 h-9 px-5 text-sm"
          >
            Upload as {manualAspect}
          </button>
        </div>
      )}

      {/* Progress. A 500MB reel needs a number, not a spinner. */}
      {stage === "uploading" && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="meta">
              Uploading{file ? ` · ${humanSize(file.size)}` : ""}
            </span>
            <span className="fig text-sm text-signal">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1 w-full bg-line">
            <div
              className="h-full bg-signal transition-[width] duration-200"
              style={{ width: `${Math.max(2, progress * 100)}%` }}
            />
          </div>
          <button
            onClick={() => abortRef.current?.abort()}
            className="meta mt-2 text-crew underline transition hover:text-key"
          >
            Cancel
          </button>
        </div>
      )}

      {stage !== "uploading" && (
        <p className="meta mt-3">
          {stage === "reading"
            ? "Reading the file…"
            : stage === "saving"
              ? "Saving…"
              : `MP4, MOV or WebM · up to ${MAX_UPLOAD_MB} MB · shape and length read automatically`}
        </p>
      )}

      {notice && <p className="mt-2 text-sm text-crew">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
