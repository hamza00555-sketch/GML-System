/**
 * `id` identifies a library entry. `id@version` identifies a cached package
 * and an imported comp. They are deliberately different keys — a project may
 * legitimately hold two versions of the same asset side by side.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(v: string): Semver {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`invalid semver: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Returns <0 if a is older, 0 if equal, >0 if a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

export type VersionRelation = "same" | "library-newer" | "project-newer";

export function relateVersions(inProject: string, inLibrary: string): VersionRelation {
  const cmp = compareVersions(inLibrary, inProject);
  if (cmp === 0) return "same";
  return cmp > 0 ? "library-newer" : "project-newer";
}

export type VersionChoice = "use-existing" | "import-newer-separately";

export interface VersionDecision {
  relation: VersionRelation;
  /** True only when the user must be told before anything is applied. */
  requiresWarning: boolean;
  choices: VersionChoice[];
}

/**
 * A newer library version never replaces what a project already uses without
 * the user saying so. The MVP surfaces the difference and offers the two
 * non-destructive options; "update/replace" is left for later and needs no
 * architectural change to add.
 */
export function decideVersionAction(
  inProject: string,
  inLibrary: string,
): VersionDecision {
  const relation = relateVersions(inProject, inLibrary);
  if (relation === "same") {
    return { relation, requiresWarning: false, choices: ["use-existing"] };
  }
  return {
    relation,
    requiresWarning: true,
    choices: ["use-existing", "import-newer-separately"],
  };
}

/** Comp name for a version imported alongside one already in the project. */
export function versionedCompName(compName: string, version: string): string {
  return `${compName}_v${version}`;
}
