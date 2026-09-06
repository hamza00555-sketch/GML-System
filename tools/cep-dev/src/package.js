import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CSXS_VERSIONS, DEBUG_PORTS } from "./paths.js";

/**
 * Produces a self-contained folder (and zip) a designer can install without
 * Node, pnpm or the repository: the two built panels under their extension
 * ids, one-click install scripts per platform, the spike scripts, and a guide.
 *
 * This is the unsigned developer distribution. The signed ZXP for the pilot is
 * M6 work and goes through a different path.
 */

const PANELS = [
  { dir: "ae-panel", folder: "com.gosi.gml.ae", host: "AEFT" },
  { dir: "ai-panel", folder: "com.gosi.gml.ai", host: "ILST" },
];

const debugCommandsMac = CSXS_VERSIONS.map((v) => `defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`).join("\n");
const debugCommandsWin = CSXS_VERSIONS.map(
  (v) => `reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul`,
).join("\n");

const INSTALL_MAC = `#!/bin/bash
# GML — install the After Effects and Illustrator panels (macOS)
# Double-click this file. If macOS refuses, right-click → Open.
set -e
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$DEST"

echo "GML — installing panels"
echo "========================"
echo
echo "1/3 Enabling PlayerDebugMode (lets Adobe load an unsigned extension)"
${debugCommandsMac}
killall cfprefsd 2>/dev/null || true

echo "2/3 Copying panels to:"
echo "    $DEST"
for id in ${PANELS.map((p) => p.folder).join(" ")}; do
  rm -rf "$DEST/$id"
  cp -R "extensions/$id" "$DEST/$id"
  echo "    ✓ $id"
done

echo "3/3 Done."
echo
echo "Now QUIT After Effects and Illustrator completely, reopen them, and look in:"
echo "    Window → Extensions → GML"
echo
echo "If the panel does not appear, log out of macOS and back in (preference cache), then try again."
read -n 1 -s -r -p "Press any key to close."
`;

const INSTALL_WIN = `@echo off
rem GML - install the After Effects and Illustrator panels (Windows)
rem Double-click this file. No administrator rights are needed.
setlocal
cd /d "%~dp0"
set "DEST=%APPDATA%\\Adobe\\CEP\\extensions"
if not exist "%DEST%" mkdir "%DEST%"

echo GML - installing panels
echo ========================
echo.
echo 1/3 Enabling PlayerDebugMode (lets Adobe load an unsigned extension)
${debugCommandsWin}

echo 2/3 Copying panels to:
echo     %DEST%
${PANELS.map(
  (p) => `if exist "%DEST%\\${p.folder}" rmdir /s /q "%DEST%\\${p.folder}"
xcopy /e /i /q /y "extensions\\${p.folder}" "%DEST%\\${p.folder}" >nul
echo     [ok] ${p.folder}`,
).join("\n")}

echo 3/3 Done.
echo.
echo Now QUIT After Effects and Illustrator completely, reopen them, and look in:
echo     Window ^> Extensions ^> GML
echo.
pause
`;

const UNINSTALL_MAC = `#!/bin/bash
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"
for id in ${PANELS.map((p) => p.folder).join(" ")}; do rm -rf "$DEST/$id" && echo "removed $id"; done
read -n 1 -s -r -p "Press any key to close."
`;

const UNINSTALL_WIN = `@echo off
set "DEST=%APPDATA%\\Adobe\\CEP\\extensions"
${PANELS.map((p) => `if exist "%DEST%\\${p.folder}" rmdir /s /q "%DEST%\\${p.folder}" && echo removed ${p.folder}`).join("\n")}
pause
`;

const README_AR = `# GML — تركيب البلقنات على After Effects وIllustrator

هذه نسخة تطوير غير موقّعة (M0.5). لا تحتاج Node ولا pnpm ولا المستودع — كل شيء جاهز هنا.

## التركيب — خطوة واحدة

**Windows:** انقر مرتين على \`install-windows.bat\`
**macOS:** انقر مرتين على \`install-macos.command\`
(لو رفض macOS فتحه: كليك يمين → Open → Open)

السكربت يعمل شيئين:
1. يفعّل \`PlayerDebugMode\` — بدونه أدوبي يتجاهل أي إضافة غير موقّعة **بصمت** ولا تظهر في القائمة أبداً.
2. ينسخ مجلدي البلقن إلى مجلد إضافات CEP الخاص بحسابك.

بعدها:
1. **أغلق After Effects وIllustrator بالكامل** — البرنامج نفسه، ليس الملف فقط. الإضافات تُقرأ عند التشغيل.
2. افتحهما من جديد.
3. \`Window → Extensions → GML\`

## إعداد إلزامي في After Effects (مرة واحدة)

سكربتات الاختبار تكتب تقريراً على القرص، وAE يمنع ذلك افتراضياً:

\`Edit → Preferences → Scripting & Expressions → ✅ Allow Scripts to Write Files and Access Network\`
(على macOS: \`After Effects → Settings → Scripting & Expressions\`)

بدون هذا الخيار تظهر رسالة خطأ عند تشغيل Spike A، ولا يُكتب التقرير.

## تشغيل سكربتات الاختبار (Spikes)

الملفات في مجلد \`spikes/\`. كل سكربت يفتح في النهاية نافذة فيها التقرير **والنص محدد مسبقاً** — اضغط \`Ctrl+C\` (\`Cmd+C\`) وأرسله لي.

### الترتيب المقترح (الأرخص أولاً)

| # | أين | ماذا |
|---|---|---|
| 1 | البلقن في **AE ثم Illustrator** | \`Diagnostics\` → \`Node + playback\` → \`Copy report\` — أرسل التقريرين |
| 2 | Illustrator | \`File → Scripts → Other Script…\` → \`spike-b-group-embed.jsx\` |
| 3 | After Effects — على مشروع حقيقي | \`File → Scripts → Run Script File…\` → \`spike-a1-probe-READONLY.jsx\` — **لا يعدّل شيئاً**. كرّره على 2–3 مشاريع |
| 4 | After Effects — أي مشروع **محفوظ** | \`spike-a2-roundtrip.jsx\` — يبني مشروعاً مؤقتاً خاصاً به ويعيد فتح مشروعك في النهاية |

Spike D (aerender + ffmpeg) يحتاج Node؛ نتركه للأخير أو أشغّله أنا لاحقاً بمعلومات منك.

## لو البلقن ما ظهر في القائمة

بالترتيب حسب الاحتمال:

1. البرنامج ما أُغلق بالكامل.
2. \`PlayerDebugMode\` ما انطبق — على macOS: سجّل خروج ودخول. على Windows: تأكد أن القيمة نصية (\`REG_SZ\`) اسمها \`PlayerDebugMode\` وقيمتها \`1\` تحت \`HKCU\\Software\\Adobe\\CSXS.11\` و\`CSXS.12\`.
3. إصدارك خارج النطاق — البلقن يقبل After Effects 16+ (CC 2019) وIllustrator 23+ (CC 2019). أرسل لي رقم الإصدار.
4. تأكد أن المجلدين موجودان فعلاً:
   - Windows: \`%APPDATA%\\Adobe\\CEP\\extensions\\com.gosi.gml.ae\`
   - macOS: \`~/Library/Application Support/Adobe/CEP/extensions/com.gosi.gml.ae\`

## لو البلقن ظهر لكنه فارغ أو فيه خطأ

افتح المتصفح على:
- After Effects: \`http://localhost:${DEBUG_PORTS.AEFT}\`
- Illustrator: \`http://localhost:${DEBUG_PORTS.ILST}\`

يفتح DevTools للبلقن الشغّال. انسخ لي ما في تبويب Console.

## الإزالة

\`uninstall-windows.bat\` أو \`uninstall-macos.command\`. يترك \`PlayerDebugMode\` مفعّلاً لأنه إعداد عام للمطورين.
`;

export function packageExtensions({ repoRoot }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const releaseDir = path.join(repoRoot, "release");
  const name = `GML-Extensions-${stamp}`;
  const out = path.join(releaseDir, name);

  console.log("\nGML — packaging distributable\n" + "=".repeat(38));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "extensions"), { recursive: true });

  for (const panel of PANELS) {
    const dist = path.join(repoRoot, "apps", panel.dir, "dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      console.log(`  ✕ ${panel.dir}/dist missing — run "pnpm build" first.`);
      return 1;
    }
    fs.cpSync(dist, path.join(out, "extensions", panel.folder), { recursive: true });
    console.log(`  ✓ extensions/${panel.folder}`);
  }

  fs.cpSync(path.join(repoRoot, "spikes"), path.join(out, "spikes"), { recursive: true });
  console.log("  ✓ spikes/");

  const write = (file, body, mode) => {
    fs.writeFileSync(path.join(out, file), body, { encoding: "utf8", mode });
    console.log(`  ✓ ${file}`);
  };
  write("install-macos.command", INSTALL_MAC, 0o755);
  write("uninstall-macos.command", UNINSTALL_MAC, 0o755);
  write("install-windows.bat", INSTALL_WIN.replace(/\n/g, "\r\n"));
  write("uninstall-windows.bat", UNINSTALL_WIN.replace(/\n/g, "\r\n"));
  write("README.ar.md", README_AR);

  const zip = path.join(releaseDir, `${name}.zip`);
  fs.rmSync(zip, { force: true });
  try {
    execFileSync("zip", ["-qr", zip, name], { cwd: releaseDir, stdio: "inherit" });
    console.log(`\n  → ${zip}`);
  } catch {
    console.log(`\n  (zip not available — folder is ready at ${out})`);
  }
  return 0;
}
