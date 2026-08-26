/**
 * What the ExtendScript layer reports back about the project. Keeping this a
 * plain data snapshot is what lets every rule below be tested without opening
 * After Effects.
 */

export type SourceKind = "file" | "solid" | "placeholder";

export interface FootageSnapshot {
  itemId: number;
  name: string;
  sourceKind: SourceKind;
  /** Platform path (`File.fsName`). Absent for solids and placeholders. */
  filePath?: string;
  /** Non-empty when After Effects has lost the file. */
  missingFootagePath?: string;
  /** `FootageSource.isStill` — false merely means "has a time component". */
  isStill: boolean;
  /** From `AVItem`, not `FootageSource`, which has no such property. */
  hasVideo: boolean;
  hasAudio: boolean;
  hasProxy: boolean;
  /** File names beside this one, used to confirm a real numbering pattern. */
  siblingNames?: string[];
}

export interface ProjectSnapshot {
  /** Null when the project has never been saved. */
  projectPath: string | null;
  projectDirty: boolean;
  /** The comp being published. */
  compName: string;
  /** Every comp name in the project, to catch duplicates. */
  compNames: string[];
  aeVersion: string;
  footage: FootageSnapshot[];
  /** PostScript names collected from text layers. */
  fonts: string[];
  /** Effect matchNames found on layers; non-"ADBE " prefixes are third party. */
  effectMatchNames: string[];
}

export type Severity = "blocker" | "warning";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  detail?: string;
}

export interface PreflightReport {
  ok: boolean;
  blockers: Finding[];
  warnings: Finding[];
}

export function report(findings: Finding[]): PreflightReport {
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");
  return { ok: blockers.length === 0, blockers, warnings };
}
