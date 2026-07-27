#target illustrator

(function () {
    var SCRIPT_VERSION = "1.0.0-full";
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

    function parseConfig(file) {
        var text = readText(file).replace(/^\uFEFF/, "");
        try {
            return eval("(" + text + ")");
        } catch (error) {
            fail("Ошибка JSON в " + file.fsName + ": " + error.message);
        }
    }

    function ensureFolder(folder) {
        if (folder.exists) {
            return;
        }
        if (folder.parent && !folder.parent.exists) {
            ensureFolder(folder.parent);
        }
        if (!folder.create()) {
            fail("Не удалось создать каталог: " + folder.fsName);
        }
    }

    function normalizeRelPath(value) {
        return String(value).replace(/\\/g, "/").replace(/^\.\/+/, "");
    }

    function pathKey(value) {
        return normalizeRelPath(value).toLowerCase();
    }

    function trim(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function parseCsvLine(line) {
        var values = [];
        var current = "";
        var inQuotes = false;
        var i;
        var character;
        for (i = 0; i < line.length; i += 1) {
            character = line.charAt(i);
            if (character === "\"") {
                if (inQuotes && i + 1 < line.length && line.charAt(i + 1) === "\"") {
                    current += "\"";
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (character === "," && !inQuotes) {
                values.push(current);
                current = "";
            } else {
                current += character;
            }
        }
        values.push(current);
        return values;
    }

    function readOverrides(file) {
        var result = {};
        if (!file.exists) {
            return result;
        }
        var lines = readText(file).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        var i;
        var fields;
        var relPath;
        var scale;
        for (i = 1; i < lines.length; i += 1) {
            if (!trim(lines[i]) || trim(lines[i]).charAt(0) === "#") {
                continue;
            }
            fields = parseCsvLine(lines[i]);
            if (fields.length < 2) {
                fail("Некорректная строка override " + (i + 1) + ": " + lines[i]);
            }
            relPath = normalizeRelPath(trim(fields[0]));
            scale = Number(trim(fields[1]));
            if (!relPath || !isFinite(scale)) {
                fail("Некорректная строка override " + (i + 1) + ": " + lines[i]);
            }
            result[pathKey(relPath)] = {
                source_relpath: relPath,
                scale_percent: scale,
                reason: fields.length > 2 ? trim(fields[2]) : ""
            };
        }
        return result;
    }

    function containsNumber(values, needle) {
        var i;
        for (i = 0; i < values.length; i += 1) {
            if (Number(values[i]) === Number(needle)) {
                return true;
            }
        }
        return false;
    }

    function number(value, digits) {
        var factor = Math.pow(10, digits || 6);
        return Math.round(Number(value) * factor) / factor;
    }

    function arrayOfNumbers(value) {
        var result = [];
        var i;
        if (!value) {
            return result;
        }
        for (i = 0; i < value.length; i += 1) {
            result.push(number(value[i], 6));
        }
        return result;
    }

    function boundsInfo(bounds) {
        var values = arrayOfNumbers(bounds);
        return {
            rect: values,
            width: number(values[2] - values[0], 6),
            height: number(values[1] - values[3], 6),
            center_x: number((values[0] + values[2]) / 2, 6),
            center_y: number((values[1] + values[3]) / 2, 6)
        };
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
        var code;
        var character;
        for (i = 0; i < text.length; i += 1) {
            character = text.charAt(i);
            code = text.charCodeAt(i);
            if (character === "\"") {
                result += "\\\"";
            } else if (character === "\\") {
                result += "\\\\";
            } else if (character === "\b") {
                result += "\\b";
            } else if (character === "\f") {
                result += "\\f";
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

    function jsonStringify(value, indent, depth) {
        var currentDepth = depth || 0;
        var spacing = indent || "";
        var nextSpacing = spacing ? spacing + "  " : "";
        var type = typeof value;
        var parts = [];
        var i;
        var key;
        if (value === null || typeof value === "undefined") {
            return "null";
        }
        if (type === "string") {
            return jsonQuote(value);
        }
        if (type === "number") {
            return isFinite(value) ? String(value) : "null";
        }
        if (type === "boolean") {
            return value ? "true" : "false";
        }
        if (value instanceof Array) {
            for (i = 0; i < value.length; i += 1) {
                parts.push(jsonStringify(value[i], nextSpacing, currentDepth + 1));
            }
            if (!spacing || parts.length === 0) {
                return "[" + parts.join(",") + "]";
            }
            return "[\n" + nextSpacing + parts.join(",\n" + nextSpacing) + "\n" + spacing + "]";
        }
        for (key in value) {
            if (value.hasOwnProperty(key) && typeof value[key] !== "function") {
                parts.push(jsonQuote(key) + (spacing ? ": " : ":") +
                    jsonStringify(value[key], nextSpacing, currentDepth + 1));
            }
        }
        if (!spacing || parts.length === 0) {
            return "{" + parts.join(",") + "}";
        }
        return "{\n" + nextSpacing + parts.join(",\n" + nextSpacing) + "\n" + spacing + "}";
    }

    function csvCell(value) {
        var text = value === null || typeof value === "undefined" ? "" : String(value);
        return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }

    function csvLine(values) {
        var cells = [];
        var i;
        for (i = 0; i < values.length; i += 1) {
            cells.push(csvCell(values[i]));
        }
        return cells.join(",");
    }

    function uniqueFile(folder, stem, extension) {
        var candidate = new File(folder.fsName + "/" + stem + extension);
        var version = 2;
        while (candidate.exists) {
            candidate = new File(folder.fsName + "/" + stem + "_v" + version + extension);
            version += 1;
        }
        return candidate;
    }

    function uniqueOutputPair(folder, stem) {
        var candidateStem = stem;
        var version = 2;
        var aiFile = new File(folder.fsName + "/" + candidateStem + ".ai");
        var pngFile = new File(folder.fsName + "/" + candidateStem + ".png");
        while (aiFile.exists || pngFile.exists) {
            candidateStem = stem + "_v" + version;
            aiFile = new File(folder.fsName + "/" + candidateStem + ".ai");
            pngFile = new File(folder.fsName + "/" + candidateStem + ".png");
            version += 1;
        }
        return {
            stem: candidateStem,
            ai: aiFile,
            png: pngFile,
            png_base: new File(folder.fsName + "/" + candidateStem)
        };
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

    function safeLayerPath(item) {
        var names = [];
        var layer;
        try {
            layer = item.layer;
            while (layer && layer.typename === "Layer") {
                names.unshift(layer.name);
                layer = layer.parent;
            }
            return names.join("/");
        } catch (error) {
            return "";
        }
    }

    function safeArrayProperty(item, propertyName) {
        try {
            return arrayOfNumbers(item[propertyName]);
        } catch (error) {
            return null;
        }
    }

    function snapshotArtboards(document) {
        var result = [];
        var i;
        var artboard;
        var rect;
        for (i = 0; i < document.artboards.length; i += 1) {
            artboard = document.artboards[i];
            rect = boundsInfo(artboard.artboardRect);
            result.push({
                index: i,
                name: artboard.name,
                rect: rect.rect,
                width: rect.width,
                height: rect.height
            });
        }
        return result;
    }

    function snapshotLayers(document) {
        var states = [];
        var audit = [];

        function walk(layers, parentPath) {
            var i;
            var layer;
            var path;
            for (i = 0; i < layers.length; i += 1) {
                layer = layers[i];
                path = parentPath + "/" + i + ":" + layer.name;
                states.push({
                    ref: layer,
                    path: path,
                    index: i,
                    visible: layer.visible,
                    locked: layer.locked,
                    printable: layer.printable
                });
                audit.push({
                    path: path,
                    index: i,
                    name: layer.name,
                    visible: layer.visible,
                    locked: layer.locked,
                    printable: layer.printable
                });
                if (layer.layers && layer.layers.length) {
                    walk(layer.layers, path);
                }
            }
        }

        walk(document.layers, "");
        return {
            states: states,
            audit: audit
        };
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
        var states = [];
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
            states.push({
                ref: item,
                index: i,
                hidden: item.hidden,
                locked: item.locked
            });
            audit.push({
                index: i,
                typename: item.typename,
                name: safeName(item),
                layer: safeLayerName(item),
                layer_path: safeLayerPath(item),
                parent_typename: parentType,
                parent_name: parentName,
                hidden: item.hidden,
                locked: item.locked,
                position: safeArrayProperty(item, "position"),
                geometric_bounds: safeArrayProperty(item, "geometricBounds"),
                visible_bounds: safeArrayProperty(item, "visibleBounds")
            });
        }
        return {
            states: states,
            audit: audit
        };
    }

    function snapshotItemsLight(document) {
        var states = [];
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
            states.push({
                ref: item,
                index: i,
                hidden: item.hidden,
                locked: item.locked
            });
            audit.push({
                index: i,
                typename: item.typename,
                name: safeName(item),
                layer: safeLayerName(item),
                layer_path: safeLayerPath(item),
                parent_typename: parentType,
                parent_name: parentName,
                hidden: item.hidden,
                locked: item.locked
            });
        }
        return {
            states: states,
            audit: audit
        };
    }

    function makeEditable(layerStates, itemStates) {
        var failures = [];
        var i;
        for (i = 0; i < layerStates.length; i += 1) {
            try {
                layerStates[i].ref.locked = false;
                layerStates[i].ref.visible = true;
            } catch (layerError) {
                failures.push("layer:" + layerStates[i].path + ":" + layerError.message);
            }
        }
        for (i = 0; i < itemStates.length; i += 1) {
            try {
                itemStates[i].ref.locked = false;
                itemStates[i].ref.hidden = false;
            } catch (itemError) {
                failures.push("item:" + itemStates[i].index + ":" + itemError.message);
            }
        }
        if (failures.length) {
            fail("Не удалось временно разблокировать/показать объекты: " + failures.slice(0, 20).join("; "));
        }
    }

    function restoreStates(layerStates, itemStates) {
        var failures = [];
        var i;
        for (i = 0; i < itemStates.length; i += 1) {
            try {
                itemStates[i].ref.hidden = itemStates[i].hidden;
                itemStates[i].ref.locked = itemStates[i].locked;
            } catch (itemError) {
                failures.push("item:" + itemStates[i].index + ":" + itemError.message);
            }
        }
        for (i = layerStates.length - 1; i >= 0; i -= 1) {
            try {
                layerStates[i].ref.visible = layerStates[i].visible;
                layerStates[i].ref.locked = layerStates[i].locked;
            } catch (layerError) {
                failures.push("layer:" + layerStates[i].path + ":" + layerError.message);
            }
        }
        return failures;
    }

    function itemStatesMatch(itemStates) {
        var i;
        for (i = 0; i < itemStates.length; i += 1) {
            try {
                if (itemStates[i].ref.hidden !== itemStates[i].hidden ||
                        itemStates[i].ref.locked !== itemStates[i].locked) {
                    return false;
                }
            } catch (error) {
                return false;
            }
        }
        return true;
    }

    function collectStrokeRecords(document) {
        var records = [];
        var failures = [];
        var i;
        var pathItem;
        var textFrame;
        var character;
        var attributes;
        var color;

        for (i = 0; i < document.pathItems.length; i += 1) {
            pathItem = document.pathItems[i];
            try {
                if (pathItem.stroked) {
                    records.push({
                        kind: "path",
                        index: i,
                        ref: pathItem,
                        width: Number(pathItem.strokeWidth)
                    });
                }
            } catch (pathError) {
                failures.push("path:" + i + ":" + pathError.message);
            }
        }

        for (i = 0; i < document.textFrames.length; i += 1) {
            textFrame = document.textFrames[i];
            var characterIndex;
            for (characterIndex = 0; characterIndex < textFrame.characters.length; characterIndex += 1) {
                character = textFrame.characters[characterIndex];
                try {
                    attributes = character.characterAttributes;
                    color = attributes.strokeColor;
                    if (color && color.typename !== "NoColor") {
                        records.push({
                            kind: "text",
                            index: i + ":" + characterIndex,
                            ref: character,
                            width: Number(attributes.strokeWeight)
                        });
                    }
                } catch (textError) {
                    failures.push("text:" + i + ":" + characterIndex + ":" + textError.message);
                }
            }
        }

        return {
            records: records,
            failures: failures
        };
    }

    function currentStrokeWidth(record) {
        if (record.kind === "path") {
            return Number(record.ref.strokeWidth);
        }
        return Number(record.ref.characterAttributes.strokeWeight);
    }

    function setStrokeWidth(record, width) {
        if (record.kind === "path") {
            record.ref.strokeWidth = width;
        } else {
            record.ref.characterAttributes.strokeWeight = width;
        }
    }

    function strokeSummary(records, useCurrentValues) {
        var counts = {};
        var key;
        var value;
        var i;
        var keys = [];
        var result = [];
        for (i = 0; i < records.length; i += 1) {
            value = useCurrentValues ? currentStrokeWidth(records[i]) : records[i].width;
            key = String(number(value, 6));
            counts[key] = (counts[key] || 0) + 1;
        }
        for (key in counts) {
            if (counts.hasOwnProperty(key)) {
                keys.push(key);
            }
        }
        keys.sort(function (left, right) {
            return Number(left) - Number(right);
        });
        for (i = 0; i < keys.length; i += 1) {
            result.push({
                width_pt: Number(keys[i]),
                count: counts[keys[i]]
            });
        }
        return result;
    }

    function normalizeStrokes(records, targetWidth) {
        var failures = [];
        var i;
        for (i = 0; i < records.length; i += 1) {
            try {
                setStrokeWidth(records[i], targetWidth);
                records[i].width = currentStrokeWidth(records[i]);
            } catch (error) {
                failures.push(records[i].kind + ":" + records[i].index + ":" + error.message);
            }
        }
        if (failures.length) {
            fail("Не удалось нормализовать все доступные обводки: " + failures.slice(0, 20).join("; "));
        }
    }

    function compareStrokes(records, tolerance) {
        var mismatches = [];
        var i;
        var current;
        for (i = 0; i < records.length; i += 1) {
            try {
                current = currentStrokeWidth(records[i]);
                if (Math.abs(current - records[i].width) > tolerance) {
                    mismatches.push({
                        kind: records[i].kind,
                        index: records[i].index,
                        before_pt: number(records[i].width, 6),
                        after_pt: number(current, 6)
                    });
                }
            } catch (error) {
                mismatches.push({
                    kind: records[i].kind,
                    index: records[i].index,
                    before_pt: number(records[i].width, 6),
                    after_pt: null,
                    error: error.message
                });
            }
        }
        return mismatches;
    }

    function rootItems(document) {
        var result = [];
        var i;
        var item;
        var parentType;
        for (i = 0; i < document.pageItems.length; i += 1) {
            item = document.pageItems[i];
            try {
                parentType = item.parent ? item.parent.typename : "";
                if (parentType === "Layer") {
                    result.push(item);
                }
            } catch (error) {
                fail("Не удалось определить корневой объект " + i + ": " + error.message);
            }
        }
        return result;
    }

    function scaleRoots(roots, scalePercent) {
        var i;
        for (i = 0; i < roots.length; i += 1) {
            try {
                roots[i].resize(
                    scalePercent,
                    scalePercent,
                    true,
                    true,
                    true,
                    true,
                    100.0,
                    Transformation.DOCUMENTORIGIN
                );
            } catch (error) {
                fail("Ошибка масштабирования корневого объекта " + i + " (" +
                    roots[i].typename + "): " + error.message);
            }
        }
    }

    function translateRoots(roots, deltaX, deltaY) {
        var i;
        for (i = 0; i < roots.length; i += 1) {
            try {
                roots[i].translate(deltaX, deltaY, true, true, true, true);
            } catch (error) {
                fail("Ошибка перемещения корневого объекта " + i + " (" +
                    roots[i].typename + "): " + error.message);
            }
        }
    }

    function chooseScale(bounds, config) {
        var width = bounds.width;
        var height = bounds.height;
        var area = width * height;
        var areaConstant = Number(config.scale_area_constant_pt2);
        var maxSideTarget = Number(config.scale_max_side_target_pt);
        var artboard = Number(config.artboard_size_pt);
        var tolerance = Number(config.bounds_tolerance_pt || 0.01);
        var tieEpsilon = Number(config.scale_tie_epsilon || 0.000000001);
        var rawByArea = Math.sqrt(areaConstant / area);
        var rawBySide = maxSideTarget / Math.max(width, height);
        var raw = Math.min(rawByArea, rawBySide);
        var bestScale = null;
        var bestGap = Number.POSITIVE_INFINITY;
        var i;
        var scale;
        var scaleFactor;
        var scaledWidth;
        var scaledHeight;
        var gap;
        for (i = 0; i < config.allowed_scales.length; i += 1) {
            scale = Number(config.allowed_scales[i]);
            scaleFactor = scale / 100;
            scaledWidth = width * scale / 100;
            scaledHeight = height * scale / 100;
            if (scaledWidth <= artboard + tolerance && scaledHeight <= artboard + tolerance) {
                gap = Math.abs(scaleFactor - raw);
                if (bestScale === null || gap < bestGap - tieEpsilon ||
                        (Math.abs(gap - bestGap) <= tieEpsilon && scale < bestScale)) {
                    bestScale = scale;
                    bestGap = gap;
                }
            }
        }
        return {
            bbox_area_pt2: number(area, 6),
            raw_by_area: number(rawByArea, 9),
            raw_by_side: number(rawBySide, 9),
            raw: number(raw, 9),
            scale_percent: bestScale
        };
    }

    function validateScale(scale, bounds, config, isOverride) {
        var allowed = containsNumber(config.allowed_scales, scale);
        var manual = containsNumber(config.manual_override_scales || [], scale);
        var width = bounds.width * scale / 100;
        var height = bounds.height * scale / 100;
        var limit = Number(config.artboard_size_pt) + Number(config.bounds_tolerance_pt || 0.01);
        if (!allowed && !(isOverride && manual)) {
            fail("Масштаб " + scale + "% не разрешён" +
                (manual ? " без ручного override" : "") + ".");
        }
        if (width > limit || height > limit) {
            fail("Масштаб " + scale + "% выводит visibleBounds за пределы " +
                config.artboard_size_pt + "×" + config.artboard_size_pt + " pt.");
        }
    }

    function setSingleArtboard(document, size) {
        var i;
        document.artboards.setActiveArtboardIndex(0);
        for (i = document.artboards.length - 1; i >= 1; i -= 1) {
            document.artboards[i].remove();
        }
        document.artboards[0].artboardRect = [0, size, size, 0];
        document.artboards.setActiveArtboardIndex(0);
    }

    function saveAi(document, file, config) {
        var options = new IllustratorSaveOptions();
        options.pdfCompatible = config.pdf_compatible !== false;
        options.compressed = true;
        options.saveMultipleArtboards = false;
        document.saveAs(file, options);
    }

    function exportPng(document, fileBase, config) {
        var options = new ExportOptionsPNG24();
        options.antiAliasing = true;
        options.artBoardClipping = true;
        options.horizontalScale = Number(config.png_scale_percent || 100);
        options.verticalScale = Number(config.png_scale_percent || 100);
        options.transparency = true;
        options.matte = false;
        document.exportFile(fileBase, ExportType.PNG24, options);
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
                itemAudit[i].layer_path + "|" +
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

    function itemTypeCounts(itemAudit) {
        var counts = {};
        var keys = [];
        var result = [];
        var key;
        var i;
        for (i = 0; i < itemAudit.length; i += 1) {
            key = itemAudit[i].typename;
            counts[key] = (counts[key] || 0) + 1;
        }
        for (key in counts) {
            if (counts.hasOwnProperty(key)) {
                keys.push(key);
            }
        }
        keys.sort();
        for (i = 0; i < keys.length; i += 1) {
            result.push({
                typename: keys[i],
                count: counts[keys[i]]
            });
        }
        return result;
    }

    function sameNumberArray(left, right, tolerance) {
        var i;
        if (left === null && right === null) {
            return true;
        }
        if (!left || !right || left.length !== right.length) {
            return false;
        }
        for (i = 0; i < left.length; i += 1) {
            if (Math.abs(Number(left[i]) - Number(right[i])) > tolerance) {
                return false;
            }
        }
        return true;
    }

    function compareItemGeometry(expectedAudit, actualAudit, tolerance) {
        var failures = [];
        var i;
        if (expectedAudit.length !== actualAudit.length) {
            failures.push("count:" + expectedAudit.length + "!=" + actualAudit.length);
            return failures;
        }
        for (i = 0; i < expectedAudit.length; i += 1) {
            if (!sameNumberArray(
                    expectedAudit[i].position,
                    actualAudit[i].position,
                    tolerance
                ) ||
                    !sameNumberArray(
                        expectedAudit[i].geometric_bounds,
                        actualAudit[i].geometric_bounds,
                        tolerance
                    ) ||
                    !sameNumberArray(
                        expectedAudit[i].visible_bounds,
                        actualAudit[i].visible_bounds,
                        tolerance
                    )) {
                failures.push(i);
                if (failures.length >= 20) {
                    break;
                }
            }
        }
        return failures;
    }

    function targetStrokeMismatches(document, targetWidth, tolerance) {
        var collection = collectStrokeRecords(document);
        var mismatches = [];
        var i;
        var width;
        if (collection.failures.length) {
            fail("Не удалось проверить все обводки целевого документа: " +
                collection.failures.slice(0, 20).join("; "));
        }
        for (i = 0; i < collection.records.length; i += 1) {
            width = currentStrokeWidth(collection.records[i]);
            if (Math.abs(width - targetWidth) > tolerance) {
                mismatches.push({
                    kind: collection.records[i].kind,
                    index: collection.records[i].index,
                    width_pt: number(width, 6)
                });
                if (mismatches.length >= 20) {
                    break;
                }
            }
        }
        return {
            records: collection.records,
            mismatches: mismatches
        };
    }

    function applyStatesToTarget(targetDocument, sourceLayerSnapshot, sourceItemSnapshot) {
        var targetLayerSnapshot = snapshotLayers(targetDocument);
        var targetItemSnapshot = snapshotItems(targetDocument);
        var i;

        if (targetLayerSnapshot.states.length !== sourceLayerSnapshot.states.length) {
            fail("После переноса изменилось число слоёв: было " +
                sourceLayerSnapshot.states.length + ", стало " +
                targetLayerSnapshot.states.length + ".");
        }
        if (targetItemSnapshot.states.length !== sourceItemSnapshot.states.length) {
            fail("После переноса изменилось число объектов: было " +
                sourceItemSnapshot.states.length + ", стало " +
                targetItemSnapshot.states.length + ".");
        }
        if (itemStructureSignature(targetItemSnapshot.audit) !==
                itemStructureSignature(sourceItemSnapshot.audit)) {
            fail("После переноса изменились структура или порядок объектов.");
        }

        for (i = 0; i < targetItemSnapshot.states.length; i += 1) {
            targetItemSnapshot.states[i].ref.hidden = sourceItemSnapshot.states[i].hidden;
            targetItemSnapshot.states[i].ref.locked = sourceItemSnapshot.states[i].locked;
            targetItemSnapshot.audit[i].hidden = sourceItemSnapshot.states[i].hidden;
            targetItemSnapshot.audit[i].locked = sourceItemSnapshot.states[i].locked;
        }
        for (i = targetLayerSnapshot.states.length - 1; i >= 0; i -= 1) {
            if (targetLayerSnapshot.states[i].path !== sourceLayerSnapshot.states[i].path) {
                fail("После переноса изменились структура или порядок слоёв.");
            }
            targetLayerSnapshot.states[i].ref.printable =
                sourceLayerSnapshot.states[i].printable;
            targetLayerSnapshot.states[i].ref.visible =
                sourceLayerSnapshot.states[i].visible;
            targetLayerSnapshot.states[i].ref.locked =
                sourceLayerSnapshot.states[i].locked;
            targetLayerSnapshot.audit[i].printable =
                sourceLayerSnapshot.states[i].printable;
            targetLayerSnapshot.audit[i].visible =
                sourceLayerSnapshot.states[i].visible;
            targetLayerSnapshot.audit[i].locked =
                sourceLayerSnapshot.states[i].locked;
        }

        return {
            layers: targetLayerSnapshot,
            items: targetItemSnapshot
        };
    }

    function createPixelDocument(sourceDocument, size) {
        var preset = new DocumentPreset();
        preset.title = "MKD2 site output";
        preset.width = size;
        preset.height = size;
        preset.units = RulerUnits.Pixels;
        preset.numArtboards = 1;
        preset.colorMode = sourceDocument.documentColorSpace;
        var targetDocument = app.documents.addDocument("", preset, false);
        targetDocument.artboards[0].artboardRect = [0, size, size, 0];
        return targetDocument;
    }

    function createLayerTree(sourceLayers, targetContainer) {
        var i;
        var targetLayer;
        for (i = sourceLayers.length - 1; i >= 0; i -= 1) {
            targetLayer = targetContainer.layers.add();
            targetLayer.name = sourceLayers[i].name;
            if (sourceLayers[i].layers && sourceLayers[i].layers.length) {
                createLayerTree(sourceLayers[i].layers, targetLayer);
            }
        }
    }

    function directItemsInLayer(document, layer) {
        var result = [];
        var i;
        var item;
        for (i = 0; i < document.pageItems.length; i += 1) {
            item = document.pageItems[i];
            try {
                if (item.parent === layer) {
                    result.push(item);
                }
            } catch (error) {
                fail("Не удалось определить родительский слой объекта " +
                    i + ": " + error.message);
            }
        }
        return result;
    }

    function copyLayerContents(
        sourceDocument,
        targetDocument,
        sourceLayers,
        targetLayers
    ) {
        var i;
        var j;
        var items;
        if (sourceLayers.length !== targetLayers.length) {
            fail("Не совпало число слоёв при послойном переносе.");
        }
        for (i = 0; i < sourceLayers.length; i += 1) {
            items = directItemsInLayer(sourceDocument, sourceLayers[i]);
            if (items.length) {
                sourceDocument.activate();
                sourceDocument.selection = null;
                for (j = 0; j < items.length; j += 1) {
                    items[j].selected = true;
                }
                app.executeMenuCommand("copy");
                sourceDocument.selection = null;

                targetDocument.activate();
                targetDocument.activeLayer = targetLayers[i];
                app.executeMenuCommand("pasteInPlace");
                targetDocument.selection = null;
            }
            if (sourceLayers[i].layers && sourceLayers[i].layers.length) {
                copyLayerContents(
                    sourceDocument,
                    targetDocument,
                    sourceLayers[i].layers,
                    targetLayers[i].layers
                );
            }
        }
    }

    function copyLayerAppearance(sourceLayers, targetLayers) {
        var i;
        if (sourceLayers.length !== targetLayers.length) {
            fail("Не совпало число слоёв при переносе свойств.");
        }
        for (i = 0; i < sourceLayers.length; i += 1) {
            try {
                targetLayers[i].opacity = sourceLayers[i].opacity;
            } catch (opacityError) {
            }
            try {
                targetLayers[i].blendingMode = sourceLayers[i].blendingMode;
            } catch (blendError) {
            }
            try {
                targetLayers[i].artworkKnockout =
                    sourceLayers[i].artworkKnockout;
            } catch (knockoutError) {
            }
            try {
                targetLayers[i].dimPlacedImages =
                    sourceLayers[i].dimPlacedImages;
            } catch (dimError) {
            }
            try {
                targetLayers[i].preview = sourceLayers[i].preview;
            } catch (previewError) {
            }
            try {
                targetLayers[i].color = sourceLayers[i].color;
            } catch (colorError) {
            }
            if (sourceLayers[i].layers && sourceLayers[i].layers.length) {
                copyLayerAppearance(
                    sourceLayers[i].layers,
                    targetLayers[i].layers
                );
            }
        }
    }

    function findUniqueLayerByName(layers, name) {
        var match = null;
        var matches = 0;
        var i;
        for (i = 0; i < layers.length; i += 1) {
            if (layers[i].name === name) {
                match = layers[i];
                matches += 1;
            }
        }
        if (matches > 1) {
            fail("В целевом документе неоднозначное имя слоя: " + name);
        }
        return match;
    }

    function restoreMissingEmptyLayers(sourceLayers, targetContainer) {
        var i;
        var sourceLayer;
        var targetLayer;
        var previousTargetLayer;
        for (i = 0; i < sourceLayers.length; i += 1) {
            sourceLayer = sourceLayers[i];
            targetLayer = findUniqueLayerByName(
                targetContainer.layers,
                sourceLayer.name
            );
            if (!targetLayer) {
                if (sourceLayer.pageItems.length !== 0 ||
                        sourceLayer.layers.length !== 0) {
                    fail("После вставки отсутствует непустой слой: " +
                        sourceLayer.name);
                }
                targetLayer = targetContainer.layers.add();
                targetLayer.name = sourceLayer.name;
                if (i > 0) {
                    previousTargetLayer = findUniqueLayerByName(
                        targetContainer.layers,
                        sourceLayers[i - 1].name
                    );
                    if (!previousTargetLayer) {
                        fail("Не найден предыдущий слой для восстановления порядка: " +
                            sourceLayer.name);
                    }
                    targetLayer.move(
                        previousTargetLayer,
                        ElementPlacement.PLACEAFTER
                    );
                }
            }
            if (sourceLayer.layers && sourceLayer.layers.length) {
                restoreMissingEmptyLayers(sourceLayer.layers, targetLayer);
            }
        }
    }

    function copyArtworkWithLayers(
        sourceDocument,
        targetDocument,
        sourceLayerSnapshot,
        sourceItemSnapshot
    ) {
        var defaultLayer = targetDocument.layers[0];
        var originalPasteRemembersLayers = app.pasteRemembersLayers;
        var targetSnapshots;
        var transferRoots;

        try {
            sourceDocument.activate();
            makeEditable(sourceLayerSnapshot.states, sourceItemSnapshot.states);
            sourceDocument.selection = null;
            app.pasteRemembersLayers = true;
            if (app.pasteRemembersLayers !== true) {
                fail("Illustrator не включил Paste Remembers Layers.");
            }
            transferRoots = rootItems(sourceDocument);
            app.executeMenuCommand("selectall");
            if (!sourceDocument.selection ||
                    sourceDocument.selection.length !== transferRoots.length) {
                fail("Illustrator выделил не все корневые объекты для " +
                    "pixel-native переноса: ожидалось " + transferRoots.length +
                    ", выделено " +
                    (sourceDocument.selection ?
                        sourceDocument.selection.length : 0) + ".");
            }
            app.executeMenuCommand("copy");
            sourceDocument.selection = null;

            targetDocument.activate();
            app.executeMenuCommand("pasteInPlace");
            targetDocument.selection = null;

            defaultLayer.locked = false;
            defaultLayer.visible = true;
            if (defaultLayer.pageItems.length !== 0 ||
                    defaultLayer.layers.length !== 0) {
                fail("Дефолтный слой целевого документа не пуст после переноса.");
            }
            defaultLayer.remove();
            restoreMissingEmptyLayers(
                sourceDocument.layers,
                targetDocument
            );
            copyLayerAppearance(
                sourceDocument.layers,
                targetDocument.layers
            );
        } finally {
            app.pasteRemembersLayers = originalPasteRemembersLayers;
            sourceDocument.activate();
            restoreStates(sourceLayerSnapshot.states, sourceItemSnapshot.states);
        }

        targetDocument.activate();
        targetSnapshots = applyStatesToTarget(
            targetDocument,
            sourceLayerSnapshot,
            sourceItemSnapshot
        );
        return targetSnapshots;
    }

    function verifyOpenOutputDocument(document, expected, config) {
        var tolerance = Number(config.bounds_tolerance_pt || 0.02);
        var strokeTolerance = Number(config.stroke_tolerance_pt || 0.0001);
        var size = Number(config.artboard_size_pt);
        var artboards = snapshotArtboards(document);
        var visible = boundsInfo(document.visibleBounds);
        var layers = snapshotLayers(document);
        var items = snapshotItems(document);
        var geometryFailures = compareItemGeometry(
            expected.item_geometry,
            items.audit,
            tolerance
        );
        var strokeCheck = targetStrokeMismatches(
            document,
            Number(config.stroke_width_pt),
            strokeTolerance
        );

        if (document.rulerUnits !== RulerUnits.Pixels) {
            fail("После повторного открытия единицы документа не Pixels.");
        }
        if (artboards.length !== 1 ||
                Math.abs(artboards[0].width - size) > tolerance ||
                Math.abs(artboards[0].height - size) > tolerance) {
            fail("После повторного открытия монтажная область не равна 1200×1200 px.");
        }
        if (Math.abs(visible.center_x - size / 2) > tolerance ||
                Math.abs(visible.center_y - size / 2) > tolerance) {
            fail("После повторного открытия центр visibleBounds не равен (600, 600).");
        }
        if (visible.rect[0] < -tolerance ||
                visible.rect[2] > size + tolerance ||
                visible.rect[1] > size + tolerance ||
                visible.rect[3] < -tolerance) {
            fail("После повторного открытия visibleBounds выходит за монтажную область.");
        }
        if (layerSignature(layers.audit) !== expected.layer_signature) {
            fail("После повторного открытия изменилась сигнатура слоёв.");
        }
        if (itemStructureSignature(items.audit) !== expected.item_structure_signature) {
            fail("После повторного открытия изменилась структура объектов.");
        }
        if (itemStateSignature(items.audit) !== expected.item_state_signature) {
            fail("После повторного открытия изменились состояния объектов.");
        }
        if (items.audit.length !== expected.item_count) {
            fail("После повторного открытия изменилось число объектов.");
        }
        if (geometryFailures.length) {
            fail("После повторного открытия изменилась геометрия объектов: " +
                geometryFailures.slice(0, 20).join(",") + ".");
        }
        if (strokeCheck.mismatches.length) {
            fail("После повторного открытия не все обводки равны 0.75 px.");
        }
        if (document.documentColorSpace !== expected.color_space) {
            fail("После повторного открытия изменился цветовой режим документа.");
        }

        return {
            ruler_units_pixels: true,
            artboards: artboards,
            visible_bounds: visible,
            center_ok: true,
            inside_artboard: true,
            layer_signature_match: true,
            item_structure_match: true,
            item_state_match: true,
            item_geometry_match: true,
            item_count: items.audit.length,
            stroke_count: strokeCheck.records.length,
            stroke_widths: strokeSummary(strokeCheck.records, true),
            stroke_mismatch_count: 0,
            color_space_match: true
        };
    }

    function removeIfExists(file) {
        if (file && file.exists) {
            return file.remove();
        }
        return true;
    }

    function copyWithoutOverwrite(source, target) {
        if (target.exists) {
            fail("Запрещена перезапись существующего результата: " + target.fsName);
        }
        if (!source.copy(target.fsName) || !target.exists || target.length <= 0) {
            fail("Не удалось опубликовать файл: " + target.fsName);
        }
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
            "status",
            "timestamp",
            "source_relpath",
            "corpus",
            "source_ai",
            "reference_png",
            "scale_mode",
            "calculated_scale_percent",
            "applied_scale_percent",
            "expected_scale_percent",
            "artboards_before",
            "visible_bounds_before",
            "visible_width_before_pt",
            "visible_height_before_pt",
            "page_items_before",
            "layers_before",
            "stroke_widths_original",
            "stroked_objects",
            "stroke_widths_before_scale",
            "stroke_widths_after_scale",
            "stroke_mismatch_count",
            "final_visible_bounds",
            "final_visible_width_pt",
            "final_visible_height_pt",
            "final_artboard",
            "layer_state_match",
            "item_state_match",
            "output_ai",
            "output_png",
            "audit_json",
            "comment"
        ];
    }

    function reportValues(row) {
        return [
            row.status,
            row.timestamp,
            row.source_relpath,
            row.corpus,
            row.source_ai,
            row.reference_png,
            row.scale_mode,
            row.calculated_scale_percent,
            row.applied_scale_percent,
            row.expected_scale_percent,
            row.artboards_before,
            row.visible_bounds_before,
            row.visible_width_before_pt,
            row.visible_height_before_pt,
            row.page_items_before,
            row.layers_before,
            row.stroke_widths_original,
            row.stroked_objects,
            row.stroke_widths_before_scale,
            row.stroke_widths_after_scale,
            row.stroke_mismatch_count,
            row.final_visible_bounds,
            row.final_visible_width_pt,
            row.final_visible_height_pt,
            row.final_artboard,
            row.layer_state_match,
            row.item_state_match,
            row.output_ai,
            row.output_png,
            row.audit_json,
            row.comment
        ];
    }

    function emptyRow(entry, sourceFile, referencePng) {
        var relPath = normalizeRelPath(entry.path);
        return {
            status: "ERROR",
            timestamp: nowIso(),
            source_relpath: relPath,
            corpus: relPath.split("/")[0] || "",
            source_ai: sourceFile.fsName,
            reference_png: referencePng.fsName,
            scale_mode: "",
            calculated_scale_percent: "",
            applied_scale_percent: "",
            expected_scale_percent: typeof entry.expected_scale === "undefined" ? "" : entry.expected_scale,
            artboards_before: "",
            visible_bounds_before: "",
            visible_width_before_pt: "",
            visible_height_before_pt: "",
            page_items_before: "",
            layers_before: "",
            stroke_widths_original: "",
            stroked_objects: "",
            stroke_widths_before_scale: "",
            stroke_widths_after_scale: "",
            stroke_mismatch_count: "",
            final_visible_bounds: "",
            final_visible_width_pt: "",
            final_visible_height_pt: "",
            final_artboard: "",
            layer_state_match: "",
            item_state_match: "",
            output_ai: "",
            output_png: "",
            audit_json: "",
            comment: ""
        };
    }

    function processOne(entry, context) {
        var relPath = normalizeRelPath(entry.path);
        var sourceFile = new File(context.sourceRoot.fsName + "/" + relPath);
        var referencePng = new File(sourceFile.fsName.replace(/\.ai$/i, ".png"));
        var row = emptyRow(entry, sourceFile, referencePng);
        var audit = {
            schema_version: 1,
            script_version: SCRIPT_VERSION,
            timestamp: row.timestamp,
            source_relpath: relPath,
            source_ai: sourceFile.fsName,
            reference_png: referencePng.fsName
        };
        var document = null;
        var layerSnapshot = null;
        var itemSnapshot = null;
        var roots = null;
        var outputPair = null;
        var createdAi = false;
        var createdPng = false;
        var auditFile = null;
        var originalStrokes;
        var strokeRecords;
        var strokeMismatches;
        var override;
        var scaleCalculation;
        var calculatedScale;
        var appliedScale;
        var beforeBounds;
        var scaledBounds;
        var finalBounds;
        var restoreFailures;
        var layersAfter;
        var outputFolder;
        var outputStem;
        var originalLayerSignature;
        var currentLayerSignature;

        try {
            if (!sourceFile.exists) {
                fail("Исходный AI не найден: " + sourceFile.fsName);
            }
            if (!referencePng.exists) {
                fail("Визуальный PNG-эталон не найден: " + referencePng.fsName);
            }

            document = app.open(sourceFile);
            document.selection = null;

            audit.document_name = document.name;
            audit.artboards_before = snapshotArtboards(document);
            beforeBounds = boundsInfo(document.visibleBounds);
            audit.visible_bounds_before = beforeBounds;
            row.artboards_before = audit.artboards_before.length;
            row.visible_bounds_before = jsonStringify(beforeBounds.rect, "", 0);
            row.visible_width_before_pt = beforeBounds.width;
            row.visible_height_before_pt = beforeBounds.height;

            layerSnapshot = snapshotLayers(document);
            itemSnapshot = snapshotItems(document);
            originalLayerSignature = layerSignature(layerSnapshot.audit);
            audit.layers_before = layerSnapshot.audit;
            audit.objects_before = itemSnapshot.audit;
            row.page_items_before = itemSnapshot.audit.length;
            row.layers_before = layerSnapshot.audit.length;

            originalStrokes = collectStrokeRecords(document);
            if (originalStrokes.failures.length) {
                fail("Не удалось прочитать все доступные обводки: " +
                    originalStrokes.failures.slice(0, 20).join("; "));
            }
            audit.stroke_widths_original = strokeSummary(originalStrokes.records, false);
            audit.stroked_object_count = originalStrokes.records.length;
            row.stroke_widths_original = jsonStringify(audit.stroke_widths_original, "", 0);
            row.stroked_objects = originalStrokes.records.length;

            scaleCalculation = chooseScale(beforeBounds, context.config);
            calculatedScale = scaleCalculation.scale_percent;
            if (calculatedScale === null) {
                fail("Ни один автоматический масштаб не помещается в монтажную область.");
            }
            row.calculated_scale_percent = calculatedScale;
            audit.calculated_scale_percent = calculatedScale;
            audit.scale_calculation = scaleCalculation;

            override = context.overrides[pathKey(relPath)];
            if (override) {
                appliedScale = Number(override.scale_percent);
                row.scale_mode = "override";
                audit.scale_override = override;
            } else {
                appliedScale = calculatedScale;
                row.scale_mode = "calculated";
            }
            validateScale(appliedScale, beforeBounds, context.config, !!override);
            row.applied_scale_percent = appliedScale;
            audit.applied_scale_percent = appliedScale;

            if (typeof entry.expected_scale !== "undefined" &&
                    Number(entry.expected_scale) !== Number(appliedScale)) {
                fail("Контроль пилота: ожидался масштаб " + entry.expected_scale +
                    "%, рассчитан " + appliedScale + "%.");
            }

            makeEditable(layerSnapshot.states, itemSnapshot.states);
            strokeRecords = collectStrokeRecords(document);
            if (strokeRecords.failures.length) {
                fail("Не удалось повторно прочитать все обводки: " +
                    strokeRecords.failures.slice(0, 20).join("; "));
            }
            normalizeStrokes(strokeRecords.records, Number(context.config.stroke_width_pt));
            audit.stroke_widths_before_scale = strokeSummary(strokeRecords.records, true);
            row.stroke_widths_before_scale = jsonStringify(audit.stroke_widths_before_scale, "", 0);

            roots = rootItems(document);
            audit.root_item_count = roots.length;
            if (!roots.length) {
                fail("В документе нет корневых объектов для масштабирования.");
            }
            scaleRoots(roots, appliedScale);

            strokeMismatches = compareStrokes(
                strokeRecords.records,
                Number(context.config.stroke_tolerance_pt || 0.0001)
            );
            if (strokeMismatches.length) {
                audit.stroke_mismatches_after_scale = strokeMismatches;
                row.stroke_mismatch_count = strokeMismatches.length;
                fail("После масштабирования изменились обводки: " +
                    strokeMismatches.length + " несовпадений.");
            }

            restoreFailures = restoreStates(layerSnapshot.states, itemSnapshot.states);
            if (restoreFailures.length) {
                fail("Не удалось восстановить состояния до центрирования: " +
                    restoreFailures.slice(0, 20).join("; "));
            }

            scaledBounds = boundsInfo(document.visibleBounds);
            audit.visible_bounds_after_scale_before_center = scaledBounds;

            makeEditable(layerSnapshot.states, itemSnapshot.states);
            setSingleArtboard(document, Number(context.config.artboard_size_pt));
            translateRoots(
                roots,
                Number(context.config.artboard_size_pt) / 2 - scaledBounds.center_x,
                Number(context.config.artboard_size_pt) / 2 - scaledBounds.center_y
            );

            restoreFailures = restoreStates(layerSnapshot.states, itemSnapshot.states);
            if (restoreFailures.length) {
                fail("Не удалось восстановить состояния после центрирования: " +
                    restoreFailures.slice(0, 20).join("; "));
            }

            finalBounds = boundsInfo(document.visibleBounds);
            audit.visible_bounds_final = finalBounds;
            audit.artboards_final = snapshotArtboards(document);
            row.final_visible_bounds = jsonStringify(finalBounds.rect, "", 0);
            row.final_visible_width_pt = finalBounds.width;
            row.final_visible_height_pt = finalBounds.height;
            row.final_artboard = jsonStringify(audit.artboards_final, "", 0);

            strokeMismatches = compareStrokes(
                strokeRecords.records,
                Number(context.config.stroke_tolerance_pt || 0.0001)
            );
            audit.stroke_widths_after_scale = strokeSummary(strokeRecords.records, true);
            audit.stroke_mismatches_final = strokeMismatches;
            row.stroke_widths_after_scale = jsonStringify(audit.stroke_widths_after_scale, "", 0);
            row.stroke_mismatch_count = strokeMismatches.length;
            if (strokeMismatches.length) {
                fail("После центрирования изменились обводки: " +
                    strokeMismatches.length + " несовпадений.");
            }

            if (document.artboards.length !== 1 ||
                    Math.abs(audit.artboards_final[0].width - Number(context.config.artboard_size_pt)) >
                        Number(context.config.bounds_tolerance_pt || 0.01) ||
                    Math.abs(audit.artboards_final[0].height - Number(context.config.artboard_size_pt)) >
                        Number(context.config.bounds_tolerance_pt || 0.01)) {
                fail("Финальная монтажная область не равна 1200×1200 pt.");
            }

            if (finalBounds.rect[0] < -Number(context.config.bounds_tolerance_pt || 0.01) ||
                    finalBounds.rect[2] > Number(context.config.artboard_size_pt) +
                        Number(context.config.bounds_tolerance_pt || 0.01) ||
                    finalBounds.rect[1] > Number(context.config.artboard_size_pt) +
                        Number(context.config.bounds_tolerance_pt || 0.01) ||
                    finalBounds.rect[3] < -Number(context.config.bounds_tolerance_pt || 0.01)) {
                fail("Финальный visibleBounds выходит за монтажную область.");
            }

            layersAfter = snapshotLayers(document);
            currentLayerSignature = layerSignature(layersAfter.audit);
            row.layer_state_match = currentLayerSignature === originalLayerSignature ? "true" : "false";
            row.item_state_match = itemStatesMatch(itemSnapshot.states) ? "true" : "false";
            audit.layers_final = layersAfter.audit;
            audit.layer_state_match = row.layer_state_match === "true";
            audit.item_state_match = row.item_state_match === "true";
            if (row.layer_state_match !== "true" || row.item_state_match !== "true") {
                fail("Не восстановлены исходные состояния слоёв или объектов.");
            }

            if (document.pageItems.length !== itemSnapshot.audit.length) {
                fail("Изменилось число объектов: было " + itemSnapshot.audit.length +
                    ", стало " + document.pageItems.length + ".");
            }

            outputFolder = new Folder(context.pilotRoot.fsName + "/" + row.corpus);
            ensureFolder(outputFolder);
            outputStem = String(context.config.output_prefix || "х") +
                appliedScale + "_" + sourceFile.displayName.replace(/\.ai$/i, "");
            outputPair = uniqueOutputPair(outputFolder, outputStem);
            saveAi(document, outputPair.ai, context.config);
            createdAi = outputPair.ai.exists;
            exportPng(document, outputPair.png_base, context.config);
            createdPng = outputPair.png.exists;
            if (!createdAi || !createdPng) {
                fail("Illustrator не создал оба выходных файла.");
            }

            row.output_ai = outputPair.ai.fsName;
            row.output_png = outputPair.png.fsName;
            audit.output_ai = outputPair.ai.fsName;
            audit.output_png = outputPair.png.fsName;
            row.status = "OK";
            row.comment = "Обводки нормализованы до " + context.config.stroke_width_pt +
                " pt и сохранены при changeLineWidths=100.0; s_raw=" +
                scaleCalculation.raw + ".";
        } catch (error) {
            row.status = "ERROR";
            row.comment = errorText(error);
            audit.error = row.comment;

            if (createdPng && outputPair && outputPair.png.exists) {
                outputPair.png.remove();
                createdPng = false;
            }
            if (createdAi && outputPair && outputPair.ai.exists) {
                outputPair.ai.remove();
                createdAi = false;
            }
            row.output_ai = "";
            row.output_png = "";
        } finally {
            if (document) {
                if (layerSnapshot && itemSnapshot) {
                    try {
                        restoreStates(layerSnapshot.states, itemSnapshot.states);
                    } catch (restoreError) {
                        row.comment += " | Ошибка финального восстановления: " +
                            errorText(restoreError);
                    }
                }
                try {
                    document.close(SaveOptions.DONOTSAVECHANGES);
                } catch (closeError) {
                    row.comment += " | Ошибка закрытия: " + errorText(closeError);
                }
            }

            try {
                audit.status = row.status;
                audit.comment = row.comment;
                auditFile = uniqueFile(
                    context.detailsRoot,
                    sourceFile.displayName.replace(/\.ai$/i, "") + "_audit",
                    ".json"
                );
                writeText(auditFile, jsonStringify(audit, "", 0));
                row.audit_json = auditFile.fsName;
            } catch (auditError) {
                row.comment += " | Не удалось записать audit JSON: " +
                    errorText(auditError);
            }
        }

        return row;
    }

    function fullReportHeaders() {
        return [
            "batch_id",
            "index",
            "attempt",
            "status",
            "timestamp",
            "source_relpath",
            "corpus",
            "source_ai",
            "reference_png",
            "source_size_bytes",
            "source_sha256_before",
            "source_hash_preverified",
            "scale_mode",
            "calculated_scale_percent",
            "applied_scale_percent",
            "s_raw",
            "artboards_before",
            "visible_bounds_before",
            "visible_width_before_pt",
            "visible_height_before_pt",
            "page_items_before",
            "layers_before",
            "stroke_widths_original",
            "stroked_objects",
            "stroke_widths_before_scale",
            "stroke_widths_after_scale",
            "stroke_mismatch_count",
            "final_visible_bounds",
            "final_visible_width_pt",
            "final_visible_height_pt",
            "final_center_x",
            "final_center_y",
            "final_artboard",
            "layer_state_match",
            "item_state_match",
            "item_structure_match",
            "item_geometry_match_after_reopen",
            "ruler_units_pixels_after_reopen",
            "output_ai",
            "output_png",
            "audit_json",
            "comment"
        ];
    }

    function fullReportValues(row) {
        var headers = fullReportHeaders();
        var values = [];
        var i;
        for (i = 0; i < headers.length; i += 1) {
            values.push(row[headers[i]]);
        }
        return values;
    }

    function fullEmptyRow(entry, sourceFile, referencePng) {
        return {
            batch_id: entry.batch_id || "",
            index: entry.index,
            attempt: entry.attempt,
            status: "ERROR",
            timestamp: nowIso(),
            source_relpath: normalizeRelPath(entry.source_relpath),
            corpus: entry.corpus || normalizeRelPath(entry.source_relpath).split("/")[0],
            source_ai: sourceFile.fsName,
            reference_png: referencePng.fsName,
            source_size_bytes: entry.source_size_bytes,
            source_sha256_before: entry.source_sha256_before,
            source_hash_preverified: entry.source_hash_preverified === true ? "true" : "false",
            scale_mode: "",
            calculated_scale_percent: "",
            applied_scale_percent: "",
            s_raw: "",
            artboards_before: "",
            visible_bounds_before: "",
            visible_width_before_pt: "",
            visible_height_before_pt: "",
            page_items_before: "",
            layers_before: "",
            stroke_widths_original: "",
            stroked_objects: "",
            stroke_widths_before_scale: "",
            stroke_widths_after_scale: "",
            stroke_mismatch_count: "",
            final_visible_bounds: "",
            final_visible_width_pt: "",
            final_visible_height_pt: "",
            final_center_x: "",
            final_center_y: "",
            final_artboard: "",
            layer_state_match: "",
            item_state_match: "",
            item_structure_match: "",
            item_geometry_match_after_reopen: "",
            ruler_units_pixels_after_reopen: "",
            output_ai: "",
            output_png: "",
            audit_json: "",
            comment: ""
        };
    }

    function appendFullReportRow(reportFile, row) {
        var line = csvLine(fullReportValues(row)) + "\r\n";
        if (reportFile.exists) {
            appendText(reportFile, line);
        } else {
            writeText(
                reportFile,
                csvLine(fullReportHeaders()) + "\r\n" + line
            );
        }
    }

    function processFullOne(entry, context) {
        var sourceFile = new File(entry.source_ai);
        var referencePng = new File(entry.reference_png);
        var outputFolder = new Folder(entry.output_dir);
        var stagingFolder = new Folder(entry.staging_dir);
        var outputAi = null;
        var outputPng = null;
        var stagingAi = null;
        var stagingPng = null;
        var stagingPngBase = null;
        var auditFile = new File(entry.audit_json);
        var row = fullEmptyRow(entry, sourceFile, referencePng);
        var audit = {
            schema_version: 2,
            script_version: SCRIPT_VERSION,
            run_id: context.job.run_id,
            batch_id: row.batch_id,
            index: entry.index,
            attempt: entry.attempt,
            timestamp: row.timestamp,
            source_relpath: row.source_relpath,
            source_ai: sourceFile.fsName,
            reference_png: referencePng.fsName,
            source_size_bytes: entry.source_size_bytes,
            source_sha256_before: entry.source_sha256_before,
            source_hash_preverified: entry.source_hash_preverified === true
        };
        var sourceDocument = null;
        var targetDocument = null;
        var reopenedDocument = null;
        var outputAiCreated = false;
        var outputPngCreated = false;
        var auditCreated = false;
        var sourceLayerSnapshot = null;
        var sourceItemSnapshot = null;
        var finalItemSnapshot = null;
        var sourceLayerSignature;
        var sourceItemStructureSignature;
        var sourceItemStateSignature;
        var originalStrokes;
        var strokeRecords;
        var strokeMismatches;
        var scaleCalculation;
        var calculatedScale;
        var appliedScale;
        var override;
        var beforeBounds;
        var scaledBounds;
        var finalBounds;
        var roots;
        var restoreFailures;
        var layersAfter;
        var targetSnapshots;
        var targetBounds;
        var reopenVerification;
        var expectedOutput;
        var sourceStem = sourceFile.displayName.replace(/\.ai$/i, "");
        var outputStem;
        var stagingStem;
        var tolerance = Number(context.config.bounds_tolerance_pt || 0.02);
        var strokeTolerance = Number(context.config.stroke_tolerance_pt || 0.0001);
        var size = Number(context.config.artboard_size_pt);

        try {
            if (!sourceFile.exists) {
                fail("Исходный AI не найден: " + sourceFile.fsName);
            }
            if (!referencePng.exists) {
                fail("PNG-эталон не найден: " + referencePng.fsName);
            }
            if (Number(sourceFile.length) !== Number(entry.source_size_bytes)) {
                fail("Размер исходного AI отличается от manifest.");
            }
            if (entry.source_hash_preverified !== true) {
                fail("SHA-256 исходного AI не подтверждён перед обработкой.");
            }
            if (!outputFolder.exists || !stagingFolder.exists) {
                fail("Не найдены каталоги результата или staging.");
            }
            if (auditFile.exists) {
                fail("Audit JSON этой попытки уже существует.");
            }

            sourceDocument = app.open(sourceFile);
            sourceDocument.selection = null;

            audit.document_name = sourceDocument.name;
            audit.color_space = sourceDocument.documentColorSpace;
            audit.artboards_before = snapshotArtboards(sourceDocument);
            beforeBounds = boundsInfo(sourceDocument.visibleBounds);
            audit.visible_bounds_before = beforeBounds;
            row.artboards_before = audit.artboards_before.length;
            row.visible_bounds_before = jsonStringify(beforeBounds.rect, "", 0);
            row.visible_width_before_pt = beforeBounds.width;
            row.visible_height_before_pt = beforeBounds.height;

            sourceLayerSnapshot = snapshotLayers(sourceDocument);
            sourceItemSnapshot = snapshotItems(sourceDocument);
            sourceLayerSignature = layerSignature(sourceLayerSnapshot.audit);
            sourceItemStructureSignature =
                itemStructureSignature(sourceItemSnapshot.audit);
            sourceItemStateSignature = itemStateSignature(sourceItemSnapshot.audit);
            audit.layers_before = sourceLayerSnapshot.audit;
            audit.objects_before = sourceItemSnapshot.audit;
            audit.object_type_counts_before = itemTypeCounts(sourceItemSnapshot.audit);
            row.page_items_before = sourceItemSnapshot.audit.length;
            row.layers_before = sourceLayerSnapshot.audit.length;

            originalStrokes = collectStrokeRecords(sourceDocument);
            if (originalStrokes.failures.length) {
                fail("Не удалось прочитать все доступные обводки: " +
                    originalStrokes.failures.slice(0, 20).join("; "));
            }
            audit.stroke_widths_original =
                strokeSummary(originalStrokes.records, false);
            audit.stroked_object_count = originalStrokes.records.length;
            row.stroke_widths_original =
                jsonStringify(audit.stroke_widths_original, "", 0);
            row.stroked_objects = originalStrokes.records.length;

            scaleCalculation = chooseScale(beforeBounds, context.config);
            calculatedScale = scaleCalculation.scale_percent;
            if (calculatedScale === null) {
                fail("Ни один автоматический масштаб не помещается в монтажную область.");
            }
            row.calculated_scale_percent = calculatedScale;
            row.s_raw = scaleCalculation.raw;
            audit.calculated_scale_percent = calculatedScale;
            audit.scale_calculation = scaleCalculation;

            override = context.overrides[pathKey(row.source_relpath)];
            if (override) {
                appliedScale = Number(override.scale_percent);
                row.scale_mode = "override";
                audit.scale_override = override;
            } else {
                appliedScale = calculatedScale;
                row.scale_mode = "calculated";
            }
            validateScale(
                appliedScale,
                beforeBounds,
                context.config,
                !!override
            );
            row.applied_scale_percent = appliedScale;
            audit.applied_scale_percent = appliedScale;

            outputStem = String(context.config.output_prefix || "х") +
                appliedScale + "_" + sourceStem;
            stagingStem = String(entry.index) + "_" + outputStem +
                "_attempt" + String(entry.attempt);
            outputAi = new File(outputFolder.fsName + "/" + outputStem + ".ai");
            outputPng = new File(outputFolder.fsName + "/" + outputStem + ".png");
            stagingAi = new File(stagingFolder.fsName + "/" + stagingStem + ".ai");
            stagingPng = new File(stagingFolder.fsName + "/" + stagingStem + ".png");
            stagingPngBase = new File(
                stagingPng.fsName.replace(/\.png$/i, "")
            );
            audit.planned_output_ai = outputAi.fsName;
            audit.planned_output_png = outputPng.fsName;
            audit.staging_ai = stagingAi.fsName;
            audit.staging_png = stagingPng.fsName;
            if (outputAi.exists || outputPng.exists) {
                fail("Запрещена перезапись существующей итоговой пары.");
            }
            if (stagingAi.exists || stagingPng.exists) {
                fail("Staging-файлы этой попытки уже существуют.");
            }

            makeEditable(sourceLayerSnapshot.states, sourceItemSnapshot.states);
            strokeRecords = originalStrokes;
            normalizeStrokes(
                strokeRecords.records,
                Number(context.config.stroke_width_pt)
            );
            audit.stroke_widths_before_scale =
                strokeSummary(strokeRecords.records, true);
            row.stroke_widths_before_scale =
                jsonStringify(audit.stroke_widths_before_scale, "", 0);

            roots = rootItems(sourceDocument);
            audit.root_item_count = roots.length;
            if (!roots.length) {
                fail("В документе нет корневых объектов для масштабирования.");
            }
            scaleRoots(roots, appliedScale);

            strokeMismatches = compareStrokes(strokeRecords.records, strokeTolerance);
            if (strokeMismatches.length) {
                audit.stroke_mismatches_after_scale = strokeMismatches;
                row.stroke_mismatch_count = strokeMismatches.length;
                fail("После масштабирования изменились обводки: " +
                    strokeMismatches.length + " несовпадений.");
            }

            restoreFailures = restoreStates(
                sourceLayerSnapshot.states,
                sourceItemSnapshot.states
            );
            if (restoreFailures.length) {
                fail("Не удалось восстановить состояния до центрирования: " +
                    restoreFailures.slice(0, 20).join("; "));
            }

            scaledBounds = boundsInfo(sourceDocument.visibleBounds);
            audit.visible_bounds_after_scale_before_center = scaledBounds;

            makeEditable(sourceLayerSnapshot.states, sourceItemSnapshot.states);
            setSingleArtboard(sourceDocument, size);
            translateRoots(
                roots,
                size / 2 - scaledBounds.center_x,
                size / 2 - scaledBounds.center_y
            );
            restoreFailures = restoreStates(
                sourceLayerSnapshot.states,
                sourceItemSnapshot.states
            );
            if (restoreFailures.length) {
                fail("Не удалось восстановить состояния после центрирования: " +
                    restoreFailures.slice(0, 20).join("; "));
            }

            finalBounds = boundsInfo(sourceDocument.visibleBounds);
            finalItemSnapshot = snapshotItems(sourceDocument);
            audit.visible_bounds_final_processed_source = finalBounds;
            audit.artboards_final_processed_source =
                snapshotArtboards(sourceDocument);
            audit.object_type_counts_final = audit.object_type_counts_before;
            row.final_visible_bounds =
                jsonStringify(finalBounds.rect, "", 0);
            row.final_visible_width_pt = finalBounds.width;
            row.final_visible_height_pt = finalBounds.height;
            row.final_center_x = finalBounds.center_x;
            row.final_center_y = finalBounds.center_y;
            row.final_artboard = jsonStringify(
                audit.artboards_final_processed_source,
                "",
                0
            );

            if (Math.abs(finalBounds.center_x - size / 2) > tolerance ||
                    Math.abs(finalBounds.center_y - size / 2) > tolerance) {
                fail("Финальный центр visibleBounds не равен (600, 600).");
            }
            if (finalBounds.rect[0] < -tolerance ||
                    finalBounds.rect[2] > size + tolerance ||
                    finalBounds.rect[1] > size + tolerance ||
                    finalBounds.rect[3] < -tolerance) {
                fail("Финальный visibleBounds выходит за монтажную область.");
            }
            if (sourceDocument.pageItems.length !== sourceItemSnapshot.audit.length ||
                    !itemStatesMatch(sourceItemSnapshot.states)) {
                fail("После обработки изменились число или состояния объектов.");
            }

            strokeMismatches = compareStrokes(strokeRecords.records, strokeTolerance);
            audit.stroke_widths_after_scale =
                strokeSummary(strokeRecords.records, true);
            audit.stroke_mismatches_final = strokeMismatches;
            row.stroke_widths_after_scale =
                jsonStringify(audit.stroke_widths_after_scale, "", 0);
            row.stroke_mismatch_count = strokeMismatches.length;
            if (strokeMismatches.length) {
                fail("После центрирования изменились обводки.");
            }

            layersAfter = snapshotLayers(sourceDocument);
            row.layer_state_match =
                layerSignature(layersAfter.audit) === sourceLayerSignature ?
                    "true" : "false";
            row.item_state_match =
                itemStateSignature(finalItemSnapshot.audit) ===
                    sourceItemStateSignature ? "true" : "false";
            row.item_structure_match =
                itemStructureSignature(finalItemSnapshot.audit) ===
                    sourceItemStructureSignature ? "true" : "false";
            if (row.layer_state_match !== "true" ||
                    row.item_state_match !== "true" ||
                    row.item_structure_match !== "true") {
                fail("После обработки изменились слои, структура или состояния объектов.");
            }

            targetDocument = createPixelDocument(sourceDocument, size);
            targetSnapshots = copyArtworkWithLayers(
                sourceDocument,
                targetDocument,
                sourceLayerSnapshot,
                finalItemSnapshot
            );
            targetBounds = boundsInfo(targetDocument.visibleBounds);
            if (targetDocument.rulerUnits !== RulerUnits.Pixels) {
                fail("Целевой документ, созданный через DocumentPreset, не Pixels.");
            }
            if (!sameNumberArray(targetBounds.rect, finalBounds.rect, tolerance)) {
                fail("При переносе в pixel-native документ изменились visibleBounds.");
            }
            if (layerSignature(targetSnapshots.layers.audit) !==
                    sourceLayerSignature) {
                fail("При переносе в pixel-native документ изменилась сигнатура слоёв.");
            }
            if (itemStructureSignature(targetSnapshots.items.audit) !==
                    sourceItemStructureSignature ||
                    itemStateSignature(targetSnapshots.items.audit) !==
                    sourceItemStateSignature) {
                fail("При переносе в pixel-native документ изменились объекты.");
            }
            if (compareItemGeometry(
                    finalItemSnapshot.audit,
                    targetSnapshots.items.audit,
                    tolerance
                ).length) {
                fail("При переносе в pixel-native документ изменилась геометрия объектов.");
            }
            audit.pixel_transfer = {
                ruler_units_pixels:
                    targetDocument.rulerUnits === RulerUnits.Pixels,
                layer_signature_match: true,
                item_structure_match: true,
                item_state_match: true,
                item_geometry_match: true,
                visible_bounds_match: true,
                stroke_mismatch_count: "verified_after_reopen",
                page_items: targetSnapshots.items.audit.length,
                layers: targetSnapshots.layers.audit.length
            };

            saveAi(targetDocument, stagingAi, context.config);
            exportPng(targetDocument, stagingPngBase, context.config);
            if (!stagingAi.exists || stagingAi.length <= 0 ||
                    !stagingPng.exists || stagingPng.length <= 0) {
                fail("Illustrator не создал staging-пару AI+PNG.");
            }

            targetDocument.close(SaveOptions.DONOTSAVECHANGES);
            targetDocument = null;
            sourceDocument.close(SaveOptions.DONOTSAVECHANGES);
            sourceDocument = null;

            reopenedDocument = app.open(stagingAi);
            expectedOutput = {
                layer_signature: sourceLayerSignature,
                item_structure_signature: sourceItemStructureSignature,
                item_state_signature: sourceItemStateSignature,
                item_count: sourceItemSnapshot.audit.length,
                item_geometry: finalItemSnapshot.audit,
                color_space: audit.color_space
            };
            reopenVerification = verifyOpenOutputDocument(
                reopenedDocument,
                expectedOutput,
                context.config
            );
            audit.reopen_verification = reopenVerification;
            row.item_geometry_match_after_reopen =
                reopenVerification.item_geometry_match ? "true" : "false";
            row.ruler_units_pixels_after_reopen = "true";
            reopenedDocument.close(SaveOptions.DONOTSAVECHANGES);
            reopenedDocument = null;

            copyWithoutOverwrite(stagingAi, outputAi);
            outputAiCreated = true;
            copyWithoutOverwrite(stagingPng, outputPng);
            outputPngCreated = true;

            row.output_ai = outputAi.fsName;
            row.output_png = outputPng.fsName;
            audit.output_ai = outputAi.fsName;
            audit.output_png = outputPng.fsName;
            audit.status = "OK";
            audit.comment =
                "Pixel-native AI подтверждён после повторного открытия; " +
                "обводки 0.75 px; s_raw=" + scaleCalculation.raw + ".";

            writeText(auditFile, jsonStringify(audit, "", 0));
            auditCreated = auditFile.exists;
            if (!auditCreated) {
                fail("Не создан audit JSON.");
            }

            if (!removeIfExists(stagingAi) || !removeIfExists(stagingPng)) {
                fail("Не удалось удалить staging-файлы после публикации.");
            }

            row.audit_json = auditFile.fsName;
            row.status = "OK";
            row.comment = audit.comment;
        } catch (error) {
            row.status = "ERROR";
            row.comment = errorText(error);
            audit.status = "ERROR";
            audit.comment = row.comment;

            if (outputPngCreated) {
                removeIfExists(outputPng);
                outputPngCreated = false;
            }
            if (outputAiCreated) {
                removeIfExists(outputAi);
                outputAiCreated = false;
            }
            removeIfExists(stagingPng);
            removeIfExists(stagingAi);

            if (auditCreated) {
                removeIfExists(auditFile);
                auditCreated = false;
            }
            if (!auditFile.exists) {
                try {
                    writeText(auditFile, jsonStringify(audit, "", 0));
                    auditCreated = auditFile.exists;
                    if (auditCreated) {
                        row.audit_json = auditFile.fsName;
                    }
                } catch (auditError) {
                    row.comment += " | Не удалось записать audit JSON: " +
                        errorText(auditError);
                }
            }
            row.output_ai = "";
            row.output_png = "";
        } finally {
            if (reopenedDocument) {
                try {
                    reopenedDocument.close(SaveOptions.DONOTSAVECHANGES);
                } catch (reopenCloseError) {
                    row.comment += " | Ошибка закрытия повторно открытого AI: " +
                        errorText(reopenCloseError);
                }
            }
            if (targetDocument) {
                try {
                    targetDocument.close(SaveOptions.DONOTSAVECHANGES);
                } catch (targetCloseError) {
                    row.comment += " | Ошибка закрытия целевого AI: " +
                        errorText(targetCloseError);
                }
            }
            if (sourceDocument) {
                if (sourceLayerSnapshot && sourceItemSnapshot) {
                    try {
                        restoreStates(
                            sourceLayerSnapshot.states,
                            sourceItemSnapshot.states
                        );
                    } catch (restoreError) {
                        row.comment += " | Ошибка финального восстановления: " +
                            errorText(restoreError);
                    }
                }
                try {
                    sourceDocument.close(SaveOptions.DONOTSAVECHANGES);
                } catch (sourceCloseError) {
                    row.comment += " | Ошибка закрытия исходного AI: " +
                        errorText(sourceCloseError);
                }
            }
        }

        return row;
    }

    function validateJob(job) {
        var seen = {};
        var i;
        var entry;
        var key;
        if (!job || Number(job.schema_version) !== 1) {
            fail("Некорректная schema_version presale_site_job.json.");
        }
        if (!job.run_id || !job.batch_id || !job.batch_report ||
                !job.entries || !job.entries.length) {
            fail("В presale_site_job.json отсутствуют обязательные поля.");
        }
        for (i = 0; i < job.entries.length; i += 1) {
            entry = job.entries[i];
            if (typeof entry.index === "undefined" ||
                    !entry.source_relpath ||
                    !entry.source_ai ||
                    !entry.reference_png ||
                    !entry.output_dir ||
                    !entry.staging_dir ||
                    !entry.audit_json) {
                fail("Некорректная запись job с индексом " + i + ".");
            }
            key = pathKey(entry.source_relpath);
            if (seen[key]) {
                fail("В job повторяется исходник: " + entry.source_relpath);
            }
            seen[key] = true;
        }
    }

    function validateConfig(config) {
        if (!config.source_root || !config.output_root) {
            fail("В конфигурации обязательны source_root и output_root.");
        }
        if (!config.allowed_scales || !config.allowed_scales.length) {
            fail("В конфигурации нет allowed_scales.");
        }
        if (containsNumber(config.allowed_scales, 140)) {
            fail("140% нельзя включать в allowed_scales: используйте только ручной override.");
        }
        if (!containsNumber(config.manual_override_scales || [], 140)) {
            fail("140% должен быть указан в manual_override_scales.");
        }
        if (Number(config.artboard_size_pt) !== 1200) {
            fail("Для этого процесса artboard_size_pt должен быть строго 1200.");
        }
        if (Number(config.stroke_width_pt) !== 0.75) {
            fail("Для этого процесса stroke_width_pt должен быть строго 0.75.");
        }
        if (Number(config.scale_area_constant_pt2) !== 777500) {
            fail("Для этого процесса scale_area_constant_pt2 должен быть строго 777500.");
        }
        if (Number(config.scale_max_side_target_pt) !== 1070) {
            fail("Для этого процесса scale_max_side_target_pt должен быть строго 1070.");
        }
        if (Number(config.scale_tie_epsilon || 0.000000001) > 0.000000001) {
            fail("scale_tie_epsilon должен быть не более 1e-9.");
        }
        if (Number(config.png_scale_percent || 100) !== 100) {
            fail("Для PNG 1200×1200 при artboard 1200 pt нужен png_scale_percent=100.");
        }
    }

    function main() {
        var scriptFile = new File($.fileName);
        var scriptFolder = scriptFile.parent;
        var configFile = new File(scriptFolder.fsName + "/presale_site_config.json");
        var jobFile = new File(scriptFolder.fsName + "/presale_site_job.json");
        var overrideFile = new File(scriptFolder.fsName + "/scale_overrides.csv");
        var config = parseConfig(configFile);
        var job = parseConfig(jobFile);
        validateConfig(config);
        validateJob(job);

        var reportFile = new File(job.batch_report);
        var overrides = readOverrides(overrideFile);
        var context = {
            config: config,
            job: job,
            overrides: overrides
        };
        var row;
        var i;
        var okCount = 0;
        var errorCount = 0;

        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;

        for (i = 0; i < job.entries.length; i += 1) {
            row = processFullOne(job.entries[i], context);
            appendFullReportRow(reportFile, row);
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
