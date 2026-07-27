#target illustrator

(function () {
    var originalInteractionLevel = app.userInteractionLevel;
    var originalCoordinateSystem = app.coordinateSystem;
    var sourceDocument = null;
    var targetDocument = null;
    var reopenedDocument = null;
    var outputCreated = false;

    function fail(message) {
        throw new Error(message);
    }

    function number(value) {
        return Math.round(Number(value) * 1000000) / 1000000;
    }

    function bounds(document) {
        var value = document.visibleBounds;
        return [
            number(value[0]),
            number(value[1]),
            number(value[2]),
            number(value[3])
        ];
    }

    function sameNumbers(left, right, tolerance) {
        var i;
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

    function layerSignature(document) {
        var parts = [];

        function walk(layers, parentPath) {
            var i;
            var layer;
            var path;
            for (i = 0; i < layers.length; i += 1) {
                layer = layers[i];
                path = parentPath + "/" + i + ":" + layer.name;
                parts.push(
                    path + "|" +
                    (layer.visible ? "1" : "0") + "|" +
                    (layer.locked ? "1" : "0") + "|" +
                    (layer.printable ? "1" : "0")
                );
                if (layer.layers && layer.layers.length) {
                    walk(layer.layers, path);
                }
            }
        }

        walk(document.layers, "");
        return parts.join("\n");
    }

    function snapshotLayerStates(document) {
        var result = [];

        function walk(layers) {
            var i;
            for (i = 0; i < layers.length; i += 1) {
                result.push({
                    ref: layers[i],
                    name: layers[i].name,
                    visible: layers[i].visible,
                    locked: layers[i].locked,
                    printable: layers[i].printable
                });
                if (layers[i].layers && layers[i].layers.length) {
                    walk(layers[i].layers);
                }
            }
        }

        walk(document.layers);
        return result;
    }

    function snapshotItemStates(document) {
        var result = [];
        var i;
        for (i = 0; i < document.pageItems.length; i += 1) {
            result.push({
                ref: document.pageItems[i],
                hidden: document.pageItems[i].hidden,
                locked: document.pageItems[i].locked,
                typename: document.pageItems[i].typename,
                name: document.pageItems[i].name || ""
            });
        }
        return result;
    }

    function makeEditable(layerStates, itemStates) {
        var i;
        for (i = 0; i < layerStates.length; i += 1) {
            layerStates[i].ref.locked = false;
            layerStates[i].ref.visible = true;
        }
        for (i = 0; i < itemStates.length; i += 1) {
            itemStates[i].ref.locked = false;
            itemStates[i].ref.hidden = false;
        }
    }

    function restoreStates(layerStates, itemStates) {
        var i;
        for (i = 0; i < itemStates.length; i += 1) {
            itemStates[i].ref.hidden = itemStates[i].hidden;
            itemStates[i].ref.locked = itemStates[i].locked;
        }
        for (i = layerStates.length - 1; i >= 0; i -= 1) {
            layerStates[i].ref.visible = layerStates[i].visible;
            layerStates[i].ref.locked = layerStates[i].locked;
        }
    }

    function applyStatesToTarget(target, sourceLayerStates, sourceItemStates) {
        var targetLayerStates = snapshotLayerStates(target);
        var targetItemStates = snapshotItemStates(target);
        var i;
        if (targetLayerStates.length !== sourceLayerStates.length) {
            fail("Layer count changed during transfer.");
        }
        if (targetItemStates.length !== sourceItemStates.length) {
            fail("Page item count changed during transfer.");
        }
        for (i = 0; i < targetItemStates.length; i += 1) {
            if (targetItemStates[i].typename !== sourceItemStates[i].typename ||
                    targetItemStates[i].name !== sourceItemStates[i].name) {
                fail("Page item order changed during transfer at index " + i + ".");
            }
            targetItemStates[i].ref.hidden = sourceItemStates[i].hidden;
            targetItemStates[i].ref.locked = sourceItemStates[i].locked;
        }
        for (i = targetLayerStates.length - 1; i >= 0; i -= 1) {
            if (targetLayerStates[i].name !== sourceLayerStates[i].name) {
                fail("Layer order changed during transfer at index " + i + ".");
            }
            targetLayerStates[i].ref.printable = sourceLayerStates[i].printable;
            targetLayerStates[i].ref.visible = sourceLayerStates[i].visible;
            targetLayerStates[i].ref.locked = sourceLayerStates[i].locked;
        }
    }

    function copyArtworkWithLayers(source, target, layerStates, itemStates) {
        var defaultLayer = target.layers[0];
        var originalPasteRemembersLayers = app.pasteRemembersLayers;

        try {
            source.activate();
            makeEditable(layerStates, itemStates);
            source.selection = null;
            app.executeMenuCommand("selectall");
            app.executeMenuCommand("copy");
            source.selection = null;

            target.activate();
            app.pasteRemembersLayers = true;
            app.executeMenuCommand("pasteInPlace");
            target.selection = null;

            defaultLayer.locked = false;
            defaultLayer.visible = true;
            if (defaultLayer.pageItems.length !== 0 || defaultLayer.layers.length !== 0) {
                fail("Default target layer is not empty after Paste Remembers Layers.");
            }
            defaultLayer.remove();
        } finally {
            app.pasteRemembersLayers = originalPasteRemembersLayers;
            source.activate();
            restoreStates(layerStates, itemStates);
        }

        target.activate();
        applyStatesToTarget(target, layerStates, itemStates);
    }

    function createPixelDocument(source) {
        var preset = new DocumentPreset();
        preset.title = "MKD2 pixel transfer regression";
        preset.width = 1200;
        preset.height = 1200;
        preset.units = RulerUnits.Pixels;
        preset.numArtboards = 1;
        preset.colorMode = source.documentColorSpace;
        return app.documents.addDocument("", preset, false);
    }

    function saveAi(document, file) {
        var options = new IllustratorSaveOptions();
        options.pdfCompatible = true;
        options.compressed = true;
        options.saveMultipleArtboards = false;
        document.saveAs(file, options);
    }

    function writeResult(file, values) {
        var lines = [];
        var key;
        for (key in values) {
            if (values.hasOwnProperty(key)) {
                lines.push(key + "=" + values[key]);
            }
        }
        file.encoding = "UTF-8";
        file.lineFeed = "Windows";
        if (!file.open("w")) {
            fail("Cannot create probe result.");
        }
        file.write(lines.join("\r\n") + "\r\n");
        file.close();
    }

    var scriptFolder = new File($.fileName).parent;
    var sourceFile = new File(
        scriptFolder.fsName +
        "/../../../LIBRARY/02_CATALOG/02_PRESALE_Поздняково/01_ARTIFACTS/МКД2/" +
        "Корпус 2.1/POZD_WEB_K2-1_s3_et1_4.ai"
    );
    var diagnosticsFolder = new Folder(
        scriptFolder.fsName +
        "/../09_outputs/_diagnostics/unit_test_pixels_20260727"
    );
    if (!diagnosticsFolder.exists && !diagnosticsFolder.create()) {
        fail("Cannot create diagnostics folder: " + diagnosticsFolder.fsName);
    }
    var outputFile = new File(
        diagnosticsFolder.fsName +
        "/pixel_units_POZD_WEB_K2-1_s3_et1_4.ai"
    );
    var resultFile = new File(
        diagnosticsFolder.fsName +
        "/pixel_units_POZD_WEB_K2-1_s3_et1_4.txt"
    );
    var sourceLayerSignature;
    var sourceBounds;
    var sourcePageItems;
    var sourceLayerStates;
    var sourceItemStates;
    var sourceTopLayerCount;
    var targetLayerSignature;
    var targetBounds;
    var targetPageItems;
    var reopenedLayerSignature;
    var reopenedBounds;
    var reopenedPageItems;
    var artboard;
    var artboardWidth;
    var artboardHeight;

    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;

        if (!sourceFile.exists) {
            fail("Source file not found: " + sourceFile.fsName);
        }
        if (outputFile.exists || resultFile.exists) {
            fail("Probe output already exists.");
        }

        sourceDocument = app.open(sourceFile);
        sourceDocument.selection = null;
        sourceDocument.artboards[0].artboardRect = [0, 1200, 1200, 0];
        sourceLayerSignature = layerSignature(sourceDocument);
        sourceBounds = bounds(sourceDocument);
        sourcePageItems = sourceDocument.pageItems.length;
        sourceLayerStates = snapshotLayerStates(sourceDocument);
        sourceItemStates = snapshotItemStates(sourceDocument);
        sourceTopLayerCount = sourceDocument.layers.length;

        targetDocument = createPixelDocument(sourceDocument);
        copyArtworkWithLayers(
            sourceDocument,
            targetDocument,
            sourceLayerStates,
            sourceItemStates
        );
        targetDocument.artboards[0].artboardRect = [0, 1200, 1200, 0];

        targetLayerSignature = layerSignature(targetDocument);
        targetBounds = bounds(targetDocument);
        targetPageItems = targetDocument.pageItems.length;

        if (targetDocument.rulerUnits !== RulerUnits.Pixels) {
            fail("New target document is not pixel-native.");
        }
        if (targetLayerSignature !== sourceLayerSignature) {
            fail("Layer signature changed during transfer.");
        }
        if (targetPageItems !== sourcePageItems) {
            fail("Page item count changed during transfer.");
        }
        if (!sameNumbers(targetBounds, sourceBounds, 0.02)) {
            fail(
                "Visible bounds changed during transfer. source=" +
                sourceBounds.join(",") + "; target=" + targetBounds.join(",")
            );
        }

        saveAi(targetDocument, outputFile);
        outputCreated = outputFile.exists;
        targetDocument.close(SaveOptions.DONOTSAVECHANGES);
        targetDocument = null;
        sourceDocument.close(SaveOptions.DONOTSAVECHANGES);
        sourceDocument = null;

        reopenedDocument = app.open(outputFile);
        reopenedLayerSignature = layerSignature(reopenedDocument);
        reopenedBounds = bounds(reopenedDocument);
        reopenedPageItems = reopenedDocument.pageItems.length;
        artboard = reopenedDocument.artboards[0].artboardRect;
        artboardWidth = number(artboard[2] - artboard[0]);
        artboardHeight = number(artboard[1] - artboard[3]);

        if (reopenedDocument.rulerUnits !== RulerUnits.Pixels) {
            fail("Reopened document is not pixel-native.");
        }
        if (reopenedDocument.artboards.length !== 1 ||
                Math.abs(artboardWidth - 1200) > 0.02 ||
                Math.abs(artboardHeight - 1200) > 0.02) {
            fail("Reopened artboard is not 1200x1200.");
        }
        if (reopenedLayerSignature !== sourceLayerSignature) {
            fail("Layer signature changed after reopen.");
        }
        if (reopenedPageItems !== sourcePageItems) {
            fail("Page item count changed after reopen.");
        }
        if (!sameNumbers(reopenedBounds, sourceBounds, 0.02)) {
            fail("Visible bounds changed after reopen.");
        }

        writeResult(resultFile, {
            status: "OK",
            illustrator_version: app.version,
            source_page_items: sourcePageItems,
            reopened_page_items: reopenedPageItems,
            source_top_layers: sourceTopLayerCount,
            reopened_top_layers: reopenedDocument.layers.length,
            ruler_units_pixels: reopenedDocument.rulerUnits === RulerUnits.Pixels,
            artboards: reopenedDocument.artboards.length,
            artboard_width: artboardWidth,
            artboard_height: artboardHeight,
            bounds_match: sameNumbers(reopenedBounds, sourceBounds, 0.02),
            layer_signature_match: reopenedLayerSignature === sourceLayerSignature
        });
        return "OK|pixel_transfer";
    } catch (error) {
        if (outputCreated && outputFile.exists) {
            outputFile.remove();
        }
        throw error;
    } finally {
        if (reopenedDocument) {
            reopenedDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
        if (targetDocument) {
            targetDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
        if (sourceDocument) {
            sourceDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
        app.userInteractionLevel = originalInteractionLevel;
        app.coordinateSystem = originalCoordinateSystem;
    }
}());
