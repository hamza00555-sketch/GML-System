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

/**
 * M0.5 stub. Reports exactly what it received so the panel round trip can be
 * verified, without touching the project. Real behaviour lands in M2, and only
 * once Spike A has passed.
 */
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
            message: "M0.5: bridge verified, no project changes. Received " + names.length + " asset(s).",
            received: names
        });
    } catch (e) {
        return gmlErr("gmlApply failed", e);
    }
}
