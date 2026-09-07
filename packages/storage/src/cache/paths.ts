/**
 * Where the local cache lives. Never a synced folder: not Documents, not
 * Desktop, not %APPDATA% (roaming profiles sync). The user may relocate it to
 * a scratch SSD; the relative structure underneath is identical on every
 * machine, which is what lets an AE project move between colleagues.
 */
export interface CacheEnv {
  platform: string;
  homedir: string;
  env: Record<string, string | undefined>;
}

export function defaultCacheRoot({ platform, homedir, env }: CacheEnv, join: (...p: string[]) => string): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(homedir, "AppData", "Local");
    return join(local, "GML");
  }
  if (platform === "darwin") return join(homedir, "Library", "Application Support", "GML");
  return join(env.XDG_CACHE_HOME ?? join(homedir, ".cache"), "gml");
}

export const CACHE_LAYOUT = {
  auth: "auth",
  posters: "posters",
  previews: "previews",
  assets: "assets",
  index: "index.json",
  usage: "usage.json",
  pins: "pins.json",
  driveIds: "drive-ids.json",
} as const;

/** Folders whose contents sync elsewhere; a cache there would double every download. */
export function looksSynced(path: string): string | null {
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (/\/(onedrive|dropbox|google drive|googledrive|icloud|cloudstorage)\b/.test(p)) return "a cloud-synced folder";
  if (/\/(desktop|documents)(\/|$)/.test(p)) return "Desktop or Documents, which roaming profiles sync";
  if (/\/appdata\/roaming(\/|$)/.test(p)) return "the roaming profile";
  if (/^[a-z]:\/shared drives(\/|$)/.test(p) || /\/shared drives(\/|$)/.test(p)) return "the Shared Drive itself";
  return null;
}
