import type { Page } from "@playwright/test";

/**
 * Records a short, genuinely decodable clip inside the browser.
 *
 * There is no ffmpeg here and a hand-rolled MP4 byte blob would be a liability
 * — if it were subtly malformed the upload spec would fail for a reason that
 * has nothing to do with the app. Canvas + MediaRecorder gives a real file the
 * browser can also read back, which matters because the uploader's probe
 * decodes the video to work out its aspect and grab a poster frame.
 *
 * `portrait` produces a 9:16 clip, which is what proves the aspect really
 * comes from the pixels rather than a default.
 */
export async function recordClip(
  page: Page,
  { portrait = false, ms = 1200 }: { portrait?: boolean; ms?: number } = {}
): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  const width = portrait ? 270 : 480;
  const height = portrait ? 480 : 270;

  const base64 = await page.evaluate(
    async ({ width, height, ms }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;

      const stream = canvas.captureStream(25);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };

      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      recorder.start();

      // Draw something that actually changes, so the encoder emits frames
      // rather than collapsing the whole clip into one keyframe.
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const draw = () => {
          const t = performance.now() - started;
          ctx.fillStyle = `hsl(${(t / 8) % 360} 80% 45%)`;
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "#fff";
          ctx.fillRect(20, 20, 40 + ((t / 20) % 60), 30);
          if (t < ms) requestAnimationFrame(draw);
          else resolve();
        };
        draw();
      });

      recorder.stop();
      await done;

      const blob = new Blob(chunks, { type: "video/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height, ms }
  );

  return {
    buffer: Buffer.from(base64, "base64"),
    name: portrait ? "vertical-clip.webm" : "landscape-clip.webm",
    mimeType: "video/webm",
  };
}
