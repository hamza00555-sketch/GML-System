import { createHash } from "node:crypto";
import { MANIFEST_EXCLUDED, type AssetFile, type AssetManifest } from "@gml/core";

/**
 * SHA-256 is the primary local integrity check; MD5 exists because Drive can
 * only give us md5Checksum back for files stored in a Shared Drive.
 */
export function digestsOf(data: Uint8Array): AssetFile {
  return {
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    md5: createHash("md5").update(data).digest("hex"),
  };
}

export interface PackageEntry {
  /** Package-relative path with forward slashes, e.g. "footage/logo.ai". */
  path: string;
  data: Uint8Array;
}

/**
 * Builds the manifest for a package. `meta.json` is skipped by construction:
 * it carries the manifest, so it cannot describe itself.
 */
export function buildManifest(entries: Iterable<PackageEntry>): AssetManifest {
  const manifest: AssetManifest = {};
  for (const entry of entries) {
    if (entry.path === MANIFEST_EXCLUDED) continue;
    manifest[entry.path] = digestsOf(entry.data);
  }
  return manifest;
}

/** Re-checks a downloaded package against its manifest. Returns problems found. */
export function verifyPackage(
  manifest: AssetManifest,
  entries: Iterable<PackageEntry>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.path === MANIFEST_EXCLUDED) continue;
    seen.add(entry.path);
    const expected = manifest[entry.path];
    if (!expected) {
      problems.push(`unexpected file: ${entry.path}`);
      continue;
    }
    const actual = digestsOf(entry.data);
    if (actual.bytes !== expected.bytes) problems.push(`size mismatch: ${entry.path}`);
    if (actual.sha256 !== expected.sha256) problems.push(`sha256 mismatch: ${entry.path}`);
  }

  for (const path of Object.keys(manifest)) {
    if (!seen.has(path)) problems.push(`missing file: ${path}`);
  }

  return problems;
}
