/**
 * Traceability stamp written to an AE layer / footage item `comment` and read
 * back to detect reuse, pin cached files, and spot version drift. Also the
 * value carried by the Illustrator GML_ID / GML_VERSION tags.
 *
 *   gml:transitions/arrows@v3
 */

const STAMP_RE = /^gml:([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)@v(\d+)$/;

export interface Stamp {
  id: string;
  version: number;
}

export function encodeStamp(id: string, version: number): string {
  return `gml:${id}@v${version}`;
}

export function decodeStamp(value: string | null | undefined): Stamp | null {
  if (!value) return null;
  const m = STAMP_RE.exec(value.trim());
  if (!m) return null;
  return { id: m[1] as string, version: Number(m[2]) };
}

/**
 * A comment may carry a stamp alongside the designer's own note, so scan
 * rather than requiring the whole string to be a stamp.
 */
export function findStamp(comment: string | null | undefined): Stamp | null {
  if (!comment) return null;
  for (const token of comment.split(/\s+/)) {
    const stamp = decodeStamp(token);
    if (stamp) return stamp;
  }
  return null;
}

export function stampsMatch(a: Stamp, b: Stamp): boolean {
  return a.id === b.id && a.version === b.version;
}
