/**
 * After Effects host functions for M0.5.
 *
 * Reads are real — the panel's drop-zone target and readiness badges depend on
 * them. Applying is deliberately a reporting stub until Spike A settles how the
 * publish and import workflow behaves; nothing here modifies a project.
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
 * What is installed here, so the panel can mark an asset Requires Font or
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
        // font family — so each entry must be unwrapped. Reading postScriptName
        // off the family array would silently yield an empty list.
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
// Inspection — what the panel needs to know before it can package a comp.
// ---------------------------------------------------------------------------

function gmlFootageSnapshot(item) {
    var source = item.mainSource;
    var snap = {
        itemId: item.id,
        name: String(item.name),
        sourceKind: "file",
        isStill: false,
        hasVideo: item.hasVideo === true,
        hasAudio: item.hasAudio === true,
        hasProxy: item.useProxy === true
    };
    if (source instanceof PlaceholderSource) { snap.sourceKind = "placeholder"; return snap; }
    if (source instanceof SolidSource) { snap.sourceKind = "solid"; return snap; }
    if (!(source instanceof FileSource)) { snap.sourceKind = "placeholder"; return snap; }

    snap.isStill = source.isStill === true;
    if (source.file) { snap.filePath = String(source.file.fsName); }
    if (item.footageMissing) {
        snap.missingFootagePath = source.missingFootagePath ? String(source.missingFootagePath) : (snap.filePath || "?");
    }
    return snap;
}

/**
 * Everything reachable from one comp: nested comps are followed, so the
 * footage list is what this comp actually depends on — not the whole project.
 */
function gmlInspectComp() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return gmlErr("Select a composition first (click it in the Project panel or open it).");
        }

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
                            var fx = parade.property(E);
                            effects[String(fx.matchName)] = String(fx.name);
                        }
                    }
                } catch (eFx) { /* layer types without an effect parade */ }
            }
        }
        walk(comp);

        var compNames = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) { compNames[compNames.length] = String(item.name); }
        }

        var fontList = [];
        for (var f in fonts) { if (fonts.hasOwnProperty(f)) { fontList[fontList.length] = f; } }
        var effectList = [];
        for (var m in effects) {
            if (effects.hasOwnProperty(m)) { effectList[effectList.length] = { matchName: m, name: effects[m] }; }
        }

        return gmlOk({
            compName: String(comp.name),
            compId: comp.id,
            fps: comp.frameRate,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            projectPath: app.project.file ? String(app.project.file.fsName) : null,
            projectDirty: app.project.dirty === true,
            aeVersion: String(app.version),
            compNames: compNames,
            footage: footage,
            fonts: fontList,
            effects: effectList
        });
    } catch (e) {
        return gmlErr("gmlInspectComp failed", e);
    }
}

/** Saves in place. A never-saved project would open a dialog, so it is refused instead. */
function gmlSaveProject() {
    try {
        if (!app.project.file) {
            return gmlErr("The project has never been saved. Use File > Save As first.");
        }
        app.project.save();
        return gmlOk({ path: String(app.project.file.fsName), dirty: app.project.dirty === true });
    } catch (e) {
        return gmlErr("gmlSaveProject failed", e);
    }
}

// ---------------------------------------------------------------------------
// Apply — import the package's comp and add it to the active comp.
// ---------------------------------------------------------------------------

function gmlFindCompByComment(prefix, exact) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem)) { continue; }
        var comment = String(item.comment || "");
        if (exact ? comment === prefix : comment.indexOf(prefix) === 0) { return item; }
    }
    return null;
}

function gmlFindCompIn(container, name) {
    if (container instanceof CompItem) { return container.name === name ? container : null; }
    if (!(container instanceof FolderItem)) { return null; }
    for (var i = 1; i <= container.numItems; i++) {
        var found = gmlFindCompIn(container.item(i), name);
        if (found) { return found; }
    }
    return null;
}

/**
 * One undo group for the whole batch, so a single Ctrl+Z removes everything.
 *
 * Reuse rule: a comp already stamped gml:<id>@<version> is used as-is, so
 * applying twice never yields "GML_x 2". A different version of the same id is
 * left untouched and the requested version is imported alongside it — never a
 * silent update.
 */
function gmlApply(payload) {
    var refs = payload && payload.refs ? payload.refs : [];
    if (refs.length === 0) { return gmlErr("Nothing to apply"); }
    if (!refs[0].packagePath) {
        return gmlErr("No library package for this asset — open Settings and choose the library folder.");
    }

    var target = app.project.activeItem;
    if (!target || !(target instanceof CompItem)) {
        return gmlErr("Open a composition (or select one in the Project panel) before applying.");
    }

    var added = [], reused = [], imported = [], warnings = [];
    app.beginUndoGroup("GML Apply");
    try {
        for (var i = 0; i < refs.length; i++) {
            var ref = refs[i];
            var stamp = "gml:" + ref.id + "@" + ref.version;

            var comp = gmlFindCompByComment(stamp, true);
            if (comp) {
                reused[reused.length] = String(comp.name);
            } else {
                var other = gmlFindCompByComment("gml:" + ref.id + "@", false);
                if (other) {
                    warnings[warnings.length] = "Project already has " + String(other.comment) +
                        "; " + ref.version + " was imported separately, nothing was replaced.";
                }

                var file = new File(ref.packagePath + "/" + (ref.source || "source.aep"));
                if (!file.exists) {
                    throw new Error("Package file not found: " + file.fsName + " (still syncing from Drive?)");
                }
                var item = app.project.importFile(new ImportOptions(file));
                comp = gmlFindCompIn(item, ref.compName);
                if (!comp) {
                    throw new Error("Comp \"" + ref.compName + "\" is not inside " + file.displayName);
                }
                comp.comment = stamp;
                if (item instanceof FolderItem) {
                    item.name = "GML_" + ref.id + "_v" + ref.version;
                    item.comment = stamp;
                }
                imported[imported.length] = String(comp.name);
            }

            if (comp.id === target.id) {
                warnings[warnings.length] = "Skipped " + ref.id + ": cannot add a comp into itself.";
                continue;
            }
            if (ref.footage === "external") {
                warnings[warnings.length] = ref.id + " has un-bundled footage; it only renders where it was published.";
            }

            var layer = target.layers.add(comp);
            layer.startTime = target.time;
            layer.comment = stamp;
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
