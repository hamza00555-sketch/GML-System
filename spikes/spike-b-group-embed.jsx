/**
 * GML Spike B — Group-before-Embed and metadata persistence (Illustrator).
 *
 * The storyboard tag has to survive being saved, closed and reopened, and it
 * cannot live on the PlacedItem because embed() deletes that object. This
 * proves the simpler ordering works — create the group, place into it, tag the
 * group, then embed — before M4 is built on it.
 *
 * It works only in documents it creates itself.
 *
 * Run: File > Scripts > Other Script…
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
        results[results.length] = { id: id, passed: passed };
        say((passed ? "[PASS] " : "[FAIL] ") + id);
        say("       " + detail);
    }

    var TOLERANCE = 0.5;              // points; an embed should not move artwork
    var TAGS_LAYER = "GML_TAGS";

    function boundsOf(item) {
        var b = item.geometricBounds;   // [left, top, right, bottom]
        return { l: b[0], t: b[1], r: b[2], b: b[3] };
    }

    function boundsDelta(a, b) {
        return Math.max(
            Math.abs(a.l - b.l), Math.abs(a.t - b.t),
            Math.abs(a.r - b.r), Math.abs(a.b - b.b)
        );
    }

    function tagSet(item, name, value) {
        for (var i = 0; i < item.tags.length; i++) {
            if (item.tags[i].name === name) { item.tags[i].value = value; return; }
        }
        var tag = item.tags.add();
        tag.name = name;
        tag.value = value;
    }

    function tagValue(item, name) {
        for (var i = 0; i < item.tags.length; i++) {
            if (item.tags[i].name === name) { return item.tags[i].value; }
        }
        return null;
    }

    var stamp = new Date().getTime();
    var rootPath = Folder.temp.fsName + "/gml-spike-b-" + stamp;
    var root = new Folder(rootPath);
    root.create();

    say("GML Spike B — Group-before-Embed (Illustrator)");
    say("Illustrator " + app.version);
    say("workspace: " + rootPath);
    say("");

    var posterFile = new File(rootPath + "/poster.png");
    var docFile = new File(rootPath + "/spike-b.ai");

    try {
        // ---- 1. produce a real raster poster ------------------------------
        // embed() converts "as needed": a vector would become several items,
        // so the poster must be raster. This generates one to place.
        var seed = app.documents.add(DocumentColorSpace.RGB, 320, 180);
        var swatch = seed.pathItems.rectangle(180, 0, 320, 180);
        var green = new RGBColor();
        green.red = 65; green.green = 211; green.blue = 126;
        swatch.fillColor = green;

        var pngOptions = new ExportOptionsPNG24();
        pngOptions.antiAliasing = true;
        pngOptions.transparency = false;
        pngOptions.artBoardClipping = true;
        seed.exportFile(posterFile, ExportType.PNG24, pngOptions);
        seed.close(SaveOptions.DONOTSAVECHANGES);

        check("B.0 raster poster produced", posterFile.exists, posterFile.fsName);

        // ---- 2. the sequence under test -----------------------------------
        var doc = app.documents.add(DocumentColorSpace.RGB, 600, 400);

        // (a) group first
        var group = doc.groupItems.add();

        // (b) place into it
        var placed = doc.placedItems.add();
        placed.file = posterFile;
        placed.position = [40, -40];

        var placedCountBefore = doc.placedItems.length;
        var itemCountBefore = doc.pageItems.length;

        // move() has been reported to duplicate items; moveToBeginning is the
        // safer call and the counts below would expose a duplicate anyway.
        placed.moveToBeginning(group);

        var duplicated = doc.pageItems.length > itemCountBefore;
        check(
            "B.1 moving the placed item into the group did not duplicate it",
            !duplicated,
            "page items " + itemCountBefore + " → " + doc.pageItems.length
        );

        // (c) tag the GROUP, never the placed item
        var instanceId = "inst_" + stamp;
        group.name = "GML: Fade Up Title";
        tagSet(group, "GML_ID", "gml_fade-up");
        tagSet(group, "GML_NAME", "Fade Up Title");
        tagSet(group, "GML_VERSION", "1.0.0");
        tagSet(group, "GML_INSTANCE", instanceId);

        var boundsBefore = boundsOf(group);
        var childrenBefore = group.pageItems.length;

        // (d) embed last
        placed.embed();

        var groupAlive = true;
        var childrenAfter = -1;
        var delta = -1;
        try {
            childrenAfter = group.pageItems.length;
            delta = boundsDelta(boundsBefore, boundsOf(group));
        } catch (eGroup) {
            groupAlive = false;
        }

        check(
            "B.2 the group survived embed()",
            groupAlive,
            groupAlive ? "group is still addressable" : "group reference was invalidated"
        );

        check(
            "B.3 the artwork stayed inside the group",
            groupAlive && childrenAfter >= 1,
            "children " + childrenBefore + " → " + childrenAfter
        );

        check(
            "B.4 metadata still on the group after embed",
            groupAlive && tagValue(group, "GML_ID") === "gml_fade-up",
            "GML_ID = " + (groupAlive ? String(tagValue(group, "GML_ID")) : "n/a")
        );

        check(
            "B.5 no visible shift from embedding",
            groupAlive && delta >= 0 && delta <= TOLERANCE,
            "max bounds delta " + (delta >= 0 ? delta.toFixed(3) : "n/a") + "pt (tolerance " + TOLERANCE + ")"
        );

        check(
            "B.6 placed item count dropped as expected",
            doc.placedItems.length < placedCountBefore,
            "placedItems " + placedCountBefore + " → " + doc.placedItems.length
        );

        // ---- 3. a badge on its own layer, for the approval toggle ---------
        var tagsLayer = doc.layers.add();
        tagsLayer.name = TAGS_LAYER;
        var badge = tagsLayer.textFrames.add();
        badge.contents = "Fade Up Title";
        badge.position = [40, -20];
        tagSet(badge, "GML_REF", instanceId);

        tagsLayer.visible = false;
        tagsLayer.printable = false;
        var hidden = tagsLayer.visible === false;
        var groupUnaffected = group.hidden === false;
        check(
            "B.7 hiding GML_TAGS is one atomic operation and leaves artwork alone",
            hidden && groupUnaffected,
            "layer hidden:" + hidden + "  group still visible:" + groupUnaffected
        );
        tagsLayer.visible = true;
        tagsLayer.printable = true;

        // ---- 4. save, close, reopen --------------------------------------
        var saveOptions = new IllustratorSaveOptions();
        doc.saveAs(docFile, saveOptions);
        doc.close(SaveOptions.SAVECHANGES);

        var reopened = app.open(docFile);

        var foundGroup = null;
        for (var g = 0; g < reopened.groupItems.length; g++) {
            if (tagValue(reopened.groupItems[g], "GML_INSTANCE") === instanceId) {
                foundGroup = reopened.groupItems[g];
                break;
            }
        }

        check(
            "B.8 GML_ID and GML_INSTANCE survive save → close → reopen",
            foundGroup !== null && tagValue(foundGroup, "GML_ID") === "gml_fade-up",
            foundGroup
                ? "found group '" + foundGroup.name + "' with its tags intact"
                : "no group carrying GML_INSTANCE was found after reopening"
        );

        // ---- 5. copy/paste and moving between artboards -------------------
        if (foundGroup) {
            var duplicate = foundGroup.duplicate();
            duplicate.position = [300, -40];
            check(
                "B.9 tags survive duplication",
                tagValue(duplicate, "GML_ID") === "gml_fade-up",
                "duplicate GML_ID = " + String(tagValue(duplicate, "GML_ID")) +
                " (note: GML_INSTANCE is copied too and must be reassigned on paste)"
            );
        }

        reopened.close(SaveOptions.DONOTSAVECHANGES);

    } catch (e) {
        check("B.x unexpected failure", false, String(e) + (e.line ? " (line " + e.line + ")" : ""));
    }

    var failed = 0;
    for (var r = 0; r < results.length; r++) { if (!results[r].passed) { failed++; } }

    say("");
    say("VERDICT: " + (failed === 0 ? "PASS" : "FAIL (" + failed + " check(s))"));
    say("");
    if (failed === 0) {
        say("Group-before-Embed holds. M4 uses it as the default ordering, and the");
        say("before/after detection fallback is not needed.");
    } else {
        say("Group-before-Embed did not hold. Fall back to detecting the resulting");
        say("item by comparing the document's items before and after embed(),");
        say("then moving that item into the group.");
    }
    say("");
    say("Workspace: " + rootPath);

    var report = lines.join("\n");
    try {
        var out = new File(Folder.desktop.fsName + "/gml-spike-b-report.txt");
        out.encoding = "UTF-8";
        out.open("w");
        out.write(report);
        out.close();
        report += "\n\nSaved to: " + out.fsName;
    } catch (eWrite) { /* the dialog still carries the result */ }

    showReport("GML Spike B — Group-before-Embed", report);
})();
