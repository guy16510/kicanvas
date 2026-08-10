import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const board = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const root = "fixtures/esp32_robot_carrier/fabrication_v3";
const gerberDirectory = path.join(root, "gerbers");
const renderingDirectory = path.join(root, "renderings");
const base = "esp32_robot_carrier_v3";
const kicad = fs.existsSync("/opt/homebrew/bin/kicad-cli")
    ? "/opt/homebrew/bin/kicad-cli"
    : "kicad-cli";

fs.mkdirSync(gerberDirectory, { recursive: true });
fs.mkdirSync(renderingDirectory, { recursive: true });

const run = (args) =>
    execFileSync(kicad, args, {
        stdio: "inherit",
    });

run([
    "pcb",
    "export",
    "gerbers",
    "--output",
    gerberDirectory,
    "--layers",
    "F.Cu,B.Cu,F.Paste,F.Silkscreen,F.Mask,B.Mask,Edge.Cuts",
    "--check-zones",
    board,
]);

run([
    "pcb",
    "export",
    "drill",
    "--output",
    gerberDirectory,
    "--format",
    "excellon",
    "--drill-origin",
    "absolute",
    "--excellon-zeros-format",
    "decimal",
    "--excellon-oval-format",
    "alternate",
    "--excellon-units",
    "mm",
    board,
]);

run([
    "pcb",
    "export",
    "ipcd356",
    "--output",
    path.join(root, `${base}.d356`),
    board,
]);

run([
    "pcb",
    "export",
    "pos",
    "--output",
    path.join(root, `${base}-pos.csv`),
    "--side",
    "both",
    "--format",
    "csv",
    "--units",
    "mm",
    "--smd-only",
    board,
]);

run([
    "pcb",
    "export",
    "stats",
    "--output",
    path.join(root, "board-stats.json"),
    "--format",
    "json",
    "--units",
    "mm",
    board,
]);

run([
    "pcb",
    "export",
    "svg",
    "--output",
    path.join(renderingDirectory, "front.svg"),
    "--layers",
    "F.Cu,F.Mask,F.Silkscreen,Edge.Cuts",
    "--mode-single",
    "--fit-page-to-board",
    "--exclude-drawing-sheet",
    "--check-zones",
    board,
]);

run([
    "pcb",
    "export",
    "svg",
    "--output",
    path.join(renderingDirectory, "back.svg"),
    "--layers",
    "B.Cu,B.Mask,Edge.Cuts",
    "--mode-single",
    "--fit-page-to-board",
    "--exclude-drawing-sheet",
    "--mirror",
    "--check-zones",
    board,
]);

run([
    "pcb",
    "render",
    "--output",
    path.join(renderingDirectory, "top.png"),
    "--width",
    "1600",
    "--height",
    "2200",
    "--side",
    "top",
    "--background",
    "opaque",
    "--quality",
    "basic",
    "--zoom",
    "1.05",
    board,
]);

const packageFiles = [
    `${base}-F_Cu.gtl`,
    `${base}-B_Cu.gbl`,
    `${base}-F_Paste.gtp`,
    `${base}-F_Silkscreen.gto`,
    `${base}-F_Mask.gts`,
    `${base}-B_Mask.gbs`,
    `${base}-Edge_Cuts.gm1`,
    `${base}.drl`,
    `${base}-job.gbrjob`,
].map((name) => path.join(gerberDirectory, name));

for (const file of packageFiles)
    if (!fs.existsSync(file)) throw new Error(`missing fabrication output ${file}`);

const zipPath = path.join(root, `${base}-gerbers.zip`);
fs.rmSync(zipPath, { force: true });
execFileSync("zip", ["-j", "-q", zipPath, ...packageFiles], {
    stdio: "inherit",
});

execFileSync(
    process.execPath,
    ["scripts/validate-esp32-carrier-v3-fabrication.mjs", gerberDirectory],
    { stdio: "inherit" },
);

console.log(`exported fabrication package to ${zipPath}`);
