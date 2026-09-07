import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Settings, Publish and Diagnostics overlays are siblings of .gml-panel
 * inside .gml-panelhost. Tokens scoped only to .gml-panel once left those
 * overlays transparent and in a serif font inside After Effects.
 */
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const panel = readFileSync(new URL("./panel.css", import.meta.url), "utf8");

describe("token scope", () => {
  it("defines the base, dark and light token sets on the app host as well as the panel root", () => {
    expect(tokens).toMatch(/\.gml-panelhost,\s*\.gml-panel,\s*\.gml-panelhost\[data-theme="dark"\]/);
    expect(tokens).toMatch(/\.gml-panelhost\[data-theme="light"\],\s*\.gml-panel\[data-theme="light"\]/);
  });

  it("gives the host its own surface, colour and font so overlays never fall back to browser defaults", () => {
    const host = /\.gml-panelhost \{([^}]+)\}/.exec(panel)?.[1] ?? "";
    expect(host).toContain("background: var(--surface-0)");
    expect(host).toContain("font-family: var(--font)");
    expect(host).toContain("color: var(--text-1)");
  });

  it("never references a token the light theme forgets to redefine", () => {
    const dark = /\.gml-panel\[data-theme="dark"\] \{([^}]+)\}/.exec(tokens)?.[1] ?? "";
    const light = /\.gml-panel\[data-theme="light"\] \{([^}]+)\}/.exec(tokens)?.[1] ?? "";
    const names = (block: string) => [...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(names(light).sort()).toEqual(names(dark).sort());
  });
});
