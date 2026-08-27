import { createClient } from "@/lib/supabase/client";

/**
 * Uploads a file to Storage and reports progress.
 *
 * The supabase-js storage client posts through `fetch`, which cannot report
 * upload progress — there is no `onUploadProgress` in storage-js 2.x. A reel
 * can be 500MB, and a spinner that sits still for four minutes reads as a
 * broken app; people refresh, retry, and end up with duplicates. So this
 * talks to the same Storage endpoint over XMLHttpRequest, which does emit
 * `upload.onprogress`, using the session's own access token.
 *
 * Returns the public URL, or an error message. Aborting resolves as
 * `{ cancelled: true }` rather than throwing.
 */
export type UploadResult =
  | { url: string }
  | { error: string }
  | { cancelled: true };

export async function uploadWithProgress({
  bucket,
  path,
  file,
  onProgress,
  signal,
}: {
  bucket: string;
  path: string;
  file: File | Blob;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { error: "Your session expired. Sign in again and retry." };
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anonKey) return { error: "Supabase isn't configured." };

  const endpoint = `${base}/storage/v1/object/${bucket}/${path}`;

  // Mirror what storage-js does for a Blob or File: multipart, with the file
  // under the empty-string field name and cacheControl alongside it. The
  // Storage API also accepts a raw body, but only on the path the library
  // uses for streams — matching the browser path exactly means this behaves
  // identically to a working `.upload()` call, minus the missing progress.
  //
  // Content-Type is deliberately not set: the browser has to write the
  // multipart boundary itself.
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);

  const outcome = await new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        resolve({ url: data.publicUrl });
        return;
      }
      // Storage answers with a JSON body; fall back to the status line.
      // 413 is the plan cap, and Storage's own wording for it explains
      // nothing, so keep ours rather than letting the body overwrite it.
      if (xhr.status === 413) {
        resolve({
          error:
            "The server rejected this file as too large. Supabase caps " +
            "uploads by plan — Free is 50 MB — and that cap overrides the " +
            "bucket's own limit. Export smaller, or raise the plan.",
        });
        return;
      }

      let message = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText) as {
          message?: string;
          error?: string;
        };
        message = body.message || body.error || message;
      } catch {
        // keep the status-line message
      }
      resolve({ error: message });
    };

    xhr.onerror = () =>
      resolve({ error: "The connection dropped during the upload." });
    xhr.ontimeout = () => resolve({ error: "The upload timed out." });
    xhr.onabort = () => resolve({ cancelled: true });

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(body);
  });

  return outcome;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
