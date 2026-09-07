/**
 * Converts a platform path into a file:// URL the panel's <img> and <video>
 * can load. CEP serves the panel from file:// itself, so this is the natural
 * transport for package media — no server, no copying.
 */
export function pathToFileUrl(absolutePath: string): string {
  let p = absolutePath.replace(/\\/g, "/");
  // "C:/x" → "/C:/x" so the URL becomes file:///C:/x
  if (/^[A-Za-z]:\//.test(p)) p = `/${p}`;
  // UNC "//server/share" → file://server/share
  if (p.startsWith("//")) return `file:${encodeURI(p)}`;
  return `file://${encodeURI(p)}`;
}
