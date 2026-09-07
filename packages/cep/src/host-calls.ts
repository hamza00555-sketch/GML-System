import type { FootageSnapshot } from "@gml/preflight";
import { callHost } from "./csinterface.js";

/** What gmlInspectComp returns — the raw material for a package. */
export interface CompInspection {
  compName: string;
  compId: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
  projectPath: string | null;
  projectDirty: boolean;
  aeVersion: string;
  compNames: string[];
  footage: FootageSnapshot[];
  fonts: string[];
  effects: { matchName: string; name: string }[];
}

export function inspectComp(): Promise<CompInspection> {
  return callHost<CompInspection>("gmlInspectComp");
}

export function saveProject(): Promise<{ path: string; dirty: boolean }> {
  return callHost("gmlSaveProject");
}
