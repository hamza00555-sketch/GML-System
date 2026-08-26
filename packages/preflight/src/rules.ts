import type { Finding, PreflightReport, ProjectSnapshot } from "./types.js";
import { report } from "./types.js";
import { classifyFootage } from "./classify.js";
import { checkPortability, type PathOptions } from "./portability.js";

/** Effects shipped with After Effects use this matchName prefix. */
const NATIVE_EFFECT_PREFIX = "ADBE ";

export function thirdPartyEffects(matchNames: readonly string[]): string[] {
  return [...new Set(matchNames.filter((m) => !m.startsWith(NATIVE_EFFECT_PREFIX)))];
}

/**
 * Phase A — before anything is collected.
 *
 * External footage is *normal* here: it is the input the collect step is about
 * to gather. Only things collect cannot fix are blockers at this stage.
 */
export function preflightBeforeCollect(snapshot: ProjectSnapshot): PreflightReport {
  const findings: Finding[] = [];

  if (!snapshot.projectPath) {
    findings.push({
      severity: "blocker",
      code: "project-unsaved",
      message: "Save the project before publishing.",
    });
  } else if (snapshot.projectDirty) {
    findings.push({
      severity: "blocker",
      code: "project-dirty",
      message: "The project has unsaved changes.",
    });
  }

  if (!snapshot.compName.trim()) {
    findings.push({
      severity: "blocker",
      code: "comp-name-invalid",
      message: "Select a composition to publish.",
    });
  } else {
    const occurrences = snapshot.compNames.filter((n) => n === snapshot.compName).length;
    if (occurrences === 0) {
      findings.push({
        severity: "blocker",
        code: "comp-not-found",
        message: `Composition "${snapshot.compName}" is not in this project.`,
      });
    } else if (occurrences > 1) {
      findings.push({
        severity: "blocker",
        code: "comp-name-duplicate",
        message: `More than one composition is named "${snapshot.compName}".`,
      });
    }
  }

  for (const item of snapshot.footage) {
    if (classifyFootage(item) === "missing") {
      findings.push({
        severity: "blocker",
        code: "footage-missing",
        message: `Missing: ${item.name}`,
        detail: item.missingFootagePath ?? item.filePath,
      });
    }
  }

  return report(findings);
}

export interface AfterCollectInput {
  snapshot: ProjectSnapshot;
  packageRoot: string;
  /** Fonts available on this machine, when the host can tell us. */
  installedFonts?: readonly string[];
  pathOptions?: PathOptions;
}

/**
 * Phase B — the Final Portability Check, run after collect and relink.
 *
 * Fonts, plugins and AE version stay warnings because they depend on the
 * *receiving* machine and cannot be resolved at publish time. Footage left
 * outside the package is a defect in the package itself, so it blocks.
 */
export function preflightAfterCollect(input: AfterCollectInput): PreflightReport {
  const { snapshot, packageRoot, installedFonts, pathOptions } = input;
  const findings: Finding[] = [];

  findings.push(...checkPortability(snapshot.footage, packageRoot, pathOptions).findings);

  const missingFonts = installedFonts
    ? snapshot.fonts.filter((f) => !installedFonts.includes(f))
    : snapshot.fonts;
  for (const font of missingFonts) {
    findings.push({
      severity: "warning",
      code: "font-required",
      message: `Font: ${font}`,
      detail: "Recipients without this font will see substituted type.",
    });
  }

  for (const matchName of thirdPartyEffects(snapshot.effectMatchNames)) {
    findings.push({
      severity: "warning",
      code: "plugin-required",
      message: `Plugin: ${matchName}`,
      detail: "Recipients without this plugin cannot render the asset as authored.",
    });
  }

  if (snapshot.aeVersion) {
    findings.push({
      severity: "warning",
      code: "ae-version",
      message: `Authored in After Effects ${snapshot.aeVersion}`,
    });
  }

  return report(findings);
}

/** Convenience for the panel: both phases, with phase B gated on phase A. */
export function preflight(input: AfterCollectInput): PreflightReport {
  const before = preflightBeforeCollect(input.snapshot);
  if (!before.ok) return before;

  const after = preflightAfterCollect(input);
  return report([...before.warnings, ...after.blockers, ...after.warnings]);
}
