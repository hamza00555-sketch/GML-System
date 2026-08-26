# Spike B — Illustrator tagging survives embedding

**Question:** if we create a group, place a poster inside it, tag the group, and
then embed the artwork — does the tag survive save, close and reopen?

**Why it matters:** the whole storyboard bridge depends on a tag that stays with
the image. The tag cannot live on the placed item itself, because `embed()`
deletes that object. The design puts it on a surrounding group instead, and this
proves that ordering works before M4 is written on top of it.

**Time:** 5 minutes. Safe — the script only touches documents it creates.

---

## Steps

1. Open **Illustrator**. No document needs to be open.
2. `File → Scripts → Other Script…`
3. Choose `spikes/spike-b-group-embed.jsx` from the repository.
4. A dialog opens with the report text already selected — press `Ctrl+C`
   (`Cmd+C` on macOS) to copy it, then send it to me. `gml-spike-b-report.txt`
   is also written to your Desktop.

---

## Expected result

```
[PASS] B.0 raster poster produced
[PASS] B.1 moving the placed item into the group did not duplicate it
[PASS] B.2 the group survived embed()
[PASS] B.3 the artwork stayed inside the group
[PASS] B.4 metadata still on the group after embed
[PASS] B.5 no visible shift from embedding
[PASS] B.6 placed item count dropped as expected
[PASS] B.7 hiding GML_TAGS is one atomic operation and leaves artwork alone
[PASS] B.8 GML_ID and GML_INSTANCE survive save → close → reopen
[PASS] B.9 tags survive duplication

VERDICT: PASS
```

---

## Pass / fail

**B.8 is the one that decides the feature.** If a tag does not survive reopening,
the storyboard bridge cannot work as designed and we would have to store the
mapping in a sidecar file instead of inside the `.ai`.

| Check | If it fails |
|-------|-------------|
| **B.1** duplication | `moveToBeginning` duplicates items in your version. M4 groups via the native menu command instead. Not serious. |
| **B.2 / B.3** group did not survive | The simple ordering does not hold. M4 falls back to comparing the document's items before and after `embed()` and moving the result into the group. Already planned as the fallback. |
| **B.4** metadata lost after embed | Tags are being dropped by embedding. Serious — I would move the metadata to the document's XMP and key it by group name. |
| **B.5** visible shift | Embedding moves artwork. The placement code would have to record and restore position. |
| **B.7** hide toggle | The approval feature does not work as designed. This one needs discussion before M4. |
| **B.8** tags lost on reopen | **Blocker for the bridge.** The mapping moves to a sidecar `.gml.json` keyed by position — significantly worse for the designer, so I would want to try alternatives first. |

Everything except B.8 has a known fallback that costs little.

---

## Also worth checking by hand

The script cannot judge appearance. After it finishes, in the reopened document:

- [ ] The green poster looks correct — not doubled, not offset, not clipped.
- [ ] The `GML: Fade Up Title` group appears in the Layers panel with that name.

---

## If it fails, send me

- `gml-spike-b-report.txt` from your Desktop.
- Your Illustrator version (`Help → About Illustrator`).
- For B.5, the reported bounds delta — a small number means a rounding issue,
  a large one means real movement.
