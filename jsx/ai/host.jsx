/**
 * Illustrator host functions for M0.5.
 *
 * Reads are real. The tag-visibility toggle is real too, because it is the
 * approval feature and needs proving early — it operates only on a layer this
 * system owns. Placing artwork waits for Spike B.
 */

var GML_TAGS_LAYER = "GML_TAGS";

function gmlHostInfo() {
    try {
        return gmlOk({
            app: "ILST",
            version: String(app.version),
            language: String(app.locale),
            documents: app.documents.length,
            activeDocument: app.documents.length > 0 ? String(app.activeDocument.name) : null
        });
    } catch (e) {
        return gmlErr("gmlHostInfo failed", e);
    }
}

function gmlGetTarget() {
    try {
        if (app.documents.length === 0) {
            return gmlOk({ kind: "none", name: "" });
        }
        var doc = app.activeDocument;

        if (doc.selection && doc.selection.length > 0) {
            var first = doc.selection[0];
            var label = first.name ? String(first.name) : "Selection";
            return gmlOk({ kind: "frame", name: label });
        }

        var index = doc.artboards.getActiveArtboardIndex();
        var artboard = doc.artboards[index];
        return gmlOk({ kind: "artboard", name: String(artboard.name) });
    } catch (e) {
        return gmlErr("gmlGetTarget failed", e);
    }
}

/** Illustrator has no fonts/effects dependency surface for GML assets. */
function gmlGetEnvironment() {
    return gmlOk({ fonts: [], effectMatchNames: [] });
}

function gmlFindTagsLayer(doc) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === GML_TAGS_LAYER) { return doc.layers[i]; }
    }
    return null;
}

/**
 * The approval toggle. Every badge lives on one layer precisely so hiding them
 * is a single atomic operation rather than a walk over every group.
 */
function gmlSetTagsVisible(payload) {
    try {
        if (app.documents.length === 0) { return gmlErr("No document is open"); }
        var doc = app.activeDocument;
        var layer = gmlFindTagsLayer(doc);

        if (!layer) {
            return gmlOk({
                changed: false,
                message: "No " + GML_TAGS_LAYER + " layer in this document yet."
            });
        }

        var visible = payload && payload.visible === true;
        layer.visible = visible;
        // Never printable, shown or hidden: badges are screen-only guidance
        // and must not reach a PDF export even while they are visible.
        layer.printable = false;

        return gmlOk({ changed: true, visible: layer.visible, layer: GML_TAGS_LAYER });
    } catch (e) {
        return gmlErr("gmlSetTagsVisible failed", e);
    }
}

/** M0.5 stub — the real reposition arrives in M4, after Spike B. */
function gmlResyncTags() {
    try {
        if (app.documents.length === 0) { return gmlErr("No document is open"); }
        var doc = app.activeDocument;
        var layer = gmlFindTagsLayer(doc);
        return gmlOk({
            stub: true,
            message: "M0.5: bridge verified, no artwork moved.",
            tagsLayerPresent: layer !== null
        });
    } catch (e) {
        return gmlErr("gmlResyncTags failed", e);
    }
}

/** M0.5 stub — the manifest writer arrives in M5. */
function gmlExportStoryboard() {
    return gmlOk({ stub: true, message: "M0.5: bridge verified, nothing exported." });
}

/** M0.5 stub — real placement waits on Spike B. */
function gmlApply(payload) {
    try {
        var refs = payload && payload.refs ? payload.refs : [];
        var names = [];
        for (var i = 0; i < refs.length; i++) {
            names[names.length] = refs[i].id + "@" + refs[i].version;
        }
        return gmlOk({
            applied: false,
            stub: true,
            message: "M0.5: bridge verified, no artwork placed. Received " + names.length + " asset(s).",
            received: names
        });
    } catch (e) {
        return gmlErr("gmlApply failed", e);
    }
}
