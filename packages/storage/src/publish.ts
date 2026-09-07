import type { FolderFs } from "./fs.js";
import { fileSource } from "./transport/mount.js";
import type { AssetTransport } from "./transport/types.js";

/**
 * Publish writes exactly what a human would have created by hand: shape C,
 * one folder per asset inside the category folder, Preview.mp4 beside the
 * deliverables. Nothing else in the library is touched.
 *
 *   <Category>/<Name>/
 *     <deliverable>.mov …
 *     Preview.mp4
 */
export interface PublishInput {
  categoryFolder: string;
  /** Folder name; becomes the asset's display name. */
  name: string;
  deliverables: { localPath: string; fileName?: string }[];
  previewLocalPath: string;
}

export interface PublishProgress {
  file: string;
  done: number;
  total: number;
  index: number;
  count: number;
}

export function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
}

export async function publishAsset(
  fs: FolderFs,
  transport: AssetTransport,
  input: PublishInput,
  onProgress?: (p: PublishProgress) => void,
): Promise<{ relDir: string; files: string[] }> {
  if (!transport.putFile) throw new Error(`${transport.name} transport cannot write`);
  const folder = safeFolderName(input.name);
  if (!folder) throw new Error("asset name is empty");
  const relDir = `${input.categoryFolder}/${folder}`;

  const jobs = [
    ...input.deliverables.map((d) => ({ local: d.localPath, name: d.fileName ?? fs.basename(d.localPath) })),
    { local: input.previewLocalPath, name: "Preview.mp4" },
  ];
  const written: string[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const rel = `${relDir}/${job.name}`;
    await transport.putFile(rel, fileSource(fs, job.local), (done, total) =>
      onProgress?.({ file: job.name, done, total, index: i, count: jobs.length }),
    );
    written.push(rel);
  }
  return { relDir, files: written };
}
