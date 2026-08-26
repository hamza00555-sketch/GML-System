# Spike D — aerender and ffmpeg

**Question:** can previews be rendered without freezing the designer's session?

**Why it matters:** publishing an asset produces `preview.mp4`, `preview.gif`
and `poster.png`. Doing that inside the designer's own After Effects would lock
their session for the duration. `aerender` renders headlessly; `ffmpeg` encodes.
Neither ships with the panel.

**Time:** 5 minutes.

---

## Steps

```bash
pnpm spike:d
```

---

## Expected result

```
[PASS] D.1 aerender found
       /Applications/Adobe After Effects 2026/aerender
[PASS] D.2 aerender is executable
[PASS] D.3 ffmpeg found
[PASS] D.4 ffmpeg can encode H.264
[PASS] D.5 ffmpeg can encode GIF
[PASS] D.6 produced a real H.264 MP4
       12345 bytes at /tmp/gml-spike-d-…/probe.mp4

VERDICT: PASS
```

---

## Pass / fail

| Check | If it fails |
|-------|-------------|
| **D.1 / D.2** aerender | Publishing renders in the designer's own session instead, blocking them for the duration. Workable, but noticeably worse; worth reporting so I can decide with you. |
| **D.3** ffmpeg missing | Install it (`brew install ffmpeg`, or the official Windows build), or we bundle a build with the extension. Bundling carries LGPL obligations, so installing is preferable. |
| **D.4** no libx264 | Only WebM previews are possible. Combined with a Spike E pass, that would be an awkward mismatch — tell me and I will reconcile the two. |
| **D.5** no GIF encoder | The guaranteed fallback preview disappears. Low risk, since GIF support is near-universal. |
| **D.6** encode failed | Read the error — usually a missing shared library rather than ffmpeg itself. |

---

## Bonus: this produces a real MP4 for Spike E

If D.6 passes it prints a path to a genuine H.264 file. Copy it into the panel's
self-test folder to confirm actual playback rather than only `canPlayType`:

```bash
cp /tmp/gml-spike-d-*/probe.mp4 apps/ae-panel/selftest/control-h264.mp4
pnpm build && pnpm cep:install
```

Then reopen the panel. This turns Spike E from a capability query into a
demonstration.

---

## If it fails, send me

- The full terminal output of `pnpm spike:d`.
- Your After Effects version and where it is installed, if D.1 failed — the
  installation path varies and I can widen the search.
