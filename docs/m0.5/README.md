# M0.5 — Getting GML running in Adobe, and testing the risky assumptions

M0 is finished and tested, but every test so far ran in a browser. M0.5 exists
to answer one question: **do the assumptions GML is built on actually hold
inside real After Effects and Illustrator?**

Nothing from M1 onward should be built until they do.

## Order of work

| # | Step | Where | Time |
|---|------|-------|------|
| 1 | [Install the panels](./install.md) | Terminal | ~5 min |
| 2 | [Verify the panel in Adobe](./verification.md) | AE + Illustrator | ~15 min |
| 3 | [Spike E — media playback](./spike-e.md) | Panel | 2 min |
| 4 | [Spike C — Node and networking](./spike-c.md) | Panel | 2 min |
| 5 | [Spike B — Illustrator tagging](./spike-b.md) | Illustrator | ~5 min |
| 6 | [Spike A — the AE publish workflow](./spike-a.md) | After Effects | ~15 min |
| 7 | [Spike D — aerender and ffmpeg](./spike-d.md) | Terminal | ~5 min |

Steps 3 and 4 come first because they are the cheapest and they run inside the
panel you have just installed. Spike A is last because it is the longest and the
most consequential.

## What each spike decides

| Spike | Question | If it fails |
|-------|----------|-------------|
| **A** | Can a comp become a portable package without endangering the designer's open project? | **M3 is not built on this workflow.** Fall back to operating only on a copy the designer saves by hand. |
| **B** | Does an Illustrator tag survive embedding, saving and reopening? | M4 uses before/after detection instead of the simple ordering. |
| **C** | Does Node inside CEP give us a loopback server, disk and outbound HTTPS? | The Drive provider cannot be built as designed; storage needs rethinking. |
| **D** | Are `aerender` and `ffmpeg` available for headless previews? | Publishing needs previews supplied by hand in M3. |
| **E** | Does MP4/H.264 play inside CEP? | Previews are encoded as WebM/VP9 instead — decided **before** any asset is published. |

## Reporting back

Every spike writes a report file and prints a verdict. Send the report text,
not a screenshot — the detail lines are what identify the cause.

| Spike | Report |
|-------|--------|
| A1 / A2 | `gml-spike-a1-report.txt` (next to your project) / `gml-spike-a2-report.txt` (Desktop) |
| B | `gml-spike-b-report.txt` (Desktop) |
| C / E | Panel → Diagnostics → **Copy report** |
| D | Terminal output of `pnpm spike:d` |

## A note on scope

The panel installed here runs against a **mock library**, not Drive. Cards,
search, layout, language and the tag toggle are real; applying an asset reports
what it received and changes nothing. That is deliberate: M0.5 proves the
plumbing, and M1 fills it.
