import type { FolderFs } from "./fs.js";

/**
 * The inbox: a drop folder inside the library where ready-made assets can be
 * placed straight from Drive, on any machine, without the panel. Each
 * subfolder holds one asset's raw files; the After Effects panel turns them
 * into verified packages, because only AE can read which comps a project
 * holds. Readers never look here.
 *
 *   GML_Library/_inbox/<anything>/
 *     something.aep          the project (exactly one)
 *     preview.mp4            H.264 preview (exactly one .mp4)
 *     poster.png             optional — extracted from the preview when absent
 *     asset.json             optional defaults: compName, nameEn, nameAr, id,
 *                            version, category, tags, description, status
 */
export const INBOX_DIR = "_inbox";

export interface InboxDefaults {
  compName?: string;
  id?: string;
  version?: string;
  nameEn?: string;
  nameAr?: string;
  description?: string;
  category?: string;
  tags?: string[];
  status?: "draft" | "approved";
}

export interface InboxItem {
  /** Folder name — the default asset name. */
  name: string;
  folder: string;
  aep: string | null;
  preview: string | null;
  poster: string | null;
  defaults: InboxDefaults;
  /** Why this item cannot be imported as it stands. */
  problems: string[];
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function listInbox(fs: FolderFs, root: string): InboxItem[] {
  const inbox = fs.join(root, INBOX_DIR);
  if (!fs.exists(inbox)) return [];

  const items: InboxItem[] = [];
  for (const entry of fs.readdir(inbox).sort()) {
    const folder = fs.join(inbox, entry);
    let isDir = false;
    try {
      isDir = fs.stat(folder).isDirectory;
    } catch {
      isDir = false;
    }
    if (!isDir || entry.startsWith(".") || entry.startsWith("_")) continue;

    const files = fs.readdir(folder).filter((f) => !f.startsWith("."));
    const byExt = (e: string) => files.filter((f) => ext(f) === e);
    const aeps = byExt("aep");
    const mp4s = byExt("mp4");
    const pngs = byExt("png");

    const problems: string[] = [];
    if (aeps.length === 0) problems.push("no .aep file");
    if (aeps.length > 1) problems.push(`${aeps.length} .aep files — keep one`);
    if (mp4s.length === 0) problems.push("no .mp4 preview");
    if (mp4s.length > 1) problems.push(`${mp4s.length} .mp4 files — keep one`);
    if (pngs.length > 1) problems.push(`${pngs.length} .png files — keep one`);

    let defaults: InboxDefaults = {};
    if (files.includes("asset.json")) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(fs.readFile(fs.join(folder, "asset.json")))) as unknown;
        if (parsed && typeof parsed === "object") defaults = parsed as InboxDefaults;
      } catch (error) {
        problems.push(`asset.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    items.push({
      name: entry,
      folder,
      aep: aeps.length === 1 ? fs.join(folder, aeps[0]!) : null,
      preview: mp4s.length === 1 ? fs.join(folder, mp4s[0]!) : null,
      poster: pngs.length === 1 ? fs.join(folder, pngs[0]!) : null,
      defaults,
      problems,
    });
  }
  return items;
}

/** After a successful import the raw files live on in the package, so the drop folder goes. */
export function removeInboxItem(fs: FolderFs, item: InboxItem): void {
  if (fs.exists(item.folder)) fs.rm(item.folder);
}
