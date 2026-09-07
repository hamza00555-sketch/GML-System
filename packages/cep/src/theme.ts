import type { PanelTheme } from "@gml/ui";
import { cepAvailable } from "./csinterface.js";

/**
 * Follow the host's skin. appSkinInfo carries the panel background colour;
 * anything light gets the light token set, and themeColorChanged keeps it
 * current when the user switches Adobe's appearance.
 */
interface SkinInfo {
  panelBackgroundColor?: { color?: { red: number; green: number; blue: number } };
}

export function themeFromSkin(skin: SkinInfo | null | undefined): PanelTheme {
  const c = skin?.panelBackgroundColor?.color;
  if (!c) return "dark";
  const luminance = 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;
  return luminance > 128 ? "light" : "dark";
}

export function hostTheme(): PanelTheme {
  if (!cepAvailable()) return "dark";
  try {
    const env = JSON.parse(window.__adobe_cep__!.getHostEnvironment()) as { appSkinInfo?: SkinInfo };
    return themeFromSkin(env.appSkinInfo);
  } catch {
    return "dark";
  }
}

export function onThemeChange(listener: (theme: PanelTheme) => void): () => void {
  if (!cepAvailable()) return () => {};
  const handler = () => listener(hostTheme());
  try {
    window.__adobe_cep__!.addEventListener("com.adobe.csxs.events.ThemeColorChanged", handler);
  } catch {
    return () => {};
  }
  return () => {};
}
