/**
 * GML Spike A2 — publish round trip.
 *
 * This is the decision that gates M3. It answers one question: can we take a
 * comp, reduce it to a self-contained package, and hand that package to another
 * machine without the designer losing the project they had open?
 *
 * It never operates on your work. It builds its own test project from scratch
 * in a temporary folder, complete with real footage files it renders itself,
 * and runs the full cycle on that. Your project is saved and reopened at the
 * end.
 *
 * Run: File > Scripts > Run Script File…
 */
(function () {
    /**
     * A native alert() box is not reliably copyable (Windows in particular
     * gives no text selection at all), so the final report is shown in a
     * ScriptUI dialog instead: a read-only, pre-selected text field. Ctrl+C /
     * Cmd+C copies the whole thing the moment the dialog opens.
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

    var lines = [];
    var results = [];
    function say(text) { lines[lines.length] = text; }
    function check(id, passed, detail) {
        results[results.length] = { id: id, passed: passed, detail: detail };
        say((passed ? "[PASS] " : "[FAIL] ") + id);
        say("       " + detail);
    }

    // ---- guard: never run over unsaved work -------------------------------
    var original = app.project.file;
    if (app.project.dirty) {
        alert(
            "GML Spike A2\n\n" +
            "Your project has unsaved changes. Save it (or close it) first — this\n" +
            "spike opens other projects and must not be the reason you lose work."
        );
        return;
    }

    var proceed = confirm(
        "GML Spike A2 — publish round trip\n\n" +
        "This will:\n" +
        "  · close the current project (already saved)\n" +
        "  · build a throwaway test project in a temp folder\n" +
        "  · run saveAs → reduceProject → collect → reopen on that test project\n" +
        "  · reopen your project at the end\n\n" +
        "Your files are not modified. Continue?"
    );
    if (!proceed) { return; }

    // ---- workspace --------------------------------------------------------
    var stamp = new Date().getTime();
    var rootPath = Folder.temp.fsName + "/gml-spike-a2-" + stamp;
    var root = new Folder(rootPath);
    root.create();

    var sourceDir = new Folder(rootPath + "/source-footage");
    sourceDir.create();
    var packageDir = new Folder(rootPath + "/package");
    packageDir.create();
    var footageDir = new Folder(rootPath + "/package/footage");
    footageDir.create();
    var elsewhere = new Folder(rootPath + "/moved");   // stands in for another machine

    say("GML Spike A2 — publish round trip");
    say("After Effects " + app.version);
    say("workspace: " + rootPath);
    say("");

    try {
        // ---- 1. build a test project with REAL footage files --------------
        app.newProject();

        var seedComp = app.project.items.addComp("seed", 320, 180, 1, 1, 25);
        var solid = seedComp.layers.addSolid([0.25, 0.83, 0.49], "seed-solid", 320, 180, 1);
        var text = seedComp.layers.addText("GML");
        text.property("Position").setValue([60, 110]);

        // saveFrameToPng gives us genuine image files on disk, which is what
        // makes the collect step meaningful — solids alone would prove nothing.
        var stillFile = new File(sourceDir.fsName + "/still.png");
        seedComp.saveFrameToPng(0, stillFile);

        var frames = 4;
        for (var f = 1; f <= frames; f++) {
            solid.property("Opacity").setValue(40 + f * 12);
            var frameNo = "000" + f;
            var seqFile = new File(sourceDir.fsName + "/seq_" + frameNo.substr(frameNo.length - 4) + ".png");
            seedComp.saveFrameToPng(f / 25, seqFile);
        }

        var wroteStill = stillFile.exists;
        var seqProbe = new File(sourceDir.fsName + "/seq_0001.png");
        check(
            "A2.0 test footage generated",
            wroteStill && seqProbe.exists,
            "still.png:" + wroteStill + "  seq_0001.png:" + seqProbe.exists + "  in " + sourceDir.fsName
        );

        // ---- 2. import it back as still + sequence ------------------------
        var stillOptions = new ImportOptions(stillFile);
        stillOptions.importAs = ImportAsType.FOOTAGE;
        stillOptions.sequence = false;
        var stillItem = app.project.importFile(stillOptions);

        var seqOptions = new ImportOptions(seqProbe);
        seqOptions.importAs = ImportAsType.FOOTAGE;
        seqOptions.sequence = true;
        seqOptions.forceAlphabetical = true;
        var seqItem = app.project.importFile(seqOptions);

        var seqFrames = Math.round(seqItem.duration * seqItem.frameRate);
        check(
            "A2.1 image sequence imported as a sequence",
            seqFrames >= 2,
            "sequence duration covers " + seqFrames + " frame(s); expected " + frames
        );

        // ---- 3. the comp we will "publish" --------------------------------
        var publish = app.project.items.addComp("GML_spike_candidate", 320, 180, 1, 2, 25);
        publish.layers.add(stillItem);
        publish.layers.add(seqItem);
        publish.layers.addSolid([0.1, 0.1, 0.1], "bg", 320, 180, 1);

        var testProjectFile = new File(rootPath + "/test-original.aep");
        app.project.save(testProjectFile);

        var sizeBefore = testProjectFile.length;
        var modifiedBefore = testProjectFile.modified.getTime();

        // ---- 4. the actual cycle under test -------------------------------
        var packageAep = new File(packageDir.fsName + "/source.aep");
        app.project.save(packageAep);            // saveAs: session now points at the copy
        app.project.reduceProject([publish]);    // destructive, hence the copy

        // Collect: copy each remaining file next to the project and re-point at it.
        var relinked = 0;
        var copied = 0;
        for (var i = app.project.numItems; i >= 1; i--) {
            var item = app.project.item(i);
            if (!(item instanceof FootageItem)) { continue; }
            if (!(item.mainSource instanceof FileSource)) { continue; }

            var src = item.mainSource.file;
            if (!src || !src.exists) { continue; }

            var isSequence = !item.mainSource.isStill && item.hasVideo && /\.png$/i.test(src.fsName);

            if (isSequence) {
                // Copy every frame, not just the one AE points at.
                var all = sourceDir.getFiles("seq_*.png");
                var firstCopy = null;
                for (var s = 0; s < all.length; s++) {
                    var dest = new File(footageDir.fsName + "/" + all[s].name);
                    all[s].copy(dest);
                    copied++;
                    if (firstCopy === null) { firstCopy = dest; }
                }
                if (firstCopy) {
                    item.replaceWithSequence(firstCopy, true);
                    relinked++;
                }
            } else {
                var single = new File(footageDir.fsName + "/" + src.name);
                src.copy(single);
                copied++;
                item.replace(single);
                relinked++;
            }
        }
        app.project.save();

        check(
            "A2.2 dependencies collected and relinked",
            relinked > 0 && copied >= frames,
            relinked + " item(s) relinked, " + copied + " file(s) copied into package/footage"
        );

        // Every required file must now live inside the package.
        var outside = [];
        for (var j = 1; j <= app.project.numItems; j++) {
            var it = app.project.item(j);
            if (!(it instanceof FootageItem)) { continue; }
            if (!(it.mainSource instanceof FileSource)) { continue; }
            var p = it.mainSource.file;
            if (!p) { continue; }
            if (String(p.fsName).indexOf(packageDir.fsName) !== 0) {
                outside[outside.length] = it.name + " → " + p.fsName;
            }
        }
        check(
            "A2.3 final portability check",
            outside.length === 0,
            outside.length === 0
                ? "every required file is inside the package"
                : "still outside: " + outside.join(" | ")
        );

        // ---- 5. the original test project must be untouched ---------------
        testProjectFile = new File(rootPath + "/test-original.aep");
        var unchanged =
            testProjectFile.exists &&
            testProjectFile.length === sizeBefore &&
            testProjectFile.modified.getTime() === modifiedBefore;
        check(
            "A2.4 pre-publish project untouched on disk",
            unchanged,
            unchanged
                ? "size and timestamp identical"
                : "CHANGED — size " + sizeBefore + "→" + testProjectFile.length
        );

        // ---- 6. portability: open the package from a different path -------
        packageDir.rename("moved");
        elsewhere = new Folder(rootPath + "/moved");
        var movedAep = new File(elsewhere.fsName + "/source.aep");

        app.open(movedAep);

        var missingAfterMove = 0;
        var missingNames = [];
        for (var k = 1; k <= app.project.numItems; k++) {
            var moved = app.project.item(k);
            if (moved instanceof FootageItem && moved.footageMissing) {
                missingAfterMove++;
                missingNames[missingNames.length] = moved.name;
            }
        }
        check(
            "A2.5 package opens from a different path with zero missing footage",
            missingAfterMove === 0,
            missingAfterMove === 0
                ? "0 missing after moving the package folder"
                : missingAfterMove + " missing: " + missingNames.join(", ")
        );

    } catch (e) {
        check("A2.x unexpected failure", false, String(e) + (e.line ? " (line " + e.line + ")" : ""));
    }

    // ---- 7. always give the designer their session back -------------------
    var restored = false;
    try {
        if (original && original.exists) {
            app.open(original);
            restored = app.project.file && app.project.file.fsName === original.fsName;
        } else {
            app.newProject();
            restored = true;
        }
    } catch (eRestore) {
        restored = false;
    }
    check(
        "A2.6 original session restored",
        restored,
        original ? (restored ? "reopened " + original.fsName : "COULD NOT REOPEN " + original.fsName)
                 : "there was no project open to restore"
    );

    // ---- verdict ----------------------------------------------------------
    var failed = 0;
    for (var r = 0; r < results.length; r++) { if (!results[r].passed) { failed++; } }

    say("");
    say("VERDICT: " + (failed === 0 ? "PASS" : "FAIL (" + failed + " check(s))"));
    say("");
    if (failed === 0) {
        say("The publish workflow is sound. M3 can be built on it.");
    } else {
        say("Do NOT build M3 on this workflow. The safe fallback is to require");
        say("the designer to Save As a copy manually, and have the panel operate");
        say("only on that copy.");
    }
    say("");
    say("Workspace left in place for inspection:");
    say("  " + rootPath);

    var report = lines.join("\n");
    try {
        var out = new File(Folder.desktop.fsName + "/gml-spike-a2-report.txt");
        out.encoding = "UTF-8";
        out.open("w");
        out.write(report);
        out.close();
        report += "\n\nSaved to: " + out.fsName;
    } catch (eWrite) { /* the dialog still carries the result */ }

    showReport("GML Spike A2 — Publish Round Trip", report);
})();
