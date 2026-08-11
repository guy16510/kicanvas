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
    for (let i = start; i < source.length; i++) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")" && --depth === 0) return i + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function footprint(ref) {
    const marker = `(property "Reference" "${ref}"`;
    const index = board.indexOf(marker);
    if (index < 0) {
        failures.push(`missing footprint ${ref}`);
        return "";
    }
    const start = board.lastIndexOf("(footprint", index);
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

function requireText(block, text, label) {
    if (!block.includes(text)) failures.push(label ?? `missing ${text}`);
}

function requirePadNet(ref, number, name) {
    requireText(pad(ref, number), `"${name}"`, `${ref}.${number}: expected net ${name}`);
}

function padSize(text) {
    const match = text.match(/\(size\s+([\d.]+)\s+([\d.]+)\)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
}

function requirePadSize(ref, number, expected) {
    const actual = padSize(pad(ref, number));
    if (!actual || actual.some((v, i) => Math.abs(v - expected[i]) > 0.0001))
        failures.push(`${ref}.${number}: expected pad ${expected.join("x")}, got ${actual?.join("x") ?? "none"}`);
}

const refs = [...board.matchAll(/\(property "Reference" "([^"]+)"/g)].map((m) => m[1]);
const duplicates = refs.filter((ref, i) => refs.indexOf(ref) !== i);
if (duplicates.length) failures.push(`duplicate references: ${[...new Set(duplicates)].join(", ")}`);

// All ordinary passives must be 1206 or larger. No production 0402/0603/0805
// resistor/capacitor footprints are allowed in the hand-solder build.
for (const ref of refs.filter((r) => /^[RC]\d+$/.test(r))) {
    const block = footprint(ref);
    if (/0402|0603|0805/.test(block)) failures.push(`${ref}: small passive footprint remains`);
}
for (const ref of refs.filter((r) => /^[RC]\d+$/.test(r))) {
    const block = footprint(ref);
    if (!block.includes("_1206_HAND_SOLDER")) continue;
    for (const match of block.matchAll(/\(pad\s+"([^"]+)"\s+smd/g)) {
        const p = match[1];
        const size = padSize(pad(ref, p));
        if (!size || size[0] < 1.8 || size[1] < 1.8)
            failures.push(`${ref}.${p}: 1206 hand pad smaller than 1.8x1.8 mm`);
    }
}

// Four single-gate SOT-23-5 buffers are consolidated into one through-hole
// SN74AHCT125N. Each OE is hard grounded, giving the same always-enabled logic.
const u11 = footprint("U11");
requireText(u11, 'DIP-14_W7.62mm_SN74AHCT125N_HAND_SOLDER', "U11: wrong footprint");
requireText(u11, 'SN74AHCT125N_QUAD_3V3_TO_5V_BUFFER', "U11: wrong part");
for (let p = 1; p <= 14; p += 1) {
    const text = pad("U11", String(p));
    requireText(text, "thru_hole", `U11.${p}: must be through-hole`);
    const drill = Number(text.match(/\(drill\s+([\d.]+)\)/)?.[1] ?? 0);
    if (drill < 0.9) failures.push(`U11.${p}: drill too small for easy hand assembly`);
}
for (const [p, net] of [
    [1, "GND"], [2, "AUX_GPIO2"], [3, "RGB_DATA_5V"], [4, "GND"],
    [5, "LEFT_TRIG"], [6, "LEFT_TRIG_5V"], [7, "GND"], [8, "FRONT_TRIG_5V"],
    [9, "FRONT_TRIG"], [10, "GND"], [11, "RIGHT_TRIG_5V"], [12, "RIGHT_TRIG"],
    [13, "GND"], [14, "+5V"],
]) requirePadNet("U11", String(p), net);

for (const ref of ["U_RGB", "U_TRIG_L", "U_TRIG_F", "U_TRIG_R"]) {
    const block = footprint(ref);
    requireText(block, 'DNP_BUFFER_TEST_ANCHOR', `${ref}: must be DNP anchor only`);
    requireText(block, 'exclude_from_bom', `${ref}: must be excluded from BOM`);
    requireText(block, 'exclude_from_pos_files', `${ref}: must be excluded from placement file`);
    if (new RegExp(`(^|\\n)${ref},`).test(cpl)) failures.push(`${ref}: DNP anchor leaked into CPL`);
}
if (/SOT-23-5_TLV9001|74AHCT1G125_TRIGGER_3V3_TO_5V/.test(bom))
    failures.push("BOM still contains obsolete tiny single-gate buffer");

// PhotoMOS outputs must be through-hole DIP4 parts. Keep the exact floating
// contact nets and isolated LED inputs from the validated electrical design.
const photoNets = {
    U6: ["R_BRAKE_GATE", "GND", "R_BRAKE_CONTACT_A_SW", "R_BRAKE_CONTACT_B"],
    U7: ["L_BRAKE_GATE", "GND", "L_BRAKE_CONTACT_A_SW", "L_BRAKE_CONTACT_B"],
    U8: ["L_REVERSE_GATE", "GND", "L_REVERSE_CONTACT_A_SW", "L_REVERSE_CONTACT_B"],
    U9: ["R_REVERSE_GATE", "GND", "R_REVERSE_CONTACT_A_SW", "R_REVERSE_CONTACT_B"],
};
for (const [ref, nets] of Object.entries(photoNets)) {
    const block = footprint(ref);
    requireText(block, 'Panasonic_AQY212GH_DIP4_HAND_SOLDER', `${ref}: wrong PhotoMOS footprint`);
    requireText(block, 'AQY212GH_60V_1.1A_PHOTOMOS', `${ref}: wrong PhotoMOS value`);
    for (let p = 1; p <= 4; p += 1) {
        requireText(pad(ref, String(p)), "thru_hole", `${ref}.${p}: must be through-hole`);
        requirePadNet(ref, String(p), nets[p - 1]);
    }
}
if (bom.includes("AQY212SX")) failures.push("BOM still contains SMD AQY212SX");
requireText(bom, "AQY212GH", "BOM missing AQY212GH");
requireText(bom, "SN74AHCT125N", "BOM missing SN74AHCT125N");

// The only intentionally fine-pitch active IC is U4. U10 is SOIC with long
// toes, U4 remains MSOP because no larger package exists for this controller.
requireText(footprint("U10"), "SOIC-8_TLV9002_HAND_SOLDER_LONG_PAD", "U10: long-pad SOIC footprint missing");
for (let p = 1; p <= 8; p += 1) requirePadSize("U10", String(p), [2.2, 0.7]);
requireText(footprint("U4"), "MSOP-8_LTC4367_HAND_SOLDER_LONG_PAD", "U4: long-pad MSOP footprint missing");
for (let p = 1; p <= 8; p += 1) requirePadSize("U4", String(p), [2.2, 0.5]);

// New quad-buffer bypass and high-value assembly markings.
requirePadNet("C28", "1", "+5V");
requirePadNet("C28", "2", "GND");
requireText(board, 'HAND-SOLDER BUILD | 1206 PASSIVES | DIP LOGIC/PHOTOMOS', "missing hand-solder board marking");
for (const ref of ["C10", "C16", "C19", "C24", "C26"])
    requireText(footprint(ref), '(fp_text user "+"', `${ref}: polarity mark missing`);

// Main copper zones need real thermal-relief geometry. JP4G is intentionally
// solid-connected, but the board must retain thermal spokes for normal pads.
if (!/\(thermal_gap\s+[\d.]+\)/.test(board) || !/\(thermal_bridge_width\s+[\d.]+\)/.test(board))
    failures.push("board zones do not define thermal relief geometry");

// The placement file is now only for optional visual/reference use, not paste
// assembly. Through-hole substitutions must never show up there.
for (const ref of ["U11", "U6", "U7", "U8", "U9"])
    if (new RegExp(`(^|\\n)${ref},`).test(cpl)) failures.push(`${ref}: THT part leaked into CPL`);

if (failures.length) {
    console.error("hand-solder validation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log("hand-solder validation passed");
console.log("- no 0402/0603/0805 production passives");
console.log("- SN74AHCT125N consolidated to DIP-14 with four enabled channels");
console.log("- four AQY212GH PhotoMOS outputs are DIP-4 through-hole");
console.log("- TLV9002 SOIC and LTC4367 MSOP use extended hand-solder pads");
console.log("- DNP legacy buffer anchors are excluded from BOM/CPL");
console.log("- polarity and hand-build silkscreen markings are present");
