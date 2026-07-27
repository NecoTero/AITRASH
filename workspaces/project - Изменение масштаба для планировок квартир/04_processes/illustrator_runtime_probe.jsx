#target illustrator

(function () {
    var scriptFolder = new File($.fileName).parent;
    var resultFile = new File(
        scriptFolder.fsName +
        "/../09_outputs/_diagnostics/full_20260724_165214_full_mkd2/illustrator_runtime_probe.txt"
    );
    var result = [
        "status=OK",
        "version=" + app.version,
        "locale=" + $.locale,
        "documents=" + app.documents.length
    ].join("\r\n") + "\r\n";

    resultFile.encoding = "UTF-8";
    resultFile.lineFeed = "Windows";
    if (!resultFile.open("w")) {
        throw new Error("Cannot create runtime probe result.");
    }
    resultFile.write(result);
    resultFile.close();
    return "OK|" + app.version;
}());
