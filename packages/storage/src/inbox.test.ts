import { describe, expect, it } from "vitest";
import { MemoryFs } from "./fs.js";
import { listInbox, removeInboxItem } from "./inbox.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("inbox", () => {
  it("returns nothing without an _inbox folder", () => {
    const fs = new MemoryFs();
    fs.mkdir("/lib");
    expect(listInbox(fs, "/lib")).toEqual([]);
  });

  it("finds the aep, preview and optional poster per folder and reads asset.json defaults", () => {
    const fs = new MemoryFs();
    fs.writeFile("/lib/_inbox/Fade Up/titles.aep", bytes("aep"));
    fs.writeFile("/lib/_inbox/Fade Up/render.mp4", bytes("mp4"));
    fs.writeFile("/lib/_inbox/Fade Up/asset.json", JSON.stringify({ compName: "GML_fade", category: "transitions", tags: ["a"] }));
    fs.writeFile("/lib/_inbox/counter/c.aep", bytes("aep"));
    fs.writeFile("/lib/_inbox/counter/c.mp4", bytes("mp4"));
    fs.writeFile("/lib/_inbox/counter/c.png", bytes("png"));
    fs.writeFile("/lib/_inbox/counter/.DS_Store", bytes(""));

    const items = listInbox(fs, "/lib");
    expect(items.map((i) => i.name)).toEqual(["Fade Up", "counter"]);

    const fade = items[0]!;
    expect(fade.aep).toBe("/lib/_inbox/Fade Up/titles.aep");
    expect(fade.preview).toBe("/lib/_inbox/Fade Up/render.mp4");
    expect(fade.poster).toBeNull();
    expect(fade.defaults).toEqual({ compName: "GML_fade", category: "transitions", tags: ["a"] });
    expect(fade.problems).toEqual([]);

    const counter = items[1]!;
    expect(counter.poster).toBe("/lib/_inbox/counter/c.png");
    expect(counter.defaults).toEqual({});
  });

  it("reports what is wrong with an incomplete or ambiguous folder", () => {
    const fs = new MemoryFs();
    fs.writeFile("/lib/_inbox/broken/a.aep", bytes("1"));
    fs.writeFile("/lib/_inbox/broken/b.aep", bytes("2"));
    fs.writeFile("/lib/_inbox/nopreview/x.aep", bytes("1"));
    fs.writeFile("/lib/_inbox/badjson/x.aep", bytes("1"));
    fs.writeFile("/lib/_inbox/badjson/x.mp4", bytes("1"));
    fs.writeFile("/lib/_inbox/badjson/asset.json", "{oops");
    fs.writeFile("/lib/_inbox/stray.txt", bytes("not a folder"));
    fs.mkdir("/lib/_inbox/_imported");

    const byName = Object.fromEntries(listInbox(fs, "/lib").map((i) => [i.name, i]));
    expect(Object.keys(byName).sort()).toEqual(["badjson", "broken", "nopreview"]);
    expect(byName.broken!.problems).toEqual(["2 .aep files — keep one", "no .mp4 preview"]);
    expect(byName.broken!.aep).toBeNull();
    expect(byName.nopreview!.problems).toEqual(["no .mp4 preview"]);
    expect(byName.badjson!.problems[0]).toMatch(/asset\.json is not valid JSON/);
  });

  it("removes an imported folder", () => {
    const fs = new MemoryFs();
    fs.writeFile("/lib/_inbox/done/x.aep", bytes("1"));
    fs.writeFile("/lib/_inbox/done/x.mp4", bytes("1"));
    const [item] = listInbox(fs, "/lib");
    removeInboxItem(fs, item!);
    expect(fs.exists("/lib/_inbox/done")).toBe(false);
    expect(listInbox(fs, "/lib")).toEqual([]);
  });
});
