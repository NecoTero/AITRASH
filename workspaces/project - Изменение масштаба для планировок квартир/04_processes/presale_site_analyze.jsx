(function () {
    "use strict";

    function fail(message) {
        throw new Error(message);
    }

    function readText(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) {
            fail("Не удалось открыть файл: " + file.fsName);
        }
        var text = file.read();
        file.close();
        return text.replace(/^\uFEFF/, "");
    }

    function parseJson(file) {
        return eval("(" + readText(file) + ")");
    }

    function csvCell(value) {
        var text = value === null || typeof value === "undefined" ?
            "" : String(value);
        return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }

    function writeCsv(file, headers, rows) {
        var lines = [];
        var values;
        var i;
        var j;
        for (i = 0; i < headers.length; i += 1) {
            lines.push(csvCell(headers[i]));
        }
        var output = [lines.join(",")];
        for (i = 0; i < rows.length; i += 1) {
            values = [];
            for (j = 0; j < headers.length; j += 1) {
                values.push(csvCell(rows[i][headers[j]]));
            }
            output.push(values.join(","));
        }
        file.encoding = "UTF-8";
        file.lineFeed = "Windows";
        if (!file.open("w")) {
            fail("Не удалось создать CSV: " + file.fsName);
        }
        file.write(output.join("\r\n") + "\r\n");
        file.close();
    }

    function number(value, digits) {
        var factor = Math.pow(10, digits || 6);
        return Math.round(Number(value) * factor) / factor;
    }

    function boundsInfo(bounds) {
        var left = Number(bounds[0]);
        var top = Number(bounds[1]);
        var right = Number(bounds[2]);
        var bottom = Number(bounds[3]);
        return {
            left: number(left, 6),
            top: number(top, 6),
            right: number(right, 6),
            bottom: number(bottom, 6),
            width: number(right - left, 6),
            height: number(top - bottom, 6)
        };
    }

    function inspectLayers(document) {
        var result = {
            top_layers: document.layers.length,
            total_layers: 0,
            nested_layers: 0,
            empty_layers: 0,
            duplicate_sibling_names: 0,
            max_depth: 0,
            hidden_layers: 0,
            locked_layers: 0
        };

        function walk(layers, depth) {
            var seen = {};
            var i;
            var layer;
            var key;
            for (i = 0; i < layers.length; i += 1) {
                layer = layers[i];
                key = String(layer.name).toLowerCase();
                if (seen[key]) {
                    result.duplicate_sibling_names += 1;
                }
                seen[key] = true;
                result.total_layers += 1;
                if (depth > 0) {
                    result.nested_layers += 1;
                }
                if (depth > result.max_depth) {
                    result.max_depth = depth;
                }
                if (!layer.visible) {
                    result.hidden_layers += 1;
                }
                if (layer.locked) {
                    result.locked_layers += 1;
                }
                if (layer.pageItems.length === 0 && layer.layers.length === 0) {
                    result.empty_layers += 1;
                }
                if (layer.layers.length) {
                    walk(layer.layers, depth + 1);
                }
            }
        }

        walk(document.layers, 0);
        return result;
    }

    function countRootItems(document) {
        var count = 0;
        var i;
        var item;
        for (i = 0; i < document.pageItems.length; i += 1) {
            item = document.pageItems[i];
            if (item.parent && item.parent.typename === "Layer") {
                count += 1;
            }
        }
        return count;
    }

    function errorText(error) {
        var text = error && error.message ? error.message : String(error);
        if (error && error.line) {
            text += " (строка " + error.line + ")";
        }
        return text;
    }

    var scriptFile = new File($.fileName);
    var scriptFolder = scriptFile.parent;
    var jobFile = new File(
        scriptFolder.fsName + "/presale_site_analyze_job.json"
    );
    var job = parseJson(jobFile);
    var reportFile = new File(job.batch_report);
    var headers = [
        "batch_id",
        "index",
        "status",
        "source_relpath",
        "source_ai",
        "visible_left",
        "visible_top",
        "visible_right",
        "visible_bottom",
        "visible_width",
        "visible_height",
        "page_items",
        "root_items",
        "top_layers",
        "total_layers",
        "nested_layers",
        "empty_layers",
        "duplicate_sibling_names",
        "max_layer_depth",
        "hidden_layers",
        "locked_layers",
        "comment"
    ];
    var rows = [];
    var originalInteractionLevel = app.userInteractionLevel;
    var originalCoordinateSystem = app.coordinateSystem;
    var document = null;
    var entry;
    var visible;
    var layers;
    var row;
    var i;

    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        for (i = 0; i < job.entries.length; i += 1) {
            entry = job.entries[i];
            row = {
                batch_id: job.batch_id,
                index: entry.index,
                status: "ERROR",
                source_relpath: entry.source_relpath,
                source_ai: entry.source_ai,
                comment: ""
            };
            try {
                document = app.open(new File(entry.source_ai));
                document.selection = null;
                visible = boundsInfo(document.visibleBounds);
                layers = inspectLayers(document);
                row.visible_left = visible.left;
                row.visible_top = visible.top;
                row.visible_right = visible.right;
                row.visible_bottom = visible.bottom;
                row.visible_width = visible.width;
                row.visible_height = visible.height;
                row.page_items = document.pageItems.length;
                row.root_items = countRootItems(document);
                row.top_layers = layers.top_layers;
                row.total_layers = layers.total_layers;
                row.nested_layers = layers.nested_layers;
                row.empty_layers = layers.empty_layers;
                row.duplicate_sibling_names =
                    layers.duplicate_sibling_names;
                row.max_layer_depth = layers.max_depth;
                row.hidden_layers = layers.hidden_layers;
                row.locked_layers = layers.locked_layers;
                row.status = "OK";
                row.comment = "Read-only preflight completed.";
            } catch (error) {
                row.status = "ERROR";
                row.comment = errorText(error);
            } finally {
                if (document) {
                    try {
                        document.close(SaveOptions.DONOTSAVECHANGES);
                    } catch (closeError) {
                        row.status = "ERROR";
                        row.comment += " | Ошибка закрытия: " +
                            errorText(closeError);
                    }
                    document = null;
                }
            }
            rows.push(row);
        }
        writeCsv(reportFile, headers, rows);
        return "REPORT=" + reportFile.fsName + ";FILES=" + rows.length;
    } finally {
        if (document) {
            document.close(SaveOptions.DONOTSAVECHANGES);
        }
        app.userInteractionLevel = originalInteractionLevel;
        app.coordinateSystem = originalCoordinateSystem;
    }
}());
