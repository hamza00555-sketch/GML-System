/**
 * ExtendScript is ES3 and has no native JSON, so results are serialised by
 * hand. Only stringify is needed: arguments travel the other way as JSON text
 * injected straight into the evaluated source, which is already valid
 * ExtendScript object-literal syntax.
 */

function gmlEscape(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var code = text.charCodeAt(i);
        if (ch === '"') { out += '\\"'; }
        else if (ch === "\\") { out += "\\\\"; }
        else if (ch === "\n") { out += "\\n"; }
        else if (ch === "\r") { out += "\\r"; }
        else if (ch === "\t") { out += "\\t"; }
        else if (code < 32 || code > 126) {
            // Non-ASCII must be escaped: the CEP bridge is not reliably UTF-8.
            var hex = code.toString(16);
            while (hex.length < 4) { hex = "0" + hex; }
            out += "\\u" + hex;
        } else { out += ch; }
    }
    return '"' + out + '"';
}

function gmlStringify(value) {
    if (value === null || value === undefined) { return "null"; }

    var type = typeof value;
    if (type === "boolean") { return value ? "true" : "false"; }
    if (type === "number") { return isFinite(value) ? String(value) : "null"; }
    if (type === "string") { return gmlEscape(value); }

    if (value instanceof Array) {
        var items = [];
        for (var i = 0; i < value.length; i++) {
            items[items.length] = gmlStringify(value[i]);
        }
        return "[" + items.join(",") + "]";
    }

    if (type === "object") {
        var pairs = [];
        for (var key in value) {
            if (!value.hasOwnProperty(key)) { continue; }
            var member = value[key];
            if (typeof member === "function" || member === undefined) { continue; }
            pairs[pairs.length] = gmlEscape(key) + ":" + gmlStringify(member);
        }
        return "{" + pairs.join(",") + "}";
    }

    return "null";
}

/** Every host function answers with the same envelope so the panel can branch. */
function gmlOk(data) {
    return gmlStringify({ ok: true, data: data === undefined ? null : data });
}

function gmlErr(message, detail) {
    return gmlStringify({
        ok: false,
        error: String(message),
        detail: detail === undefined ? null : String(detail)
    });
}
