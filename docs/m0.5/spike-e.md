# Spike E — Media playback inside CEP

**Question:** does MP4/H.264 play inside a CEP panel?

**Why it matters:** every preview in the library is encoded once. Discovering
after publishing a hundred assets that the format does not play would mean
re-rendering all of them. This is decided before a single asset exists.

**Time:** 2 minutes. Do this first — it is the cheapest.

---

## Steps

1. Open the GML panel in **After Effects**.
2. Press **Diagnostics** in the bottom corner.
3. Read the **Codec support** table.
4. Press **Node + playback** and wait for the WebM control clip result.
5. Press **Copy report**.
6. Repeat in **Illustrator**.

---

## Expected result

The rows marked ★ are the ones that matter:

```
★ MP4 · H.264 + AAC          probably
★ MP4 · H.264 video only     probably
  WebM · VP8                 probably
  WebM · VP9                 probably
★ MP3                        probably
```

and

```
[PASS] WebM VP8 control clip
       decoded 320×180, playing
```

`probably` and `maybe` both count as supported. An empty result, shown as
**no**, means the codec is absent from this build.

---

## Pass / fail

| Result | Verdict | What it means |
|--------|---------|---------------|
| Both ★ MP4 rows supported | **PASS** | MP4/H.264 stays the library format. Nothing changes. |
| MP4 rows **no**, WebM rows supported **and the control clip plays** | **FAIL — codec** | `<video>` works; H.264 is simply absent. Previews switch to **VP9/WebM** for the whole library. I make that change before M1. |
| MP4 **no**, WebM **no**, control clip fails | **FAIL — video** | `<video>` does not work in this CEP build at all. Previews fall back to `preview.gif`, which needs no codec. |
| MP3 **no** | **FAIL — audio** | Audio previews ship as WAV instead: larger, but universally decodable. |

The control clip is the discriminator. Without it, a failure to play MP4 could
mean either "no H.264" or "no video at all", and those have different fixes.

---

## If it fails, send me

- The **Copy report** text from **both** applications.
- The result differs between AE and Illustrator? Say so explicitly — that would
  mean the two ship different CEF builds, which changes the plan.

I will switch the preview encoder and update the packaging spec. No code you
have run needs to be discarded.
