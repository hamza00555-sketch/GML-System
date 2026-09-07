/**
 * Grabs a frame from the preview and encodes it as PNG in the panel itself, so
 * no ffmpeg is involved. Seeks to ~15% of the duration, not frame 0 — frame 0
 * is often blank in a motion piece.
 */
export function extractPosterFromVideo(src: string, options: { fraction?: number; timeoutMs?: number; maxWidth?: number } = {}): Promise<Uint8Array> {
  const fraction = options.fraction ?? 0.15;
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxWidth = options.maxWidth ?? 640;

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`could not decode the preview within ${timeoutMs}ms`));
    }, timeoutMs);

    video.addEventListener("error", () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`preview did not decode (media error ${video.error?.code ?? "?"})`));
    });

    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.max(0, duration * fraction);
    });

    video.addEventListener("seeked", () => {
      try {
        const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          clearTimeout(timer);
          cleanup();
          if (!blob) return reject(new Error("PNG encode failed"));
          blob
            .arrayBuffer()
            .then((buf) => resolve(new Uint8Array(buf)))
            .catch(reject);
        }, "image/png");
      } catch (error) {
        clearTimeout(timer);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    video.src = src;
  });
}
