# Spike A — The After Effects publish workflow

**This is the spike that decides M3.**

**Question:** can a composition be turned into a self-contained package that
opens with zero missing footage on another machine — without endangering the
project the designer has open?

**Why it matters:** publishing is the heart of the library. If the mechanism is
unreliable, building M3 on it would mean shipping something that occasionally
destroys a designer's work. That is not a risk worth taking, and there is a
safe fallback ready.

Spike A runs in two parts. **Do A1 first.** It cannot change anything.

---

# A1 — Collect probe (read-only)

Validates the footage classification against a real production project. It
opens nothing, saves nothing and modifies nothing.

## Steps

1. Open a **real, representative** GOSI project in After Effects — ideally one
   with a mix of video, stills, an image sequence, and audio.
2. `File → Scripts → Run Script File…`
3. Choose `spikes/spike-a1-probe-READONLY.jsx`.
4. Read the alert. A copy is written next to your project as
   `gml-spike-a1-report.txt`.
5. **Repeat on two or three different projects.** One project proves very little.

## Expected result

```
FOOTAGE (37 items)
  video: 12
  still: 8
  sequence: 3
  audio: 2
  solid: 12

MISSING (blocks publishing): 0
PROXIES (must be removed before collect): 0
```

## Pass / fail

| Result | Verdict |
|--------|---------|
| Every item lands in the category you would have chosen yourself | **PASS** |
| Anything is `unknown` | **FAIL** — an unhandled source type. Send me the report. |
| An image sequence is counted as `video` | **FAIL** — the numbering pattern was not recognised. Send me a sample filename. |
| A video is counted as `sequence` | **FAIL** — a false positive; it would be collected wrongly. |
| `MISSING` is non-zero on a project you consider healthy | Interesting either way — it may be finding real breakage, which is the feature working. |

This is the cheapest possible test of the classification logic, and it runs
against the real thing rather than fixtures.

---

# A2 — Publish round trip

Runs the full `saveAs → reduceProject → collect → reopen` cycle.

## Safety

The script **never operates on your project**. It:

- refuses to run if your project has unsaved changes;
- builds its own throwaway project in a temp folder, generating real PNG
  footage by rendering frames itself;
- runs the cycle on that;
- reopens your project at the end.

Even so: **save your work first.** This exercises the exact mechanism we are
unsure about, and that is the point.

## Steps

1. Save or close whatever you are working on.
2. `File → Scripts → Run Script File…`
3. Choose `spikes/spike-a2-roundtrip.jsx`.
4. Confirm the prompt.
5. Wait — it opens and closes several projects. Do not touch AE while it runs.
6. Read the alert; `gml-spike-a2-report.txt` is written to your Desktop.

## Expected result

```
[PASS] A2.0 test footage generated
[PASS] A2.1 image sequence imported as a sequence
[PASS] A2.2 dependencies collected and relinked
[PASS] A2.3 final portability check
[PASS] A2.4 pre-publish project untouched on disk
[PASS] A2.5 package opens from a different path with zero missing footage
[PASS] A2.6 original session restored

VERDICT: PASS
```

## Pass / fail

| Check | Meaning | If it fails |
|-------|---------|-------------|
| **A2.3** portability | Nothing required still points outside the package | Relinking is not working. M3 cannot produce portable packages as designed. |
| **A2.4** project untouched | `saveAs` did not modify the pre-publish file | The cycle mutates the file it was supposed to leave alone. **Serious** — this is the "endangers the designer's project" failure. |
| **A2.5** opens elsewhere | **The decisive test.** The package works on another machine | Packages are not portable. Everything downstream is undermined. |
| **A2.6** session restored | The designer gets their project back | The workflow loses people's work. **Immediate stop.** |

### If A2.3, A2.4 or A2.5 fails

**M3 is not built on this workflow.** The fallback is already planned: the panel
asks the designer to `Save As` a copy by hand, then operates only on that copy.
More friction, zero risk to the working project. I will re-plan M3 around it.

### If A2.6 fails

Report it immediately and note whether your project reopened correctly. This is
the one failure mode that could cost real work, and I would rather remove the
automatic path entirely than leave it in.

---

## Also worth checking by hand

The script reports facts, not feel. After A2 finishes:

- [ ] Your original project reopened, with the right comps.
- [ ] After Effects is not in a strange state — no phantom dialogs, no lock-ups.
- [ ] The Undo history being lost is **acceptable and expected**; anything worse
      is not.

Open the workspace folder the report names and look inside `moved/`:

- [ ] `source.aep` and a `footage/` folder are present.
- [ ] `footage/` holds **all four** `seq_000n.png` frames, not just the first.

---

## If it fails, send me

1. `gml-spike-a2-report.txt` from your Desktop.
2. Your After Effects version.
3. Whether your original project reopened correctly.
4. A listing of the workspace folder the report names.

Do not try to work around a failure — the fallback is a design decision, not a
bug to patch.
