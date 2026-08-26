# Verifying the panel inside Adobe

Everything below has already been proven in a browser. The point of repeating it
inside Adobe is that CEP's Chromium is older and more constrained than a
desktop browser, and that is exactly where assumptions break.

Work through it once in **After Effects** and once in **Illustrator**. Note
anything that differs between the two.

---

## 1. The panel opens

`Window → Extensions → GML`

- [ ] The panel opens and shows a grid of asset cards, not a blank rectangle.
- [ ] It is dark and reads as part of the application, not as a web page.

> **A blank white panel** almost always means the JavaScript bundle failed to
> boot. Open `http://localhost:8088` (AE) or `:8089` (Illustrator) in Chrome
> while the panel is open, and send me the console error.

---

## 2. The three layouts

Drag the panel's edge to resize it. The layout should *change kind*, not just
scale.

| Width | Expect |
|-------|--------|
| Under ~280px | **Compact** — vertical list, small thumbnails, no sidebar, Apply pinned at the bottom |
| ~280–650px | **Standard** — grid of cards, a horizontal scrolling row of category chips |
| Over ~650px | **Explorer** — left sidebar, centre grid, right inspector |

- [ ] All three appear.
- [ ] Compact shows **no** sidebar and **no** inspector.
- [ ] Explorer shows the sidebar **and** the inspector.
- [ ] Information *increases* with width rather than the same elements growing.

### Breakpoint stability

Drag the edge slowly until the layout is right on the boundary between two
modes, and jiggle it back and forth by a few pixels.

- [ ] The layout does **not** flicker between two modes.

That dead band is deliberate — it is the reason resizing feels stable.

---

## 3. Categories

- [ ] The sidebar lists exactly: All, 3D, Animated Texts, Backgrounds, Counters,
      Guideline, Illustrations, Transitions, **and Audio in After Effects only**.
- [ ] Below a divider: Favorites, Recent.
- [ ] **Illustrator shows no Audio category and no audio cards anywhere.**
- [ ] No category exists that is not in that list.

---

## 4. Language and right-to-left

Press the **ع** button in the header.

- [ ] Chrome switches to Arabic (Search → بحث, Apply → تطبيق).
- [ ] **The whole layout mirrors** — the sidebar moves to the right side.
- [ ] Asset names switch to their Arabic names.
- [ ] Press **EN** to switch back; everything mirrors back.
- [ ] Close the panel, reopen it — **the language choice is remembered**.

Mirroring comes from CSS logical properties rather than a separate stylesheet.
If the text translates but the layout does **not** mirror, say so — that is a
specific failure worth knowing about.

---

## 5. Video preview

- [ ] Hover a motion card. After a short pause the poster is replaced by playing
      video.
- [ ] Move the pointer **across** several cards quickly without stopping —
      nothing should start playing.
- [ ] Hover card A, then card B. **A stops when B starts.**

> In this build the preview source is intentionally empty, so cards may simply
> keep showing their poster. That is expected — real playback is measured in
> [Spike E](./spike-e.md), which is the authoritative test.

---

## 6. Audio preview (After Effects only)

- [ ] Audio cards show a play button and a waveform, not a video thumbnail.
- [ ] Press play on one audio card, then another. **The first stops.**
- [ ] Start an audio card while a video is playing. **The video stops.**

One thing plays at a time, across both kinds. If two sounds ever overlap, that
is a failure.

---

## 7. The host connection

This is the part that could not be tested in a browser at all.

**After Effects** — open a project with at least one composition:

- [ ] Open a comp. The bar above Apply reads `Active Comp: <name>`.
- [ ] Select a layer. It changes to `Selected Layer: <name>`.
- [ ] Cards show a status: `GML Safe`, `Requires Font`, or `Requires Plugin`.

**Illustrator** — open any document:

- [ ] The bar reads `Active Artboard: <name>`.
- [ ] Select an object. It changes to `Selected Frame: …`.
- [ ] The toolbar shows **Hide Tags**, **Resync Tags**, **Export Storyboard**.

- [ ] Drag two cards onto the drop zone — a queue appears with a count.
- [ ] Press Apply. A message confirms the bridge worked. **Nothing in your
      document changes** — that is correct for M0.5.

---

## 8. Performance

- [ ] Scrolling the grid is smooth.
- [ ] Resizing the panel is smooth.
- [ ] Switching category is immediate.
- [ ] The panel does not make the host application sluggish.

---

## 9. The report

Press **Diagnostics** (bottom corner), then **Copy report**, and send it to me.

Expected inside Adobe:

```
[PASS] Running inside a CEP host
[PASS] Node.js available in the panel
[PASS] ExtendScript round trip
[PASS] ResizeObserver drives the layout
[PASS] CSS container queries        ← "absent, as expected" is a PASS
[PASS] CSS logical properties
[PASS] localStorage
[????] Media codecs                 ← this is Spike E's answer
```

Anything marked FAIL other than the codec line needs fixing before we go on.

---

## If something fails

Send me:

1. The **Copy report** text.
2. Which application and version (`Help → About`).
3. The console output from `http://localhost:8088` / `:8089` while the panel is
   open.
4. A screenshot, if it is a visual problem.
