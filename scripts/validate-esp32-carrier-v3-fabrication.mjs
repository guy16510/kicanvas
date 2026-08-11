import fs from "node:fs";
import path from "node:path";

const directory =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/fabrication_v3/gerbers";
const base = "esp32_robot_carrier_v3";
const expected = [
    `${base}-F_Cu.gtl`,
    `${base}-B_Cu.gbl`,
    `${base}-F_Paste.gtp`,
    `${base}-F_Silkscreen.gto`,
    `${base}-F_Mask.gts`,
    `${base}-B_Mask.gbs`,
    `${base}-Edge_Cuts.gm1`,
    `${base}.drl`,
    `${base}-job.gbrjob`,
];
const failures = [];

for (const file of expected) {
    const filePath = path.join(directory, file);
    if (!fs.existsSync(filePath)) {
        failures.push(`missing ${file}`);
        continue;
    }
    if (fs.statSync(filePath).size < 100)
        failures.push(`${file} is unexpectedly small`);
}

for (const file of fs.readdirSync(directory))
    if (/Margin|Courtyard|CrtYd/i.test(file))
        failures.push(`non-fabrication layer must not be in order package: ${file}`);

const jobPath = path.join(directory, `${base}-job.gbrjob`);
if (fs.existsSync(jobPath)) {
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    const specs = job.GeneralSpecs ?? {};
    if (specs.LayerNumber !== 2) failures.push("Gerber job must specify 2 layers");
    if (specs.BoardThickness !== 1.6)
        failures.push("Gerber job must specify 1.6 mm board thickness");

    // Hand-solder v3 extends the right edge from x=129 to x=156 mm to create
    // the dedicated DIP-14 logic/routing bay. KiCad's Gerber job reports the
    // 0.25 mm Edge.Cuts stroke in its overall size, hence 155.25 x 189.25 mm.
    if (
        Math.abs((specs.Size?.X ?? 0) - 155.25) > 0.001 ||
        Math.abs((specs.Size?.Y ?? 0) - 189.25) > 0.001
    )
        failures.push(
            `Gerber job must describe the widened 155 x 189 mm hand-solder board outline; got ${specs.Size?.X ?? "?"} x ${specs.Size?.Y ?? "?"} mm`,
        );

    const functions = new Set(
        (job.FilesAttributes ?? []).map((entry) => entry.FileFunction),
    );
    for (const functionName of [
        "Copper,L1,Top",
        "Copper,L2,Bot",
        "SolderPaste,Top",
        "Legend,Top",
        "SolderMask,Top",
        "SolderMask,Bot",
        "Profile",
    ])
        if (!functions.has(functionName))
            failures.push(`Gerber job missing ${functionName}`);

    const copper = (job.MaterialStackup ?? []).filter(
        (entry) => entry.Type === "Copper",
    );
    if (
        copper.length !== 2 ||
        copper.some((entry) => Math.abs(entry.Thickness - 0.07) > 0.0001)
    )
        failures.push("Gerber job must specify 0.07 mm / 2 oz copper on both layers");
}

const drillPath = path.join(directory, `${base}.drl`);
if (fs.existsSync(drillPath)) {
    const drill = fs.readFileSync(drillPath, "utf8");
    if (!drill.includes("; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill"))
        failures.push("drill file does not identify non-plated mounting holes");
    if (!drill.includes("M30")) failures.push("drill file is not terminated");

    const mountingTool = drill.match(/T(\d+)C3\.200(?:\r?\n|$)/)?.[1];
    if (!mountingTool) {
        failures.push("drill file is missing the 3.2 mm M3 tool");
    } else {
        const selection = `\nT${mountingTool}\n`;
        const sectionStart = drill.lastIndexOf(selection);
        const section = sectionStart < 0
            ? ""
            : drill.slice(sectionStart + selection.length).split(/\nT\d+\n|\nM30/)[0];
        const actual = section
            .match(/^X[-\d.]+Y[-\d.]+$/gm)
            ?.sort() ?? [];
        const expectedMounts = [
            "X5.0Y-5.0",
            "X125.0Y-5.0",
            "X5.0Y-95.0",
            "X115.0Y-95.0",
            "X5.0Y-186.0",
            "X125.0Y-186.0",
        ].sort();
        if (actual.join(",") !== expectedMounts.join(","))
            failures.push(
                `3.2 mm NPTH coordinates mismatch: ${actual.join(",") || "none"}`,
            );
    }
}

if (failures.length) {
    console.error("ESP32 carrier v3 fabrication package FAILED");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
} else {
    console.log(
        `ESP32 carrier v3 fabrication package PASS: ${expected.length} required files, 2 layers, 1.6 mm, widened hand-solder outline`,
    );
}
