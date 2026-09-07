# M1 — Acceptance checklist (run on a machine with After Effects)

Each row maps to an acceptance criterion in the M1 brief. Tick it only when
you saw it happen.

| # | Criterion | How to check |
|---|---|---|
| 1 | Index has **zero** entries from `Render/`, `SOURCE_`, `_SOURCE`, auto-save or log folders | Settings → Rescan. Open `%LOCALAPPDATA%\GML\index.json` and search for `Render/`, `SOURCE`, `Auto-Save`, `Logs` — no hits under `deliverables`. The scan report line in Settings also lists any top-level folder it did not recognise. |
| 2 | `Transitions`, `3D`, `Backgrounds - خلفيات`, `Illustrations` are `video-alpha`; `Animated Texts` and `Counters` are `comp` | Inspector shows "Alpha video" or "Editable comp" under the name. In `index.json` check `kind` per category. |
| 3 | 40+ cards with at most one `<video>` alive | Open DevTools (`http://localhost:8088`) → Console: `document.querySelectorAll("video").length` while hovering cards and with the inspector open. Never more than 1. |
| 4 | Cold Apply on a cloud asset fetches with visible progress, then adds a correctly interpreted layer | Pick a ☁ asset, press Apply. Watch the percentage on the card and the inspector. After import, the layer sits at the playhead, named after the asset; `Interpret Footage` shows the alpha the index recorded (or AE's guess when unknown). |
| 5 | Killing the network mid-fetch and retrying **resumes** | Start a large fetch (3D/Coin), disable Wi-Fi/Ethernet at ~30%. The card shows Failed. Re-enable and press Apply again: the percentage continues from where it stopped; `%LOCALAPPDATA%\GML\assets\3d\coin\v1\*.part` grows, never restarts at 0. |
| 6 | The AE project references a path under `%LOCALAPPDATA%\GML\`, never `G:\` | Project panel → select the imported footage → the path at the top of the panel. `File → Dependencies → Collect Files` would also show only local paths. |
| 7 | Quitting Google Drive for Desktop does not break fetched assets; a render completes | Quit Drive for Desktop entirely. Scrub the comp, then `Add to Render Queue → Render`. Applying an already ✓ Ready asset still works; a ☁ one reports the mount is unreachable (or works if signed in to Drive API). |
| 8 | Reinstalling the extension keeps sign-in and cache | Sign in (Drive API), fetch one asset, run `install-*.bat/.command` again, reopen AE. Settings shows "signed in" and the asset shows ✓ Ready without downloading. |
| 9 | Both panels legible at 240 px, dark and light | Drag the panel to its narrowest. Switch `Preferences → Appearance` brightness to the lightest and darkest; the panel follows without a restart. |

Also worth noting while you test:

- Time of the first scan (it reads `All & Preview.aep` through AE — expect a minute).
- Whether the tail probe on a large `.mov` felt slow over Drive streaming (Settings scan report shows "files probed").
- Any asset whose name, variant labels or tags look wrong — send the file name and I will adjust the parser, never the library.
