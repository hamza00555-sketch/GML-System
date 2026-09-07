/**
 * After Effects host functions.
 *
 * Reads never modify the project. gmlApply imports fully materialised local
 * files (never anything on the Shared Drive) and adds layers inside one undo
 * group. gmlInspectAep reads the comps out of a project file on disk so the
 * indexer can expand master projects without opening them.
 */

function gmlHostInfo() {
    try {
        return gmlOk({
            app: "AEFT",
            version: String(app.version),
            buildName: String(app.buildName),
            language: String(app.isoLanguage),
            projectPath: app.project.file ? String(app.project.file.fsName) : null,
            numItems: app.project.numItems
        });
    } catch (e) {
        return gmlErr("gmlHostInfo failed", e);
    }
}

function gmlGetTarget() {
    try {
        var item = app.project.activeItem;
        if (item && item instanceof CompItem) {
            var selected = item.selectedLayers;
            if (selected && selected.length > 0) {
                return gmlOk({ kind: "layer", name: String(selected[0].name) });
            }
            return gmlOk({ kind: "comp", name: String(item.name) });
        }
        return gmlOk({ kind: "none", name: "" });
    } catch (e) {
        return gmlErr("gmlGetTarget failed", e);
    }
}

/**
 * What is installed here, so the panel can mark a comp Requires Font or
 * Requires Plugin before anyone tries to apply it.
 */
function gmlGetEnvironment() {
    var fonts = [];
    var effects = [];

    try {
        // app.fonts arrived in After Effects 24; older versions report nothing,
        // which the panel treats as "unknown" rather than "missing".
        //
        // allFonts is documented as an array of arrays — one inner array per
        // font family — so each entry must be unwrapped.
        if (app.fonts && app.fonts.allFonts) {
            var all = app.fonts.allFonts;
            for (var i = 0; i < all.length; i++) {
                var family = all[i] instanceof Array ? all[i] : [all[i]];
                for (var k = 0; k < family.length; k++) {
                    var name = family[k] && family[k].postScriptName;
                    if (name) { fonts[fonts.length] = String(name); }
                }
            }
        }
    } catch (e) { /* leave fonts empty — unknown, not missing */ }

    try {
        for (var j = 0; j < app.effects.length; j++) {
            effects[effects.length] = String(app.effects[j].matchName);
        }
    } catch (e2) { /* same */ }

    return gmlOk({ fonts: fonts, effectMatchNames: effects });
}

// ---------------------------------------------------------------------------
// Stamps — gml:<id>@v<n> in comments; how reuse, pinning and updates work.
// ---------------------------------------------------------------------------

function gmlStampIn(comment) {
    var text = String(comment || "");
    var match = /gml:[a-z0-9][a-z0-9._\-\/]*@v\d+/.exec(text);
    return match ? match[0] : null;
}

/** Every stamp in the project: on items and on layers. */
function gmlProjectStamps() {
    try {
        var seen = {};
        var out = [];
        function add(comment) {
            var stamp = gmlStampIn(comment);
            if (stamp && !seen[stamp]) { seen[stamp] = true; out[out.length] = stamp; }
        }
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            try { add(item.comment); } catch (eI) { /* folders without comments */ }
            if (item instanceof CompItem) {
                for (var L = 1; L <= item.numLayers; L++) {
                    try { add(item.layer(L).comment); } catch (eL) { /* ignore */ }
                }
            }
        }
        return gmlOk({ stamps: out });
    } catch (e) {
        return gmlErr("gmlProjectStamps failed", e);
    }
}

function gmlFindItemByStamp(stamp) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        try {
            if (gmlStampIn(item.comment) === stamp && !(item instanceof FolderItem)) { return item; }
        } catch (e) { /* ignore */ }
    }
    return null;
}

function gmlLibraryFolder() {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem && item.name === "GML Library") { return item; }
    }
    return app.project.items.addFolder("GML Library");
}

function gmlCollectComps(container, out) {
    if (container instanceof CompItem) { out[out.length] = container; return; }
    if (!(container instanceof FolderItem)) { return; }
    for (var i = 1; i <= container.numItems; i++) { gmlCollectComps(container.item(i), out); }
}

function gmlFindCompIn(container, name) {
    var comps = [];
    gmlCollectComps(container, comps);
    for (var i = 0; i < comps.length; i++) { if (comps[i].name === name) { return comps[i]; } }
    return comps.length > 0 ? comps[0] : null;
}

// ---------------------------------------------------------------------------
// Apply — import the local file and add it to the active comp.
// ---------------------------------------------------------------------------

function gmlApplyAlpha(item, alpha) {
    if (alpha !== "straight" && alpha !== "premultiplied") { return; }
    try {
        var source = item.mainSource;
        if (source && source.hasAlpha) {
            source.alphaMode = alpha === "straight" ? AlphaMode.STRAIGHT : AlphaMode.PREMULTIPLIED;
        }
    } catch (e) { /* AE will keep its own guess */ }
}

/**
 * payload.items: [{ id, version, kind, name, localPath, alpha, compName }]
 *
 * Every localPath is a complete file in the local cache. An item already
 * stamped gml:<id>@v<n> in the project is reused, so applying twice never
 * yields "Coin 2"; a different version of the same id is left alone and the
 * requested one is imported alongside — never a silent update.
 */
function gmlApply(payload) {
    var items = payload && payload.items ? payload.items : [];
    if (items.length === 0) { return gmlErr("Nothing to apply"); }

    var target = app.project.activeItem;
    if (!target || !(target instanceof CompItem)) {
        return gmlErr("Open a composition (or select one in the Project panel) before applying.");
    }

    var added = [], reused = [], imported = [], warnings = [];
    app.beginUndoGroup("GML Apply");
    try {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var stamp = "gml:" + it.id + "@v" + it.version;
            var file = new File(it.localPath);
            if (!file.exists) {
                throw new Error("Not in the local cache: " + file.fsName + " — fetch it first.");
            }

            var projectItem = gmlFindItemByStamp(stamp);
            if (projectItem) {
                reused[reused.length] = String(projectItem.name);
            } else {
                var importedItem = app.project.importFile(new ImportOptions(file));
                if (it.kind === "comp") {
                    projectItem = gmlFindCompIn(importedItem, it.compName);
                    if (!projectItem) { throw new Error("No composition named \"" + it.compName + "\" in " + file.displayName); }
                    if (importedItem instanceof FolderItem) {
                        importedItem.name = "GML " + it.name + " v" + it.version;
                        importedItem.comment = stamp;
                        importedItem.parentFolder = gmlLibraryFolder();
                    }
                } else {
                    projectItem = importedItem;
                    projectItem.name = it.name + " v" + it.version;
                    projectItem.parentFolder = gmlLibraryFolder();
                    gmlApplyAlpha(projectItem, it.alpha);
                }
                projectItem.comment = stamp;
                imported[imported.length] = String(projectItem.name);
            }

            if (projectItem instanceof CompItem && projectItem.id === target.id) {
                warnings[warnings.length] = "Skipped " + it.name + ": cannot add a comp into itself.";
                continue;
            }

            var layer = target.layers.add(projectItem);
            layer.startTime = target.time;
            layer.comment = stamp;
            layer.name = String(it.name);
            added[added.length] = String(layer.name);
        }
    } catch (e) {
        app.endUndoGroup();
        return gmlErr("Apply failed", e);
    }
    app.endUndoGroup();

    var summary = added.length + " layer(s) added to " + target.name;
    if (reused.length > 0) { summary += " · reused " + reused.length; }
    if (imported.length > 0) { summary += " · imported " + imported.length; }
    return gmlOk({
        applied: true,
        added: added,
        reused: reused,
        imported: imported,
        warnings: warnings,
        message: summary + (warnings.length > 0 ? " · " + warnings.join(" ") : "")
    });
}

// ---------------------------------------------------------------------------
// Inspection — comps inside a project file, for the indexer.
// ---------------------------------------------------------------------------

function gmlFootageSnapshot(item) {
    var source = item.mainSource;
    var snap = { name: String(item.name), sourceKind: "file" };
    if (source instanceof PlaceholderSource) { snap.sourceKind = "placeholder"; return snap; }
    if (source instanceof SolidSource) { snap.sourceKind = "solid"; return snap; }
    if (source.file) { snap.filePath = String(source.file.fsName); }
    if (item.footageMissing) { snap.missing = true; }
    return snap;
}

/** Everything reachable from one comp: nested comps are followed. */
function gmlWalkComp(comp) {
    var seen = {};
    var footageById = {};
    var footage = [];
    var fonts = {};
    var effects = {};

    function walk(c) {
        if (seen[c.id]) { return; }
        seen[c.id] = true;
        for (var L = 1; L <= c.numLayers; L++) {
            var layer = c.layer(L);
            try {
                var src = layer.source;
                if (src instanceof CompItem) { walk(src); }
                else if (src instanceof FootageItem && !footageById[src.id]) {
                    footageById[src.id] = true;
                    footage[footage.length] = gmlFootageSnapshot(src);
                }
            } catch (eSrc) { /* light/camera layers have no source */ }
            try {
                if (layer instanceof TextLayer) {
                    var font = layer.property("Source Text").value.font;
                    if (font) { fonts[String(font)] = true; }
                }
            } catch (eText) { /* some text layers refuse to report a font */ }
            try {
                var parade = layer.property("ADBE Effect Parade");
                if (parade) {
                    for (var E = 1; E <= parade.numProperties; E++) {
                        effects[String(parade.property(E).matchName)] = true;
                    }
                }
            } catch (eFx) { /* layer types without an effect parade */ }
        }
    }
    walk(comp);

    var fontList = [];
    for (var f in fonts) { if (fonts.hasOwnProperty(f)) { fontList[fontList.length] = f; } }
    var effectList = [];
    for (var m in effects) { if (effects.hasOwnProperty(m)) { effectList[effectList.length] = m; } }
    return { footage: footage, fonts: fontList, effects: effectList };
}

/**
 * Reads the comps inside a project file on disk without opening it: the file
 * is imported into the current project as a folder, read, and removed again,
 * inside one undo group and with dialogs suppressed.
 */
function gmlInspectAep(payload) {
    var path = payload && payload.path;
    if (!path) { return gmlErr("No path given"); }
    var file = new File(path);
    if (!file.exists) { return gmlErr("File not found: " + file.fsName); }

    var imported = null;
    app.beginUndoGroup("GML Inspect");
    try { app.beginSuppressDialogs(); } catch (eS) { /* older hosts */ }
    try {
        imported = app.project.importFile(new ImportOptions(file));
        var comps = [];
        gmlCollectComps(imported, comps);

        var result = [];
        for (var i = 0; i < comps.length; i++) {
            var comp = comps[i];
            var deps = gmlWalkComp(comp);
            result[result.length] = {
                compName: String(comp.name),
                fps: comp.frameRate,
                width: comp.width,
                height: comp.height,
                duration: comp.duration,
                numLayers: comp.numLayers,
                fonts: deps.fonts,
                effects: deps.effects
            };
        }

        imported.remove();
        imported = null;
        try { app.endSuppressDialogs(false); } catch (eE) { /* older hosts */ }
        app.endUndoGroup();
        return gmlOk({ path: String(file.fsName), comps: result });
    } catch (e) {
        try { if (imported) { imported.remove(); } } catch (eR) { /* best effort */ }
        try { app.endSuppressDialogs(false); } catch (eE2) { /* older hosts */ }
        app.endUndoGroup();
        return gmlErr("gmlInspectAep failed", e);
    }
}

/** Shows a file in Finder / Explorer — used for "show source". */
function gmlReveal(payload) {
    try {
        var path = payload && payload.path;
        var file = new File(path);
        var folder = file.exists ? file.parent : new Folder(path);
        if (!folder || !folder.exists) { return gmlErr("Not found: " + path); }
        folder.execute();
        return gmlOk({ opened: String(folder.fsName) });
    } catch (e) {
        return gmlErr("gmlReveal failed", e);
    }
}
