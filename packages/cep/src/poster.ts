/**
 * Grabs a frame from the preview and encodes it as PNG in the panel itself, so
 * a poster never has to be rendered separately. Works wherever H.264 decodes
 * (Spike E); when it does not, the designer supplies a PNG instead.
 */
export function extractPosterFromVideo(
  src: string,
  atSeconds = 0.5,
  timeoutMs = 10000,
): Promise<Uint8Array> {
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
      const at = Math.min(atSeconds, Math.max(0, (video.duration || 1) / 2));
      video.currentTime = at;
    });

    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        ctx.drawImage(video, 0, 0);
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
