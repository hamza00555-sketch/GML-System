/**
 * Packages are cached by `<id>/<version>` — two different keys on purpose, so
 * a project holding 1.1.0 and a library offering 1.3.0 coexist without either
 * overwriting the other. A given version is downloaded once.
 */

export function cacheKey(id: string, version: string): string {
  return `${id}/${version}`;
}

export interface PackageCache {
  has(id: string, version: string): Promise<boolean>;
  /** Local root of the cached package, or null when absent. */
  path(id: string, version: string): Promise<string | null>;
  put(id: string, version: string, localPath: string): Promise<string>;
  evict(id: string, version?: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryPackageCache implements PackageCache {
  private readonly entries = new Map<string, string>();

  async has(id: string, version: string): Promise<boolean> {
    return this.entries.has(cacheKey(id, version));
  }

  async path(id: string, version: string): Promise<string | null> {
    return this.entries.get(cacheKey(id, version)) ?? null;
  }

  async put(id: string, version: string, localPath: string): Promise<string> {
    this.entries.set(cacheKey(id, version), localPath);
    return localPath;
  }

  async evict(id: string, version?: string): Promise<void> {
    if (version) {
      this.entries.delete(cacheKey(id, version));
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${id}/`)) this.entries.delete(key);
    }
  }

  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }
}
