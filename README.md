# GML — GOSI Motion Library

A shared motion asset system for the GOSI design team, spanning two Adobe hosts:

- **Motion designers** browse the library inside **After Effects** and apply
  approved components instead of rebuilding them.
- **Storyboard designers** browse the same library inside **Illustrator**, place
  a poster frame on an artboard, and it carries a hidden tag naming the
  animation. Visible tag badges toggle off in one action so a board can be shown
  to management for approval.
- A `.gml.json` **bridge** carries those tags from Illustrator into After
  Effects, so the motion designer opens a storyboard with the animations already
  chosen.

GML is a production system, not an asset browser: it exists to guarantee an
asset actually works on the machine that receives it — no missing files, no
silent version updates, no half-uploaded packages.

## Platform constraints that shape the design

Verified against Adobe's documentation, and not negotiable:

| Constraint | Consequence |
| --- | --- |
| After Effects has no UXP panel support; Illustrator's UXP has no public API | Both panels are **CEP + ExtendScript** |
| `com.adobe.cep.dnd.file` works in Premiere only | No drag onto a canvas or timeline; the drag ends on a **drop zone inside the panel** |
| CEP 11.1 is Chromium 88, CEP 12 is Chromium 99 | **No container queries** (105), `:has()` (105) or `subgrid` (117). Layout is driven by `ResizeObserver` |
| Chromium refuses ES modules over `file://` | The panel bundle is a classic **IIFE**, and `index.html` is copied rather than processed |
| CEP with `--enable-nodejs` injects `module`/`exports` globals | `index.html` hides them while the bundle boots, or it never attaches to `window` |
| ExtendScript is ES3 with no native `JSON` | `.jsx` files stay thin; logic lives in TypeScript |
| Drive omits `sha256Checksum` on Shared Drives | `md5` is **required** for verifying uploads; `sha256` verifies locally |
| "Collect Files" is a modal menu command | Dependency collection is scripted via `footageItem.replace()` |

## Packages

| Package | Responsibility |
| --- | --- |
| `@gml/core` | `GmlAsset` schema, the eight categories, search, versioning, readiness |
| `@gml/storage` | `LibraryProvider` port, staged publishing, package cache |
| `@gml/preflight` | Publish-readiness rules over a project snapshot — no AE needed |
| `@gml/ui` | The adaptive panel shared by both hosts |
| `@gml/cep` | CEP host bridge and in-panel diagnostics |
| `@gml/ae-panel`, `@gml/ai-panel` | The two CEP extensions |
| `@gml/harness` | Browser host that runs the panel with no Adobe application |

`@gml/storage/node` is a separate entry point because hashing needs
`node:crypto` — available in a CEP panel, absent in a browser bundle.

## Key design decisions

**Audio is a separate asset type, not a category.** `GmlAsset` is a
discriminated union on `assetType`. `compName`, `fps` and `width`/`height` are
meaningless for a sound file, and its package has no `source.aep` to collect.

**`id` and `id@version` are different keys.** That is what lets a project keep
one version while the library offers a newer one. A newer version never
replaces anything silently.

**The manifest never lists `meta.json`.** That file carries the manifest, so it
cannot hash itself. Entries are keyed by package-relative path so two files
named `logo.png` in different folders stay distinct.

**Publishing is staged.** Begin, upload, verify, finalize — an interrupted
upload never becomes a visible asset.

**Element count must not track card count.** Only the active card mounts a
`<video>`, and one shared `<audio>` element serves the whole panel. A single
`activeId` spans both, which is what stops overlapping sound.

## Development

```sh
pnpm install
pnpm harness      # panel in a browser, no Adobe required
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The harness frames the panel in a resizable column, so the real
`ResizeObserver` drives layout changes exactly as it will when a designer drags
the panel edge inside Adobe.

## Running it in Adobe

```sh
pnpm cep:install     # builds both panels and installs them into CEP
```

Then quit and reopen the host, and use `Window → Extensions → GML`.
`pnpm cep:doctor` explains a panel that does not appear.

See [`docs/m0.5/`](./docs/m0.5/README.md) for the install guide, the in-Adobe
verification checklist, and the five spikes.

## Status — M1

The panels index the team's hand-authored library on the Shared Drive
(`Motion Library/`), cache what they use under `%LOCALAPPDATA%\GML` (or
`~/Library/Application Support/GML`), and import only from that cache. The
library is never restructured; Publish writes one folder per asset, the way a
person would.

- **Indexer** — recognises the three folder shapes (flat, master project, item
  folders), skips render/source/auto-save noise, parses the filename
  convention into tags and variants, probes codec/size from container headers
  with bounded reads, and rescans incrementally.
- **Cache** — atomic `.part` → rename, resume from the part, per-file locks,
  versions side by side, LRU eviction under a size cap with pins for whatever
  the open project references.
- **Transport seam** — Google Drive for Desktop mount today; Google Drive API
  with per-user OAuth (PKCE, loopback, system browser, `drive.readonly` +
  `drive.file`, Range resume, backoff) behind the same interface; object
  storage can slot in later without touching anything else.
- **Panel** — posters only, one shared `<video>`, ☁ / ⬇ / ✓ per asset, Apply
  = fetch-then-import, variants, render-standard badges, host theme, RTL.

See [`docs/library-setup.md`](./docs/library-setup.md) for setup and use and
[`docs/m1-acceptance.md`](./docs/m1-acceptance.md) for the acceptance
checklist to run on a machine with After Effects. Illustrator `Place`, Spike D
and extension signing are deliberately out of scope for M1.

