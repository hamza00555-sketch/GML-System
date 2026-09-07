// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { largeIndex, sampleIndex, type LibraryIndex } from "@gml/core";
import { PanelRoot } from "./PanelRoot.js";
import { HOVER_INTENT_MS } from "./media.js";
import { FakeFetchService, aeBridge, aiBridge, fakeSource } from "./testing.js";
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
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: () => Promise.resolve() });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => {} });
  globalThis.localStorage?.clear();
});

afterEach(cleanup);

async function renderPanel(
  options: { bridge?: FakeHostBridge; width?: number; locale?: "en" | "ar"; index?: LibraryIndex; fetch?: FakeFetchService; theme?: "dark" | "light" } = {},
) {
  const bridge = options.bridge ?? aeBridge();
  const fetch = options.fetch ?? new FakeFetchService("instant");
  const view = render(
    <PanelRoot bridge={bridge} source={fakeSource(options.index)} fetch={fetch} initialWidth={options.width ?? 900} locale={options.locale} theme={options.theme} />,
  );
  await waitFor(() => expect(screen.queryByTestId("panel-root")).not.toBeNull());
  await waitFor(() => expect(screen.queryByTestId("asset-grid") ?? screen.queryByTestId("asset-list")).not.toBeNull());
  return { bridge, fetch, view };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("adaptive workspace", () => {
  it("mounts the compact layout in a narrow panel", async () => {
    await renderPanel({ width: 240 });
    expect(screen.queryByTestId("layout-compact")).not.toBeNull();
    expect(screen.queryByTestId("layout-explorer")).toBeNull();
    expect(screen.queryByTestId("inspector")).toBeNull();
    expect(screen.queryByTestId("asset-list")).not.toBeNull();
  });

  it("mounts the standard layout at mid width, with scrolling chips", async () => {
    await renderPanel({ width: 420 });
    expect(screen.queryByTestId("layout-standard")).not.toBeNull();
    expect(screen.queryByTestId("category-chips")).not.toBeNull();
  });

  it("mounts the explorer layout with sidebar and inspector when wide", async () => {
    await renderPanel({ width: 900 });
    expect(screen.queryByTestId("layout-explorer")).not.toBeNull();
    expect(screen.queryByTestId("category-sidebar")).not.toBeNull();
    expect(screen.queryByTestId("inspector")).not.toBeNull();
  });

  it("stamps the host theme on the root", async () => {
    await renderPanel({ theme: "light" });
    expect(screen.getByTestId("panel-root").getAttribute("data-theme")).toBe("light");
  });
});

describe("categories from the index", () => {
  it("lists only categories that hold assets, in canonical order", async () => {
    await renderPanel({ width: 900 });
    const sidebar = screen.getByTestId("category-sidebar");
    const cats = within(sidebar)
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-category"))
      .filter((c) => c && c !== "all" && c !== "favorites" && c !== "recent");
    expect(cats).toEqual(["3d", "animated-texts", "backgrounds", "counters", "illustrations", "transitions"]);
  });

  it("filters the grid by category", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(within(screen.getByTestId("category-sidebar")).getByText("Counters"));
    await waitFor(() => expect(screen.getAllByTestId(/^card-/).length).toBe(1));
    expect(screen.queryByTestId("card-counters/counter-01")).not.toBeNull();
  });
});

describe("language", () => {
  it("defaults to English, left to right", async () => {
    await renderPanel();
    const root = screen.getByTestId("panel-root");
    expect(root.getAttribute("dir")).toBe("ltr");
    expect(root.getAttribute("lang")).toBe("en");
  });

  it("switches to Arabic, flips direction and uses Arabic names where they exist", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(screen.getByTestId("language-toggle"));
    await waitFor(() => expect(screen.getByTestId("panel-root").getAttribute("dir")).toBe("rtl"));
    expect(screen.getByTestId("card-backgrounds/dark-blue").textContent).toContain("أزرق داكن");
    // No Arabic name → English one, never blank.
    expect(screen.getByTestId("card-transitions/arrows").textContent).toContain("Arrows");
  });
});

describe("one video element", () => {
  it("renders 48 cards as posters with no video mounted", async () => {
    await renderPanel({ width: 900, index: largeIndex(48) });
    expect(screen.getAllByTestId(/^card-/).length).toBe(48);
    expect(document.querySelectorAll("video").length).toBe(0);
    expect(document.querySelectorAll("img.gml-card__poster").length).toBe(48);
  });

  it("mounts the single shared video into the hovered card and moves it, never duplicating", async () => {
    await renderPanel({ width: 900, index: largeIndex(48) });
    const first = screen.getByTestId("card-transitions/arrows");
    const second = screen.getByTestId("card-3d/coin");

    fireEvent.mouseEnter(first);
    await act(() => sleep(HOVER_INTENT_MS + 30));
    expect(document.querySelectorAll("video").length).toBe(1);
    expect(first.querySelector("video")).not.toBeNull();

    fireEvent.mouseEnter(second);
    await act(() => sleep(HOVER_INTENT_MS + 30));
    expect(document.querySelectorAll("video").length).toBe(1);
    expect(second.querySelector("video")).not.toBeNull();
    expect(first.querySelector("video")).toBeNull();

    fireEvent.mouseLeave(second);
    await waitFor(() => expect(document.querySelectorAll("video").length).toBe(0));
  });

  it("a quick sweep across the grid plays nothing", async () => {
    await renderPanel({ width: 900 });
    const card = screen.getByTestId("card-transitions/arrows");
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    await act(() => sleep(HOVER_INTENT_MS + 30));
    expect(document.querySelectorAll("video").length).toBe(0);
  });

  it("the inspector shares the same element — selecting an asset never adds a second video", async () => {
    await renderPanel({ width: 900 });
    fireEvent.click(screen.getByTestId("card-transitions/arrows"));
    await waitFor(() => expect(screen.getByTestId("inspector").querySelector("video")).not.toBeNull());
    expect(document.querySelectorAll("video").length).toBe(1);
    fireEvent.mouseEnter(screen.getByTestId("card-3d/coin"));
    await act(() => sleep(HOVER_INTENT_MS + 30));
    expect(document.querySelectorAll("video").length).toBe(1);
  });
});

describe("fetch states and Apply", () => {
  it("shows cloud on a cold asset and prefetches when the detail view opens", async () => {
    const fetch = new FakeFetchService("manual");
    await renderPanel({ width: 900, fetch });
    const card = screen.getByTestId("card-transitions/arrows");
    expect(within(card).getByTestId("fetch-cloud")).toBeDefined();

    fireEvent.click(card);
    await waitFor(() => expect(fetch.prefetched).toContain("transitions/arrows@v1/01_TRA_Arrows_D_H_ALPHA.mov"));
    await waitFor(() => expect(within(card).queryByTestId("fetch-fetching")).not.toBeNull());
  });

  it("Apply on a cloud asset fetches with visible progress, then imports the local path — never before", async () => {
    const fetch = new FakeFetchService("manual");
    const { bridge } = await renderPanel({ width: 900, fetch });
    fireEvent.click(screen.getByTestId("card-transitions/arrows"));
    await waitFor(() => expect(screen.getByTestId("inspector-apply")).toBeDefined());

    fireEvent.click(screen.getByTestId("inspector-apply"));
    const key = "transitions/arrows@v1/01_TRA_Arrows_D_H_ALPHA.mov";
    await waitFor(() => expect(screen.getByTestId("inspector-apply").getAttribute("data-state")).toBe("fetching"));
    expect(bridge.applied).toHaveLength(0);

    act(() => fetch.advance(key, 10_000_000));
    await waitFor(() => expect(screen.getByTestId("inspector").textContent).toMatch(/47%/));
    expect(bridge.applied).toHaveLength(0);

    act(() => fetch.complete(key));
    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    const item = bridge.applied[0]![0]!;
    expect(item.localPath).toBe("C:/Users/h/AppData/Local/GML/assets/transitions/arrows/v1/01_TRA_Arrows_D_H_ALPHA.mov");
    expect(item.localPath).not.toMatch(/^G:/);
    expect(item.deliverable.orientation).toBe("H");
    await waitFor(() => expect(within(screen.getByTestId("card-transitions/arrows")).queryByTestId("fetch-ready")).not.toBeNull());
  });

  it("applies a ready asset immediately", async () => {
    const fetch = new FakeFetchService("manual", "C:/Users/h/AppData/Local/GML", ["transitions/arrows@v1/01_TRA_Arrows_D_H_ALPHA.mov"]);
    const { bridge } = await renderPanel({ width: 900, fetch });
    expect(within(screen.getByTestId("card-transitions/arrows")).queryByTestId("fetch-ready")).not.toBeNull();
    fireEvent.doubleClick(screen.getByTestId("card-transitions/arrows"));
    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    expect(fetch.fetched).toEqual([]);
  });

  it("lets the user pick a variant, and applies that file", async () => {
    const { bridge } = await renderPanel({ width: 900 });
    fireEvent.click(screen.getByTestId("card-transitions/arrows"));
    const select = await screen.findByTestId("variant-select");
    fireEvent.change(select, { target: { value: "Transitions/Arrows/01_TRA_Arrows_D_V_ALPHA.mov" } });
    fireEvent.click(screen.getByTestId("inspector-apply"));
    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    expect(bridge.applied[0]![0]!.deliverable.orientation).toBe("V");
  });

  it("queues drops and applies them in order after fetching each", async () => {
    const { bridge } = await renderPanel({ width: 900 });
    const drop = screen.getByTestId("dropzone").querySelector(".gml-dock__zone")!;
    for (const key of ["3d/coin@v2", "transitions/arrows@v1"]) {
      const data = { getData: () => key, setData: () => {}, dropEffect: "copy" };
      fireEvent.dragOver(drop, { dataTransfer: data });
      fireEvent.drop(drop, { dataTransfer: data });
    }
    await waitFor(() => expect(within(screen.getByTestId("queue")).getAllByRole("listitem").length).toBe(3));
    fireEvent.click(screen.getByTestId("dock-apply"));
    await waitFor(() => expect(bridge.applied).toHaveLength(1));
    expect(bridge.applied[0]!.map((i) => i.asset.id)).toEqual(["3d/coin", "transitions/arrows"]);
    expect(bridge.applied[0]!.every((i) => i.localPath.startsWith("C:/Users/h/AppData/Local/GML/"))).toBe(true);
  });

  it("Save a copy… lives in the secondary menu", async () => {
    const { bridge } = await renderPanel({ width: 900 });
    fireEvent.click(screen.getByTestId("card-transitions/arrows"));
    fireEvent.click(await screen.findByTestId("more-menu"));
    fireEvent.click(screen.getByTestId("save-copy"));
    await waitFor(() => expect(bridge.savedCopies).toHaveLength(1));
    expect(bridge.applied).toHaveLength(0);
  });
});

describe("badges", () => {
  it("flags oversized deliverables, drafts and comps needing fonts or plugins", async () => {
    await renderPanel({ width: 900, bridge: aeBridge({ environment: { fonts: [], effectMatchNames: ["ADBE Gaussian Blur 2"] } }) });
    expect(within(screen.getByTestId("card-3d/coin")).queryByTestId("rerender-tag")).not.toBeNull();
    expect(within(screen.getByTestId("card-counters/counter-01")).queryByTestId("draft-tag")).not.toBeNull();
    expect(within(screen.getByTestId("card-animated-texts/all-preview/fade-up")).queryByTestId("status-requires-font")).not.toBeNull();
    expect(within(screen.getByTestId("card-animated-texts/all-preview/typewriter")).queryByTestId("status-requires-plugin")).not.toBeNull();
    expect(within(screen.getByTestId("card-transitions/arrows")).queryByTestId(/^status-/)).toBeNull();
  });

  it("flags an update when the project holds an older version", async () => {
    await renderPanel({ width: 900, bridge: aeBridge({ stamps: [{ id: "3d/coin", version: 1 }] }) });
    expect(within(screen.getByTestId("card-3d/coin")).queryByTestId("update-tag")).not.toBeNull();
    expect(within(screen.getByTestId("card-transitions/arrows")).queryByTestId("update-tag")).toBeNull();
  });
});

describe("hosts", () => {
  it("Illustrator shows Place and the tag tools; After Effects shows Apply and Publish", async () => {
    await renderPanel({ width: 900, bridge: aiBridge() });
    expect(screen.getByTestId("dock-apply").textContent).toContain("Place");
    expect(screen.queryByTestId("ai-toolbar")).not.toBeNull();
    cleanup();
    await renderPanel({ width: 900, bridge: aeBridge() });
    expect(screen.getByTestId("dock-apply").textContent).toContain("Apply");
    expect(screen.queryByTestId("ae-toolbar")).not.toBeNull();
  });

  it("shows the empty-library hint when nothing is indexed", async () => {
    await renderPanel({ width: 900, index: { ...sampleIndex(), assets: [] } }).catch(() => {});
    await waitFor(() => expect(screen.queryByTestId("empty-state")).not.toBeNull());
  });
});
