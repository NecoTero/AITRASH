#target illustrator

(function () {
    var SCRIPT_VERSION = "1.0.0-independent";
    var originalInteractionLevel = app.userInteractionLevel;
    var originalCoordinateSystem = app.coordinateSystem;

    function fail(message) {
        throw new Error(message);
    }

    function readText(file) {
        if (!file.exists) {
            fail("Файл не найден: " + file.fsName);
        }
        file.encoding = "UTF-8";
        if (!file.open("r")) {
            fail("Не удалось открыть файл: " + file.fsName);
        }
        var text = file.read();
        file.close();
        return text;
    }

    function writeText(file, text) {
        file.encoding = "UTF-8";
        file.lineFeed = "Windows";
        if (!file.open("w")) {
            fail("Не удалось создать файл: " + file.fsName);
        }
        file.write(text);
        file.close();
    }

    function appendText(file, text) {
        file.encoding = "UTF-8";
        file.lineFeed = "Windows";
        if (!file.open("a")) {
            fail("Не удалось дополнить файл: " + file.fsName);
        }
        file.write(text);
        file.close();
    }

    function parseJson(file) {
        var text = readText(file).replace(/^\uFEFF/, "");
        try {
            return eval("(" + text + ")");
        } catch (error) {
            fail("Ошибка JSON в " + file.fsName + ": " + error.message);
        }
    }

    function number(value, digits) {
        var factor = Math.pow(10, digits || 6);
        return Math.round(Number(value) * factor) / factor;
    }

    function arrayOfNumbers(value) {
        var result = [];
        var i;
        for (i = 0; i < value.length; i += 1) {
            result.push(number(value[i], 6));
        }
        return result;
    }

    function boundsInfo(value) {
        var values = arrayOfNumbers(value);
        return {
            rect: values,
            width: number(values[2] - values[0], 6),
            height: number(values[1] - values[3], 6),
            center_x: number((values[0] + values[2]) / 2, 6),
            center_y: number((values[1] + values[3]) / 2, 6)
        };
    }

    function snapshotArtboards(document) {
        var result = [];
        var i;
        var info;
        for (i = 0; i < document.artboards.length; i += 1) {
            info = boundsInfo(document.artboards[i].artboardRect);
            result.push({
                index: i,
                width: info.width,
                height: info.height,
                rect: info.rect
            });
        }
        return result;
    }

    function safeName(item) {
        try {
            return item.name || "";
        } catch (error) {
            return "";
        }
    }

    function safeLayerName(item) {
        try {
            return item.layer ? item.layer.name : "";
        } catch (error) {
            return "";
        }
    }

    function snapshotLayers(document) {
        var audit = [];

        function walk(layers, parentPath) {
            var i;
            var path;
            for (i = 0; i < layers.length; i += 1) {
                path = parentPath + "/" + i + ":" + layers[i].name;
                audit.push({
                    path: path,
                    name: layers[i].name,
                    index: i,
                    visible: layers[i].visible,
                    locked: layers[i].locked,
                    printable: layers[i].printable
                });
                if (layers[i].layers && layers[i].layers.length) {
                    walk(layers[i].layers, path);
                }
            }
        }

        walk(document.layers, "");
        return audit;
    }

    function layerSignature(layerAudit) {
        var parts = [];
        var i;
        for (i = 0; i < layerAudit.length; i += 1) {
            parts.push(
                layerAudit[i].path + "|" +
                (layerAudit[i].visible ? "1" : "0") + "|" +
                (layerAudit[i].locked ? "1" : "0") + "|" +
                (layerAudit[i].printable ? "1" : "0")
            );
        }
        return parts.join("\n");
    }

    function snapshotItems(document) {
        var audit = [];
        var i;
        var item;
        var parentType;
        var parentName;
        for (i = 0; i < document.pageItems.length; i += 1) {
            item = document.pageItems[i];
            try {
                parentType = item.parent ? item.parent.typename : "";
            } catch (parentError) {
                parentType = "";
            }
            try {
                parentName = item.parent ? safeName(item.parent) : "";
            } catch (parentNameError) {
                parentName = "";
            }
            audit.push({
                index: i,
                typename: item.typename,
                name: safeName(item),
                layer: safeLayerName(item),
                parent_typename: parentType,
                parent_name: parentName,
                hidden: item.hidden,
                locked: item.locked
            });
        }
        return audit;
    }

    function itemStructureSignature(itemAudit) {
        var parts = [];
        var i;
        for (i = 0; i < itemAudit.length; i += 1) {
            parts.push(
                itemAudit[i].index + "|" +
                itemAudit[i].typename + "|" +
                itemAudit[i].name + "|" +
                itemAudit[i].layer + "|" +
                itemAudit[i].parent_typename + "|" +
                itemAudit[i].parent_name
            );
        }
        return parts.join("\n");
    }

    function itemStateSignature(itemAudit) {
        var parts = [];
        var i;
        for (i = 0; i < itemAudit.length; i += 1) {
            parts.push(
                itemAudit[i].index + "|" +
                (itemAudit[i].hidden ? "1" : "0") + "|" +
                (itemAudit[i].locked ? "1" : "0")
            );
        }
        return parts.join("\n");
    }

    function collectStrokeWidths(document) {
        var widths = [];
        var failures = [];
        var i;
        var pathItem;
        var textFrame;
        var characterIndex;
        var character;
        var attributes;
        var color;

        for (i = 0; i < document.pathItems.length; i += 1) {
            pathItem = document.pathItems[i];
            try {
                if (pathItem.stroked) {
                    widths.push({
                        kind: "path",
                        index: i,
                        width: Number(pathItem.strokeWidth)
                    });
                }
            } catch (pathError) {
                failures.push("path:" + i + ":" + pathError.message);
            }
        }

        for (i = 0; i < document.textFrames.length; i += 1) {
            textFrame = document.textFrames[i];
            for (characterIndex = 0;
                    characterIndex < textFrame.characters.length;
                    characterIndex += 1) {
                character = textFrame.characters[characterIndex];
                try {
                    attributes = character.characterAttributes;
                    color = attributes.strokeColor;
                    if (color && color.typename !== "NoColor") {
                        widths.push({
                            kind: "text",
                            index: i + ":" + characterIndex,
                            width: Number(attributes.strokeWeight)
                        });
                    }
                } catch (textError) {
                    failures.push(
                        "text:" + i + ":" + characterIndex + ":" +
                        textError.message
                    );
                }
            }
        }

        return {
            widths: widths,
            failures: failures
        };
    }

    function strokeMismatches(collection, target, tolerance) {
        var result = [];
        var i;
        for (i = 0; i < collection.widths.length; i += 1) {
            if (Math.abs(collection.widths[i].width - target) > tolerance) {
                result.push(collection.widths[i]);
                if (result.length >= 20) {
                    break;
                }
            }
        }
        return result;
    }

    function nowIso() {
        var date = new Date();
        function pad(value) {
            return value < 10 ? "0" + value : String(value);
        }
        return date.getFullYear() + "-" +
            pad(date.getMonth() + 1) + "-" +
            pad(date.getDate()) + "T" +
            pad(date.getHours()) + ":" +
            pad(date.getMinutes()) + ":" +
            pad(date.getSeconds());
    }

    function jsonQuote(value) {
        var text = String(value);
        var result = "\"";
        var i;
        var character;
        var code;
        for (i = 0; i < text.length; i += 1) {
            character = text.charAt(i);
            code = text.charCodeAt(i);
            if (character === "\"") {
                result += "\\\"";
            } else if (character === "\\") {
                result += "\\\\";
            } else if (character === "\n") {
                result += "\\n";
            } else if (character === "\r") {
                result += "\\r";
            } else if (character === "\t") {
                result += "\\t";
            } else if (code < 32) {
                result += "\\u" + ("0000" + code.toString(16)).slice(-4);
            } else {
                result += character;
            }
        }
        return result + "\"";
    }

    function jsonStringify(value) {
        var parts = [];
        var key;
        var i;
        if (value === null || typeof value === "undefined") {
            return "null";
        }
        if (typeof value === "string") {
            return jsonQuote(value);
        }
        if (typeof value === "number") {
            return isFinite(value) ? String(value) : "null";
        }
        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }
        if (value instanceof Array) {
            for (i = 0; i < value.length; i += 1) {
                parts.push(jsonStringify(value[i]));
            }
            return "[" + parts.join(",") + "]";
        }
        for (key in value) {
            if (value.hasOwnProperty(key) && typeof value[key] !== "function") {
                parts.push(jsonQuote(key) + ":" + jsonStringify(value[key]));
            }
        }
        return "{" + parts.join(",") + "}";
    }

    function csvCell(value) {
        var text = value === null || typeof value === "undefined" ? "" : String(value);
        return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }

    function csvLine(values) {
        var result = [];
        var i;
        for (i = 0; i < values.length; i += 1) {
            result.push(csvCell(values[i]));
        }
        return result.join(",");
    }

    function errorText(error) {
        var text = error && error.message ? error.message : String(error);
        if (error && error.line) {
            text += " (строка " + error.line + ")";
        }
        return text;
    }

    function reportHeaders() {
        return [
            "batch_id",
            "index",
            "status",
            "timestamp",
            "source_relpath",
            "expected_scale_percent",
            "ai_opened",
            "ruler_units_pixels",
            "artboards",
            "artboard_width",
            "artboard_height",
            "center_x",
            "center_y",
            "inside_artboard",
            "stroke_count",
            "stroke_mismatch_count",
            "source_item_count",
            "output_item_count",
            "source_layer_count",
            "output_layer_count",
            "layer_signature_match",
            "item_structure_match",
            "item_state_match",
            "color_space_match",
            "names_match",
            "output_ai",
            "output_png",
            "verify_audit",
            "comment"
        ];
    }

    function reportValues(row) {
        var headers = reportHeaders();
        var values = [];
        var i;
        for (i = 0; i < headers.length; i += 1) {
            values.push(row[headers[i]]);
        }
        return values;
    }

    function appendReport(reportFile, row) {
        var line = csvLine(reportValues(row)) + "\r\n";
        if (reportFile.exists) {
            appendText(reportFile, line);
        } else {
            writeText(reportFile, csvLine(reportHeaders()) + "\r\n" + line);
        }
    }

    function verifyOne(entry, job) {
        var sourceFile = new File(entry.source_ai);
        var outputAi = new File(entry.output_ai);
        var outputPng = new File(entry.output_png);
        var auditFile = new File(entry.verify_audit);
        var sourceDocument = null;
        var outputDocument = null;
        var sourceLayers;
        var outputLayers;
        var sourceItems;
        var outputItems;
        var artboards;
        var visible;
        var strokes;
        var mismatches;
        var size = Number(job.artboard_size_pt);
        var boundsTolerance = Number(job.bounds_tolerance_pt);
        var strokeTarget = Number(job.stroke_width_pt);
        var strokeTolerance = Number(job.stroke_tolerance_pt);
        var sourceStem = sourceFile.displayName.replace(/\.ai$/i, "");
        var expectedStem = String(job.output_prefix) +
            String(entry.expected_scale_percent) + "_" + sourceStem;
        var row = {
            batch_id: job.batch_id,
            index: entry.index,
            status: "ERROR",
            timestamp: nowIso(),
            source_relpath: entry.source_relpath,
            expected_scale_percent: entry.expected_scale_percent,
            ai_opened: "false",
            ruler_units_pixels: "",
            artboards: "",
            artboard_width: "",
            artboard_height: "",
            center_x: "",
            center_y: "",
            inside_artboard: "",
            stroke_count: "",
            stroke_mismatch_count: "",
            source_item_count: "",
            output_item_count: "",
            source_layer_count: "",
            output_layer_count: "",
            layer_signature_match: "",
            item_structure_match: "",
            item_state_match: "",
            color_space_match: "",
            names_match: "",
            output_ai: outputAi.fsName,
            output_png: outputPng.fsName,
            verify_audit: "",
            comment: ""
        };
        var audit = {
            schema_version: 1,
            script_version: SCRIPT_VERSION,
            run_id: job.run_id,
            batch_id: job.batch_id,
            index: entry.index,
            timestamp: row.timestamp,
            source_relpath: entry.source_relpath,
            source_ai: sourceFile.fsName,
            output_ai: outputAi.fsName,
            output_png: outputPng.fsName
        };

        try {
            if (!sourceFile.exists || !outputAi.exists || !outputPng.exists) {
                fail("Не найдена исходная или выходная пара.");
            }
            if (auditFile.exists) {
                fail("Verify audit уже существует.");
            }

            sourceDocument = app.open(sourceFile);
            sourceLayers = snapshotLayers(sourceDocument);
            sourceItems = snapshotItems(sourceDocument);
            row.source_item_count = sourceItems.length;
            row.source_layer_count = sourceLayers.length;
            audit.source_item_count = sourceItems.length;
            audit.source_layer_count = sourceLayers.length;

            outputDocument = app.open(outputAi);
            row.ai_opened = "true";
            outputLayers = snapshotLayers(outputDocument);
            outputItems = snapshotItems(outputDocument);
            artboards = snapshotArtboards(outputDocument);
            visible = boundsInfo(outputDocument.visibleBounds);
            strokes = collectStrokeWidths(outputDocument);
            if (strokes.failures.length) {
                fail("Не удалось прочитать все обводки: " +
                    strokes.failures.slice(0, 20).join("; "));
            }
            mismatches = strokeMismatches(
                strokes,
                strokeTarget,
                strokeTolerance
            );

            row.ruler_units_pixels =
                outputDocument.rulerUnits === RulerUnits.Pixels ? "true" : "false";
            row.artboards = artboards.length;
            row.artboard_width = artboards.length ? artboards[0].width : "";
            row.artboard_height = artboards.length ? artboards[0].height : "";
            row.center_x = visible.center_x;
            row.center_y = visible.center_y;
            row.inside_artboard = (
                visible.rect[0] >= -boundsTolerance &&
                visible.rect[2] <= size + boundsTolerance &&
                visible.rect[1] <= size + boundsTolerance &&
                visible.rect[3] >= -boundsTolerance
            ) ? "true" : "false";
            row.stroke_count = strokes.widths.length;
            row.stroke_mismatch_count = mismatches.length;
            row.output_item_count = outputItems.length;
            row.output_layer_count = outputLayers.length;
            row.layer_signature_match =
                layerSignature(sourceLayers) === layerSignature(outputLayers) ?
                    "true" : "false";
            row.item_structure_match =
                itemStructureSignature(sourceItems) ===
                    itemStructureSignature(outputItems) ? "true" : "false";
            row.item_state_match =
                itemStateSignature(sourceItems) ===
                    itemStateSignature(outputItems) ? "true" : "false";
            row.color_space_match =
                sourceDocument.documentColorSpace ===
                    outputDocument.documentColorSpace ? "true" : "false";
            row.names_match = (
                outputAi.displayName === expectedStem + ".ai" &&
                outputPng.displayName === expectedStem + ".png"
            ) ? "true" : "false";

            if (row.ruler_units_pixels !== "true" ||
                    artboards.length !== 1 ||
                    Math.abs(artboards[0].width - size) > boundsTolerance ||
                    Math.abs(artboards[0].height - size) > boundsTolerance ||
                    Math.abs(visible.center_x - size / 2) > boundsTolerance ||
                    Math.abs(visible.center_y - size / 2) > boundsTolerance ||
                    row.inside_artboard !== "true" ||
                    mismatches.length !== 0 ||
                    sourceItems.length !== outputItems.length ||
                    row.layer_signature_match !== "true" ||
                    row.item_structure_match !== "true" ||
                    row.item_state_match !== "true" ||
                    row.color_space_match !== "true" ||
                    row.names_match !== "true") {
                fail("Один или несколько обязательных критериев AI не выполнены.");
            }

            audit.status = "OK";
            audit.ruler_units_pixels = true;
            audit.artboards = artboards;
            audit.visible_bounds = visible;
            audit.inside_artboard = true;
            audit.stroke_count = strokes.widths.length;
            audit.stroke_mismatch_count = 0;
            audit.source_item_count = sourceItems.length;
            audit.output_item_count = outputItems.length;
            audit.source_layer_count = sourceLayers.length;
            audit.output_layer_count = outputLayers.length;
            audit.layer_signature_match = true;
            audit.item_structure_match = true;
            audit.item_state_match = true;
            audit.color_space_match = true;
            audit.names_match = true;
            row.status = "OK";
            row.comment = "Независимая read-only проверка AI пройдена.";
        } catch (error) {
            row.status = "ERROR";
            row.comment = errorText(error);
            audit.status = "ERROR";
            audit.comment = row.comment;
        } finally {
            if (outputDocument) {
                try {
                    outputDocument.close(SaveOptions.DONOTSAVECHANGES);
                } catch (outputCloseError) {
                    row.comment += " | Ошибка закрытия output AI: " +
                        errorText(outputCloseError);
                }
            }
            if (sourceDocument) {
                try {
                    sourceDocument.close(SaveOptions.DONOTSAVECHANGES);
                } catch (sourceCloseError) {
                    row.comment += " | Ошибка закрытия source AI: " +
                        errorText(sourceCloseError);
                }
            }
            if (!auditFile.exists) {
                try {
                    audit.comment = row.comment;
                    writeText(auditFile, jsonStringify(audit));
                    if (auditFile.exists) {
                        row.verify_audit = auditFile.fsName;
                    }
                } catch (auditError) {
                    row.comment += " | Не удалось записать verify audit: " +
                        errorText(auditError);
                }
            }
        }

        return row;
    }

    function validateJob(job) {
        var seen = {};
        var i;
        var entry;
        if (!job || Number(job.schema_version) !== 1 ||
                !job.run_id || !job.batch_id ||
                !job.batch_report || !job.entries || !job.entries.length) {
            fail("Некорректный presale_site_verify_job.json.");
        }
        if (Number(job.artboard_size_pt) !== 1200 ||
                Number(job.stroke_width_pt) !== 0.75) {
            fail("Некорректные контрольные значения verify job.");
        }
        for (i = 0; i < job.entries.length; i += 1) {
            entry = job.entries[i];
            if (seen[String(entry.index)]) {
                fail("В verify job повторяется индекс: " + entry.index);
            }
            seen[String(entry.index)] = true;
            if (!entry.source_ai || !entry.output_ai || !entry.output_png ||
                    !entry.verify_audit ||
                    typeof entry.expected_scale_percent === "undefined") {
                fail("Некорректная запись verify job: " + i);
            }
        }
    }

    function main() {
        var scriptFolder = new File($.fileName).parent;
        var jobFile = new File(
            scriptFolder.fsName + "/presale_site_verify_job.json"
        );
        var job = parseJson(jobFile);
        var reportFile;
        var row;
        var i;
        var okCount = 0;
        var errorCount = 0;

        validateJob(job);
        reportFile = new File(job.batch_report);
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;

        for (i = 0; i < job.entries.length; i += 1) {
            row = verifyOne(job.entries[i], job);
            appendReport(reportFile, row);
            if (row.status === "OK") {
                okCount += 1;
            } else {
                errorCount += 1;
            }
        }

        return "REPORT=" + reportFile.fsName +
            ";FILES=" + job.entries.length +
            ";OK=" + okCount +
            ";ERROR=" + errorCount;
    }

    try {
        main();
    } finally {
        app.userInteractionLevel = originalInteractionLevel;
        app.coordinateSystem = originalCoordinateSystem;
    }
}());
