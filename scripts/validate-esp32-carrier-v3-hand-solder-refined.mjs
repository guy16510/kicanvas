import fs from "node:fs";

const BOARD = process.argv[2] ?? "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const BOM = "fixtures/esp32_robot_carrier/BOM_JLCPCB.csv";
const CPL = "fixtures/esp32_robot_carrier/CPL_JLCPCB.csv";
const board = fs.readFileSync(BOARD, "utf8");
const bom = fs.readFileSync(BOM, "utf8");
const cpl = fs.readFileSync(CPL, "utf8");
const failures = [];

function endOfBlock(source, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "(") depth += 1;
        else if (c === ")" && --depth === 0) return i + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function footprint(ref) {
    const marker = `(property "Reference" "${ref}"`;
    const at = board.indexOf(marker);
    if (at < 0) {
        failures.push(`missing footprint ${ref}`);
        return "";
    }
    const start = board.lastIndexOf("(footprint", at);
    return board.slice(start, endOfBlock(board, start));
}

function pad(ref, number) {
    const block = footprint(ref);
    const start = block.indexOf(`(pad "${number}"`);
    if (start < 0) {
        failures.push(`${ref}: missing pad ${number}`);
        return "";
    }
    return block.slice(start, endOfBlock(block, start));
}

function size(text) {
    const m = text.match(/\(size\s+([\d.]+)\s+([\d.]+)\)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

function requireSize(ref, number, expected) {
    const actual = size(pad(ref, number));
    if (!actual || actual.some((v, i) => Math.abs(v - expected[i]) > 0.001))
        failures.push(`${ref}.${number}: expected ${expected.join("x")}, got ${actual?.join("x") ?? "none"}`);
}

function at(ref) {
    const m = footprint(ref).match(/^\(footprint\s+"[^"]+"[\s\S]*?\(at\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

function requireAt(ref, expected) {
    const actual = at(ref);
    if (!actual || actual.some((v, i) => Math.abs(v - expected[i]) > 0.001))
        failures.push(`${ref}: expected at ${expected.join(",")}, got ${actual?.join(",") ?? "none"}`);
}

function requireText(text, needle, label) {
    if (!text.includes(needle)) failures.push(label ?? `missing ${needle}`);
}

function blocks(kind) {
    const result = [];
    let cursor = 0;
    while ((cursor = board.indexOf(`(${kind}`, cursor)) >= 0) {
        const end = endOfBlock(board, cursor);
        result.push(board.slice(cursor, end));
        cursor = end;
    }
    return result;
}

const refs = [...board.matchAll(/\(property "Reference" "([^"]+)"/g)].map((m) => m[1]);
const dupes = refs.filter((ref, i) => refs.indexOf(ref) !== i);
if (dupes.length) failures.push(`duplicate refs: ${[...new Set(dupes)].join(", ")}`);

// KiCad may preserve/rewrite the source footprint library name when it saves a
// board, so names such as R_0805_2012Metric are not proof that the copper is
// still 0805-sized. The physical SMD land dimensions are the production truth.
for (const ref of refs.filter((r) => /^[RC]\d+$/.test(r))) {
    const block = footprint(ref);
    const smdPads = [...block.matchAll(/\(pad\s+"([^"]+)"\s+smd/g)].map((m) => m[1]);
    if (!smdPads.length) continue;

    const wasSmallOrHandConverted = /0402|0603|0805|_1206_HAND_SOLDER/.test(block);
    if (!wasSmallOrHandConverted) continue;

    const minimum = ref === "R43" || ref === "R53" ? 1.2 : 1.5;
    for (const number of smdPads) {
        const actual = size(pad(ref, number));
        if (!actual || actual[0] + 0.001 < minimum || actual[1] + 0.001 < minimum)
            failures.push(`${ref}.${number}: physical hand-solder land below ${minimum} mm minimum (${actual?.join("x") ?? "none"})`);
    }
}

requireAt("U11", [139, 25.5]);
for (let p = 1; p <= 14; p += 1) {
    requireText(pad("U11", String(p)), "thru_hole", `U11.${p}: not through-hole`);
    requireSize("U11", String(p), [1.8, 1.8]);
}
for (const ref of ["U6", "U7", "U8", "U9"]) {
    requireText(footprint(ref), "AQY212GH_60V_1.1A_PHOTOMOS", `${ref}: wrong PhotoMOS`);
    requireAt(ref, [19, { U6: 38, U7: 44, U8: 62, U9: 68 }[ref]]);
    for (let p = 1; p <= 4; p += 1) requireSize(ref, String(p), [1.8, 1.8]);
}

for (const ref of ["U_RGB", "U_TRIG_L", "U_TRIG_F", "U_TRIG_R"]) {
    const block = footprint(ref);
    requireText(block, "DNP_BUFFER_TEST_ANCHOR", `${ref}: missing DNP anchor`);
    requireText(block, "exclude_from_bom", `${ref}: not excluded from BOM`);
    requireText(block, "exclude_from_pos_files", `${ref}: not excluded from CPL`);
    if (block.includes('"F.Paste"')) failures.push(`${ref}: paste opening remains`);
    requireSize(ref, "1", [1.1, 0.55]);
    if (new RegExp(`(^|\\n)${ref},`).test(cpl)) failures.push(`${ref}: leaked into CPL`);
}

for (let p = 1; p <= 8; p += 1) {
    requireSize("U10", String(p), [2.0, 0.6]);
    requireSize("U4", String(p), [1.35, 0.45]);
}
requireAt("C28", [145, 15.5]);
requireSize("C28", "1", [1.5, 1.5]);
requireSize("C28", "2", [1.5, 1.5]);

requireText(bom, "SN74AHCT125N", "BOM missing SN74AHCT125N");
requireText(bom, "AQY212GH", "BOM missing AQY212GH");
if (bom.includes("AQY212SX")) failures.push("BOM still contains AQY212SX");
if (/SOT-23-5_TLV9001|74AHCT1G125_TRIGGER_3V3_TO_5V/.test(bom))
    failures.push("BOM still contains obsolete tiny AHCT buffer");

// KiCad can normalize a gr_rect into a differently formatted object on save.
// Validate the actual Edge.Cuts geometry by its coordinates instead of exact
// serialization text.
const edgePoints = [];
for (const kind of ["gr_rect", "gr_line", "gr_arc"]) {
    for (const graphic of blocks(kind)) {
        if (!graphic.includes('(layer "Edge.Cuts")')) continue;
        for (const m of graphic.matchAll(/\((?:start|end|mid)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g))
            edgePoints.push([Number(m[1]), Number(m[2])]);
    }
}
if (!edgePoints.length) {
    failures.push("Edge.Cuts geometry missing");
} else {
    const xs = edgePoints.map(([x]) => x);
    const ys = edgePoints.map(([, y]) => y);
    const bounds = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
    if (bounds.minX > 1.01 || bounds.minY > 1.01 || bounds.maxX < 155.99 || bounds.maxY < 189.99)
        failures.push(`Edge.Cuts bounds too small: ${bounds.minX},${bounds.minY} to ${bounds.maxX},${bounds.maxY}`);
}

requireText(board, '(xy 148 2) (xy 148 98)', "top GND pour does not reach logic bay");
requireText(board, 'HAND-SOLDER BUILD | 1206 + DIP', "hand-solder silk marker missing");
if (!/\(thermal_gap\s+[\d.]+\)/.test(board) || !/\(thermal_bridge_width\s+[\d.]+\)/.test(board))
    failures.push("thermal-relief geometry missing");

for (const ref of ["U11", "U6", "U7", "U8", "U9"])
    if (new RegExp(`(^|\\n)${ref},`).test(cpl)) failures.push(`${ref}: through-hole part leaked into CPL`);

if (failures.length) {
    console.error("refined hand-solder validation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log("refined hand-solder validation passed");
console.log("- physical passive land dimensions verified after KiCad reserialization");
console.log("- U11 DIP logic bay and AQY212GH DIP PhotoMOS geometry verified");
console.log("- U6/U7/U8/U9 retain validated x=19 through-hole placement and 1.8 mm pads");
console.log("- U4 restored to validated MSOP copper, U10 retains toe-only extension");
console.log("- DNP AHCT anchors have no paste and stay out of BOM/CPL");
console.log("- physical Edge.Cuts bounds and thermal-relief contract verified");
