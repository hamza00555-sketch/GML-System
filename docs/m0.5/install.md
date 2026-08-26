# Installing the GML panels

## Requirements

- macOS or Windows — the installer cannot run on Linux, because there is no
  Adobe host there.
- After Effects 2019 or newer, Illustrator 2019 or newer.
- Node 20+ and pnpm 10+.

## One command

```bash
pnpm install
pnpm cep:install
```

That builds both panels, links them into your per-user CEP extensions folder,
enables `PlayerDebugMode`, and writes the `.debug` file used for remote
DevTools.

Then:

1. **Quit After Effects and Illustrator completely.** Extensions are read at
   launch; a running app will not pick up a new one.
2. Reopen them.
3. `After Effects → Window → Extensions → GML`
4. `Illustrator → Window → Extensions → GML`

## What it does, and why each part is needed

**Links into `~/Library/Application Support/Adobe/CEP/extensions`** (macOS) or
`%APPDATA%\Adobe\CEP\extensions` (Windows). A symlink means `pnpm build` is
enough to pick up a change — no reinstall. Windows blocks symlinks unless
Developer Mode is on, so the installer falls back to copying and tells you.

**Sets `PlayerDebugMode` for CSXS 9 through 12.** Adobe refuses to load an
unsigned extension unless this is set, and it is set *per CEP major version*.
Since the CEP version depends on which Adobe releases are installed, all four
are set. Without this the panel is filtered out silently — no error, it simply
never appears in the menu.

On macOS the installer also runs `killall cfprefsd`, because macOS caches
preference files and the change would otherwise take an unpredictable amount of
time to be noticed.

**Writes `.debug`** so you can open the running panel in Chrome DevTools at
`http://localhost:8088` (After Effects) or `http://localhost:8089`
(Illustrator). This is how you read console errors from inside Adobe.

## If GML does not appear in the menu

```bash
pnpm cep:doctor
```

It reports whether debug mode is set, whether the build output is complete, and
what is actually installed in the extensions folder.

The usual causes, in order of likelihood:

1. **The app was not fully quit.** Not just the document — the application.
2. **`PlayerDebugMode` did not take.** On macOS, log out and back in. On
   Windows, confirm the registry value is a *string* named `PlayerDebugMode`
   with value `1` under `HKCU\Software\Adobe\CSXS.11`.
3. **The build is stale or incomplete.** Run `pnpm build`, then
   `pnpm cep:install` again.
4. **Your Adobe version is outside the manifest range.** The manifests accept
   After Effects 16.0+ and Illustrator 23.0+. Tell me your version and I will
   widen it.

### Setting debug mode by hand

macOS:

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

Windows:

```cmd
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

## Removing it

```bash
pnpm cep:uninstall
```

`PlayerDebugMode` is left enabled — it is a global developer setting, and
turning it off would break any other unsigned extension you have.
