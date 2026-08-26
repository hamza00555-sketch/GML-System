# Spike C — Node.js and networking inside CEP

**Question:** can the panel run a loopback server, write to disk, and reach
Google over HTTPS?

**Why it matters:** the Drive provider needs all three. OAuth for a desktop app
works by redirecting to `127.0.0.1` on a random port, catching the code there,
and exchanging it over HTTPS; the refresh token then has to be written
somewhere. If any of those is unavailable inside CEP, the storage design has to
change.

**Time:** 2 minutes.

---

## Steps

1. Open the GML panel in **After Effects**.
2. Press **Diagnostics**.
3. Press **Node + playback**.
4. Read the **Node and playback** section.
5. Press **Copy report**.

---

## Expected result

```
[PASS] Node require()
       available
[PASS] Loopback HTTP server (OAuth redirect)
       bound 127.0.0.1:54321
[PASS] Writable user data directory
       /Users/you/.gml
[PASS] Outbound HTTPS to Google
       reachable (HTTP 404)
```

A `404` from `oauth2.googleapis.com/` is a **success** — it means the request
completed. Only a connection error is a failure.

---

## Pass / fail

| Check | Fails when | Consequence |
|-------|-----------|-------------|
| `require()` | `--enable-nodejs` was not applied | **Blocker.** No Drive client, no aerender, no ffmpeg. I would need to revisit the manifest. |
| Loopback server | A firewall or policy blocks listening sockets | OAuth cannot use a loopback redirect. Fallback: paste the authorisation code by hand — worse, but workable. |
| User data directory | Home directory is not writable | The refresh token cannot persist; sign-in every session. |
| Outbound HTTPS | A corporate proxy or filter intercepts it | **Blocker for Drive.** This is the one most likely to bite on a managed GOSI machine, and better to learn now than in M1. |

---

## If it fails, send me

- The **Copy report** text.
- For an HTTPS failure: whether the machine is behind a corporate proxy, and
  whether `https://oauth2.googleapis.com` opens in a normal browser on the same
  machine.

A proxy is not fatal — Node can be configured to use one — but I need to know
it exists before building the provider.
