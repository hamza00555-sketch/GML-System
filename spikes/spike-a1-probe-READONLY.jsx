/**
 * GML Spike A1 — Collect probe. READ-ONLY.
 *
 * Run this on a real, representative project. It changes nothing: it opens no
 * files, saves nothing, and modifies no item. It reports what the collect step
 * would do, which is how we find out whether the footage classification holds
 * up against real production projects before any code depends on it.
 *
 * Run: File > Scripts > Run Script File…
 */
(function () {
    /**
     * A native alert() box is not reliably copyable (Windows in particular
     * gives no text selection at all), so the report is shown in a ScriptUI
     * dialog instead: a read-only, pre-selected text field. Ctrl+C / Cmd+C
     * copies the whole thing the moment the dialog opens.
     */
    function showReport(title, text) {
        var win = new Window("dialog", title);
        win.orientation = "column";
        win.alignChildren = ["fill", "fill"];

        var box = win.add("edittext", undefined, text, { multiline: true, readonly: true, scrolling: true });
        box.preferredSize = [640, 460];

        var row = win.add("group");
        row.alignment = "fill";
        var hint = row.add("statictext", undefined, "Text is pre-selected — press Ctrl+C (Cmd+C on macOS) to copy.");
        hint.alignment = ["left", "center"];
        var closeBtn = row.add("button", undefined, "Close", { name: "ok" });
        closeBtn.alignment = ["right", "center"];

        win.center();
        box.active = true;
        try { box.textselection = text; } catch (eSel) { /* select-all not supported on every platform */ }

        win.show();
    }

    var STILL_EXT = ",png,jpg,jpeg,tif,tiff,exr,dpx,tga,hdr,bmp,gif,";

    function extensionOf(name) {
        var dot = name.lastIndexOf(".");
        return dot === -1 ? "" : name.substring(dot + 1).toLowerCase();
    }

    function baseName(path) {
        var parts = path.split(/[\\\/]/);
        return parts[parts.length - 1];
    }

    /**
     * A sequence is only claimed when neighbouring frames confirm the pattern.
     * isStill===false alone covers video and audio too, and would misclassify.
     */
    function sequenceMembers(file) {
        var name = baseName(file.fsName);
        var match = /^(.*?)(\d+)(\.[^.]+)$/.exec(name);
        if (!match) { return 0; }

        var prefix = match[1], digits = match[2].length, suffix = match[3];
        var folder = file.parent;
        if (!folder || !folder.exists) { return 0; }

        var siblings = folder.getFiles();
        var count = 0;
        for (var i = 0; i < siblings.length; i++) {
            var sibling = baseName(siblings[i].fsName);
            if (sibling.length !== prefix.length + digits + suffix.length) { continue; }
            if (sibling.substring(0, prefix.length) !== prefix) { continue; }
            if (sibling.substring(sibling.length - suffix.length) !== suffix) { continue; }
            var middle = sibling.substring(prefix.length, prefix.length + digits);
            if (/^\d+$/.test(middle)) { count++; }
        }
        return count;
    }

    function classify(item) {
        var source = item.mainSource;

        if (source instanceof PlaceholderSource) { return { klass: "MISSING", note: "placeholder" }; }
        if (source instanceof SolidSource) { return { klass: "solid", note: "no file" }; }
        if (!(source instanceof FileSource)) { return { klass: "unknown", note: "unrecognised source" }; }
        if (item.footageMissing) { return { klass: "MISSING", note: String(source.missingFootagePath) }; }

        var file = source.file;
        if (!file) { return { klass: "MISSING", note: "FileSource with no file" }; }

        if (item.hasAudio && !item.hasVideo) { return { klass: "audio", note: "replace()" }; }
        if (source.isStill) { return { klass: "still", note: "replace()" }; }

        var ext = extensionOf(baseName(file.fsName));
        if (STILL_EXT.indexOf("," + ext + ",") !== -1) {
            var members = sequenceMembers(file);
            if (members >= 2) {
                return { klass: "sequence", note: "replaceWithSequence(), " + members + " frames" };
            }
            return { klass: "video", note: "replace() — image extension but no sequence pattern" };
        }
        return { klass: "video", note: "replace()" };
    }

    var lines = [];
    function say(text) { lines[lines.length] = text; }

    say("GML Spike A1 — collect probe (read-only)");
    say("After Effects " + app.version);
    say("project: " + (app.project.file ? app.project.file.fsName : "UNSAVED"));
    say("");

    var counts = {};
    var missing = [];
    var proxies = [];
    var externalRoots = {};
    var fonts = {};
    var thirdParty = {};
    var total = 0;

    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);

        if (item instanceof FootageItem) {
            total++;
            var verdict = classify(item);
            counts[verdict.klass] = (counts[verdict.klass] || 0) + 1;
            if (verdict.klass === "MISSING") { missing[missing.length] = item.name + " — " + verdict.note; }

            if (item.mainSource instanceof FileSource && item.mainSource.file) {
                var folder = item.mainSource.file.parent;
                var key = folder ? folder.fsName : "?";
                externalRoots[key] = (externalRoots[key] || 0) + 1;
            }
        }

        // A proxy is a local convenience; if one survives collect it becomes an
        // external dependency that breaks the package elsewhere.
        if (item.useProxy) { proxies[proxies.length] = item.name; }

        if (item instanceof CompItem) {
            for (var L = 1; L <= item.numLayers; L++) {
                var layer = item.layer(L);

                try {
                    if (layer instanceof TextLayer) {
                        var font = layer.property("Source Text").value.font;
                        if (font) { fonts[String(font)] = true; }
                    }
                } catch (eText) { /* some text layers refuse to report a font */ }

                try {
                    var effects = layer.property("ADBE Effect Parade");
                    if (effects) {
                        for (var E = 1; E <= effects.numProperties; E++) {
                            var match = effects.property(E).matchName;
                            // Everything Adobe ships is prefixed "ADBE ".
                            if (String(match).indexOf("ADBE ") !== 0) { thirdParty[String(match)] = true; }
                        }
                    }
                } catch (eFx) { /* layer types without an effect parade */ }
            }
        }
    }

    say("FOOTAGE (" + total + " items)");
    for (var klass in counts) {
        if (counts.hasOwnProperty(klass)) { say("  " + klass + ": " + counts[klass]); }
    }

    say("");
    say("MISSING (blocks publishing): " + missing.length);
    for (var m = 0; m < missing.length; m++) { say("  " + missing[m]); }

    say("");
    say("PROXIES (must be removed before collect): " + proxies.length);
    for (var p = 0; p < proxies.length; p++) { say("  " + proxies[p]); }

    say("");
    say("SOURCE FOLDERS (each becomes footage/ after collect)");
    for (var root in externalRoots) {
        if (externalRoots.hasOwnProperty(root)) { say("  " + externalRoots[root] + "x  " + root); }
    }

    say("");
    var fontList = [];
    for (var f in fonts) { if (fonts.hasOwnProperty(f)) { fontList[fontList.length] = f; } }
    say("FONTS (warning, not a blocker): " + fontList.length);
    for (var fi = 0; fi < fontList.length; fi++) { say("  " + fontList[fi]); }

    say("");
    var pluginList = [];
    for (var t in thirdParty) { if (thirdParty.hasOwnProperty(t)) { pluginList[pluginList.length] = t; } }
    say("THIRD-PARTY EFFECTS (warning, not a blocker): " + pluginList.length);
    for (var pi = 0; pi < pluginList.length; pi++) { say("  " + pluginList[pi]); }

    say("");
    say("VERDICT");
    say("  Classification ran over " + total + " footage items without error.");
    say("  PASS if every item above is in the category you expected.");
    say("  FAIL if anything is labelled 'unknown', or a sequence was read as a");
    say("  single file, or a video was read as a sequence.");

    var report = lines.join("\n");

    // Written next to the project so it is easy to find and send back.
    try {
        var out = new File(
            (app.project.file ? app.project.file.parent.fsName : Folder.desktop.fsName) +
            "/gml-spike-a1-report.txt"
        );
        out.encoding = "UTF-8";
        out.open("w");
        out.write(report);
        out.close();
        report += "\n\nSaved to: " + out.fsName;
    } catch (eWrite) {
        report += "\n\n(Could not write the report file: " + eWrite + ")";
    }

    showReport("GML Spike A1 — Collect Probe", report);
})();
