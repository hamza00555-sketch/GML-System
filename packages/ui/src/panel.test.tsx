// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CATEGORIES } from "@gml/core";
import { PanelRoot } from "./PanelRoot.js";
import { MAX_CONCURRENT_VIDEOS } from "./media.js";
import { aeBridge, aiBridge, mockProvider } from "./testing.js";
import type { FakeHostBridge } from "./testing.js";

/** jsdom has no ResizeObserver; the panel falls back to its initial width. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  // jsdom does not implement media playback.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => {},
  });
  globalThis.localStorage?.clear();
});

afterEach(cleanup);

async function renderPanel(
  options: { bridge?: FakeHostBridge; width?: number; locale?: "en" | "ar" } = {},
) {
  const bridge = options.bridge ?? aeBridge();
  const view = render(
    <PanelRoot
      bridge={bridge}
      provider={mockProvider()}
      initialWidth={options.width ?? 900}
      locale={options.locale}
    />,
  );
  await screen.findByTestId("asset-grid").catch(() => null);
  await waitFor(() => expect(screen.queryByTestId("panel-root")).not.toBeNull());
  return { bridge, view };
}

describe("adaptive workspace", () => {
  it("mounts the compact layout in a narrow panel", async () => {
    await renderPanel({ width: 240 });
    await waitFor(() => expect(screen.queryByTestId("layout-compact")).not.toBeNull());
    expect(screen.queryByTestId("layout-explorer")).toBeNull();
    expect(screen.queryByTestId("category-sidebar")).toBeNull();
    expect(screen.queryByTestId("inspector")).toBeNull();
  });

  it("mounts the standard layout at mid width, with scrolling chips", async () => {
    await renderPanel({ width: 420 });
    await waitFor(() => expect(screen.queryByTestId("layout-standard")).not.toBeNull());
    expect(screen.queryByTestId("category-chips")).not.toBeNull();
    expect(screen.queryByTestId("category-sidebar")).toBeNull();
  });

  it("mounts the explorer layout when wide, with sidebar and inspector", async () => {
    await renderPanel({ width: 900 });
    await waitFor(() => expect(screen.queryByTestId("layout-explorer")).not.toBeNull());
    expect(screen.queryByTestId("category-sidebar")).not.toBeNull();
    expect(screen.queryByTestId("inspector")).not.toBeNull();
  });

  it("writes the mode onto the root so CSS can select on it", async () => {
    await renderPanel({ width: 900 });
    await waitFor(() =>
      expect(screen.getByTestId("panel-root").getAttribute("data-mode")).toBe("explorer"),
    );
  });
});

describe("categories", () => {
  it("shows exactly the eight approved categories plus All in the sidebar", async () => {
    await renderPanel({ width: 900 });
    const sidebar = await screen.findByTestId("category-sidebar");
    const rendered = [...sidebar.querySelectorAll("[data-category]")].map((el) =>
      el.getAttribute("data-category"),
    );
    for (const category of CATEGORIES) expect(rendered).toContain(category);
    // All + 8 categories + favorites + recent, and nothing invented.
    expect(rendered).toHaveLength(CATEGORIES.length + 3);
  });

  it("hides audio in Illustrator and shows it in After Effects", async () => {
    await renderPanel({ width: 900, bridge: aiBridge() });
    const aiSidebar = await screen.findByTestId("category-sidebar");
    expect(aiSidebar.querySelector('[data-category="audio"]')).toBeNull();
    cleanup();

    await renderPanel({ width: 900, bridge: aeBridge() });
    const aeSidebar = await screen.findByTestId("category-sidebar");
    expect(aeSidebar.querySelector('[data-category="audio"]')).not.toBeNull();
  });

  it("keeps audio assets out of the Illustrator grid entirely", async () => {
    await renderPanel({ width: 900, bridge: aiBridge() });
    await screen.findByTestId("asset-grid");
    expect(document.querySelectorAll('[data-asset-type="audio"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-asset-type="motion"]').length).toBeGreaterThan(0);
  });
});

describe("cards branch on assetType", () => {
  it("renders an audio asset as an audio card, never a motion card", async () => {
    await renderPanel({ width: 900 });
    const card = await screen.findByTestId("card-gml_ui-transition-01");
    expect(card.getAttribute("data-asset-type")).toBe("audio");
    expect(card.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("play-gml_ui-transition-01")).not.toBeNull();
  });

  it("opens the audio inspector for an audio asset", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(await screen.findByTestId("card-gml_ui-transition-01"));
    expect(await screen.findByTestId("audio-inspector")).not.toBeNull();
    expect(screen.queryByTestId("motion-inspector")).toBeNull();
  });

  it("opens the motion inspector for a motion asset", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(await screen.findByTestId("card-gml_fade-up"));
    expect(await screen.findByTestId("motion-inspector")).not.toBeNull();
    expect(screen.queryByTestId("audio-inspector")).toBeNull();
  });
});

describe("playback", () => {
  it("keeps at most one grid video and one inspector video mounted", async () => {
    await renderPanel({ width: 900 });
    await screen.findByTestId("asset-grid");

    const cards = document.querySelectorAll('[data-asset-type="motion"]');
    expect(cards.length).toBeGreaterThan(3);

    // Hover several cards; only the last one may hold a video.
    for (const card of cards) {
      fireEvent.mouseEnter(card);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(document.querySelectorAll("video").length).toBeLessThanOrEqual(
      MAX_CONCURRENT_VIDEOS,
    );
    expect(document.querySelectorAll('[data-testid="grid-video"]').length).toBeLessThanOrEqual(1);
  });

  it("does not start playing before hover intent has elapsed", async () => {
    await renderPanel({ width: 900 });
    const card = await screen.findByTestId("card-gml_fade-up");
    fireEvent.mouseEnter(card);
    expect(screen.queryByTestId("grid-video")).toBeNull();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByTestId("grid-video")).not.toBeNull();
  });

  it("stops the previous video when another card takes over", async () => {
    await renderPanel({ width: 900 });
    const first = await screen.findByTestId("card-gml_fade-up");
    const second = await screen.findByTestId("card-gml_counter-up");

    fireEvent.mouseEnter(first);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(first.querySelector("video")).not.toBeNull();

    fireEvent.mouseLeave(first);
    fireEvent.mouseEnter(second);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(first.querySelector("video")).toBeNull();
    expect(second.querySelector("video")).not.toBeNull();
  });

  it("stops a playing video when audio starts — one medium at a time", async () => {
    await renderPanel({ width: 900 });
    const motion = await screen.findByTestId("card-gml_fade-up");

    fireEvent.mouseEnter(motion);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(motion.querySelector("video")).not.toBeNull();

    fireEvent.click(await screen.findByTestId("play-gml_ui-transition-01"));
    await waitFor(() => expect(motion.querySelector("video")).toBeNull());
  });

  it("never plays two sounds at once", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(await screen.findByTestId("play-gml_ui-transition-01"));
    await waitFor(() =>
      expect(screen.getByTestId("play-gml_ui-transition-01").textContent).toBe("❚❚"),
    );

    fireEvent.click(await screen.findByTestId("play-gml_whoosh-soft"));
    await waitFor(() =>
      expect(screen.getByTestId("play-gml_whoosh-soft").textContent).toBe("❚❚"),
    );
    // The first one must have given up the single shared audio element.
    expect(screen.getByTestId("play-gml_ui-transition-01").textContent).toBe("▶");
  });

  it("uses exactly one shared audio element for the whole panel", async () => {
    await renderPanel({ width: 900 });
    await screen.findByTestId("asset-grid");
    expect(document.querySelectorAll("audio")).toHaveLength(1);
  });
});

describe("language", () => {
  it("defaults to English chrome and left-to-right", async () => {
    await renderPanel({ width: 900 });
    const root = screen.getByTestId("panel-root");
    expect(root.getAttribute("dir")).toBe("ltr");
    expect(root.getAttribute("lang")).toBe("en");
    expect(screen.getAllByText("Apply").length).toBeGreaterThan(0);
  });

  it("switches to Arabic, flips direction and translates the chrome", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(await screen.findByTestId("language-toggle"));

    await waitFor(() => {
      const root = screen.getByTestId("panel-root");
      expect(root.getAttribute("dir")).toBe("rtl");
      expect(root.getAttribute("lang")).toBe("ar");
    });
    expect(screen.getAllByText("تطبيق").length).toBeGreaterThan(0);
  });

  it("shows the Arabic asset name once Arabic is active", async () => {
    await renderPanel({ width: 900 });
    expect(screen.getAllByTitle("Fade Up Title").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("language-toggle"));
    await waitFor(() =>
      expect(screen.getAllByTitle("عنوان يظهر للأعلى").length).toBeGreaterThan(0),
    );
  });

  it("remembers the choice across a remount", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(screen.getByTestId("language-toggle"));
    await waitFor(() => expect(screen.getByTestId("panel-root").getAttribute("lang")).toBe("ar"));

    cleanup();
    await renderPanel({ width: 900 });
    await waitFor(() => expect(screen.getByTestId("panel-root").getAttribute("lang")).toBe("ar"));
  });
});

describe("applying", () => {
  it("labels the primary action Apply in AE and Place in Illustrator", async () => {
    await renderPanel({ width: 900, bridge: aeBridge() });
    expect((await screen.findByTestId("dock-apply")).textContent).toContain("Apply");
    cleanup();

    await renderPanel({ width: 900, bridge: aiBridge() });
    expect((await screen.findByTestId("dock-apply")).textContent).toContain("Place");
  });

  it("shows the host target in the dock", async () => {
    await renderPanel({ width: 900, bridge: aiBridge() });
    await waitFor(() =>
      expect(screen.getByTestId("dock-target").textContent).toContain("Shot_03"),
    );
  });

  it("applies a single asset from the inspector without touching the queue", async () => {
    const bridge = aeBridge();
    await renderPanel({ width: 900, bridge });

    fireEvent.click(await screen.findByTestId("card-gml_fade-up"));
    fireEvent.click(await screen.findByTestId("inspector-apply"));

    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    expect(bridge.applied[0]).toEqual([{ id: "gml_fade-up", version: "1.0.0" }]);
    expect(screen.queryByTestId("queue")).toBeNull();
  });

  it("applies a dragged queue in order", async () => {
    const bridge = aeBridge();
    await renderPanel({ width: 900, bridge });

    const zone = (await screen.findByTestId("dropzone")).querySelector(".gml-dock__zone")!;
    const drop = (payload: string) => {
      const data = new Map([["application/x-gml-asset", payload]]);
      fireEvent.drop(zone, {
        dataTransfer: { getData: (k: string) => data.get(k) ?? "", types: [...data.keys()] },
      });
    };

    drop("gml_fade-up@1.0.0");
    drop("gml_counter-up@1.0.0");
    await waitFor(() => expect(screen.queryByTestId("queue")).not.toBeNull());

    fireEvent.click(screen.getByTestId("dock-apply"));
    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    expect(bridge.applied[0]!.map((r) => r.id)).toEqual(["gml_fade-up", "gml_counter-up"]);
  });
});

describe("host tools", () => {
  it("offers the tag tools in Illustrator only", async () => {
    await renderPanel({ width: 900, bridge: aiBridge() });
    expect(await screen.findByTestId("ai-toolbar")).not.toBeNull();
    expect(screen.queryByTestId("ae-toolbar")).toBeNull();
    cleanup();

    await renderPanel({ width: 900, bridge: aeBridge() });
    expect(await screen.findByTestId("ae-toolbar")).not.toBeNull();
    expect(screen.queryByTestId("ai-toolbar")).toBeNull();
  });

  it("toggles storyboard tags through the host in one call", async () => {
    const bridge = aiBridge();
    await renderPanel({ width: 900, bridge });

    const toggle = await screen.findByTestId("toggle-tags");
    expect(toggle.textContent).toContain("Hide Tags");

    fireEvent.click(toggle);
    await waitFor(() => expect(bridge.tagsVisible).toBe(false));
    expect(screen.getByTestId("toggle-tags").textContent).toContain("Show Tags");

    fireEvent.click(screen.getByTestId("toggle-tags"));
    await waitFor(() => expect(bridge.tagsVisible).toBe(true));
  });

  it("runs resync and export through the host", async () => {
    const bridge = aiBridge();
    await renderPanel({ width: 900, bridge });

    fireEvent.click(await screen.findByTestId("resync-tags"));
    await waitFor(() => expect(bridge.resyncCount).toBe(1));

    fireEvent.click(screen.getByTestId("export-storyboard"));
    await waitFor(() => expect(bridge.exportCount).toBe(1));
  });
});

describe("readiness badges", () => {
  it("marks an asset needing a missing plugin", async () => {
    await renderPanel({
      width: 900,
      bridge: aeBridge({ environment: { fonts: [], effectMatchNames: [] } }),
    });
    const card = await screen.findByTestId("card-gml_isometric-card");
    expect(card.querySelector('[data-testid="status-requires-plugin"]')).not.toBeNull();
  });

  it("marks an asset needing a missing font", async () => {
    await renderPanel({
      width: 900,
      bridge: aeBridge({ environment: { fonts: [], effectMatchNames: [] } }),
    });
    const card = await screen.findByTestId("card-gml_brand-lockup");
    expect(card.querySelector('[data-testid="status-requires-font"]')).not.toBeNull();
  });

  it("marks a clean asset as safe", async () => {
    await renderPanel({
      width: 900,
      bridge: aeBridge({ environment: { fonts: [], effectMatchNames: [] } }),
    });
    const card = await screen.findByTestId("card-gml_fade-up");
    expect(card.querySelector('[data-testid="status-safe"]')).not.toBeNull();
  });
});
