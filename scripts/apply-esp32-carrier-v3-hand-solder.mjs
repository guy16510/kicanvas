import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const BOARD = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const ENCODED = `${BOARD}.gz.b64`;
const BOM = "fixtures/esp32_robot_carrier/BOM_JLCPCB.csv";
const existing = process.argv.includes("--existing");

if (!existing) {
    execFileSync(process.execPath, ["scripts/add-esp32-carrier-v3-battery-sense.mjs"], {
        stdio: "inherit",
    });
}

let board = fs.readFileSync(BOARD, "utf8");

function endOfBlock(source, start) {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")" && --depth === 0) return i + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function footprintBounds(ref) {
    const marker = `(property "Reference" "${ref}"`;
    const markerIndex = board.indexOf(marker);
    if (markerIndex < 0) throw new Error(`footprint ${ref} not found`);
    const start = board.lastIndexOf("(footprint", markerIndex);
    return { start, end: endOfBlock(board, start) };
}

function editFootprint(ref, edit) {
    const { start, end } = footprintBounds(ref);
    const oldBlock = board.slice(start, end);
    board = board.slice(0, start) + edit(oldBlock) + board.slice(end);
}

function allFootprints() {
    const out = [];
    let start = 0;
    while ((start = board.indexOf("(footprint", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        const ref = block.match(/\(property "Reference" "([^"]+)"/)?.[1];
        out.push({ start, end, block, ref });
        start = end;
    }
    return out;
}

function replaceFootprints(transform) {
    for (const item of allFootprints().reverse()) {
        const next = transform(item);
        if (next === undefined || next === item.block) continue;
        board = board.slice(0, item.start) + next + board.slice(item.end);
    }
}

function insertBefore(token, text) {
    const at = board.indexOf(token);
    if (at < 0) throw new Error(`insertion token not found: ${token}`);
    board = board.slice(0, at) + text + "\n  " + board.slice(at);
}

function padBlock(block, padNumber) {
    const marker = `(pad "${padNumber}"`;
    const start = block.indexOf(marker);
    if (start < 0) throw new Error(`pad ${padNumber} not found`);
    return block.slice(start, endOfBlock(block, start));
}

function padNet(block, padNumber) {
    const pad = padBlock(block, padNumber);
    const match = pad.match(/\(net\s+(\d+)\s+"([^"]+)"\)/);
    if (!match) throw new Error(`pad ${padNumber} has no net`);
    return { id: Number(match[1]), name: match[2] };
}

function footprintAt(block) {
    const match = block.match(/^\(footprint\s+"[^"]+"[\s\S]*?\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if (!match) throw new Error("footprint location missing");
    return { x: Number(match[1]), y: Number(match[2]) };
}

function unhideReference(block) {
    return block.replace(
        /(\(property "Reference" "[^"]+"[\s\S]*?\(layer "F\.SilkS"\))\s+hide\)/,
        "$1)",
    );
}

function appendToFootprint(block, text) {
    const end = block.lastIndexOf(")");
    return `${block.slice(0, end)}\n    ${text}\n${block.slice(end)}`;
}

function resizeSmdPads(block, x, y) {
    let cursor = 0;
    const edits = [];
    while ((cursor = block.indexOf("(pad", cursor)) >= 0) {
        const end = endOfBlock(block, cursor);
        const pad = block.slice(cursor, end);
        if (/\bsmd\b/.test(pad)) {
            edits.push({
                start: cursor,
                end,
                text: pad.replace(/\(size\s+[-\d.]+\s+[-\d.]+\)/, `(size ${x} ${y})`),
            });
        }
        cursor = end;
    }
    for (const edit of edits.reverse())
        block = block.slice(0, edit.start) + edit.text + block.slice(edit.end);
    return block;
}

function segment(x1, y1, x2, y2, width, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}

function via(x, y, net, size = 0.9, drill = 0.45) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}

function dipPhotoMos(ref, oldBlock) {
    const { x, y } = footprintAt(oldBlock);
    const nets = [1, 2, 3, 4].map((pad) => padNet(oldBlock, pad));
    const net = (pad) => `(net ${nets[pad - 1].id} "${nets[pad - 1].name}")`;
    return `(footprint "Panasonic_AQY212GH_DIP4_HAND_SOLDER" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -4.6 0) (layer "F.SilkS"))
    (property "Value" "AQY212GH_60V_1.1A_PHOTOMOS" (at 0 4.6 0) (layer "F.Fab") hide)
    (fp_rect (start -4.8 -2.5) (end 4.8 2.5) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_circle (center 3.1 -1.55) (end 3.45 -1.55) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "DIP4" (at 0 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.15))))
    (pad "1" thru_hole rect (at 3.81 -1.27) (size 2.5 2.5) (drill 1.0) (layers "*.Cu" "*.Mask") ${net(1)})
    (pad "2" thru_hole circle (at 3.81 1.27) (size 2.5 2.5) (drill 1.0) (layers "*.Cu" "*.Mask") ${net(2)})
    (pad "3" thru_hole circle (at -3.81 1.27) (size 2.5 2.5) (drill 1.0) (layers "*.Cu" "*.Mask") ${net(3)})
    (pad "4" thru_hole circle (at -3.81 -1.27) (size 2.5 2.5) (drill 1.0) (layers "*.Cu" "*.Mask") ${net(4)})
  )`;
}

function dipAhct125() {
    const cx = 104;
    const cy = 25.5;
    const lx = -3.81;
    const rx = 3.81;
    const ys = [-7.62, -5.08, -2.54, 0, 2.54, 5.08, 7.62];
    const pins = new Map([
        [1, [lx, ys[0], 3, "GND"]],
        [2, [lx, ys[1], 17, "AUX_GPIO2"]],
        [3, [lx, ys[2], 52, "RGB_DATA_5V"]],
        [4, [lx, ys[3], 3, "GND"]],
        [5, [lx, ys[4], 16, "LEFT_TRIG"]],
        [6, [lx, ys[5], 71, "LEFT_TRIG_5V"]],
        [7, [lx, ys[6], 3, "GND"]],
        [8, [rx, ys[6], 72, "FRONT_TRIG_5V"]],
        [9, [rx, ys[5], 21, "FRONT_TRIG"]],
        [10, [rx, ys[4], 3, "GND"]],
        [11, [rx, ys[3], 73, "RIGHT_TRIG_5V"]],
        [12, [rx, ys[2], 22, "RIGHT_TRIG"]],
        [13, [rx, ys[1], 3, "GND"]],
        [14, [rx, ys[0], 2, "+5V"]],
    ]);
    const padLines = [];
    for (let pin = 1; pin <= 14; pin++) {
        const [x, y, net, name] = pins.get(pin);
        const shape = pin === 1 ? "rect" : "circle";
        padLines.push(
            `    (pad "${pin}" thru_hole ${shape} (at ${x} ${y}) (size 2.4 2.4) (drill 0.95) (layers "*.Cu" "*.Mask") (net ${net} "${name}"))`,
        );
    }
    return `(footprint "DIP-14_W7.62mm_SN74AHCT125N_HAND_SOLDER" (layer "F.Cu") (at ${cx} ${cy})
    (property "Reference" "U11" (at 0 -10.5 0) (layer "F.SilkS"))
    (property "Value" "SN74AHCT125N_QUAD_3V3_TO_5V_BUFFER" (at 0 10.5 0) (layer "F.Fab") hide)
    (fp_rect (start -5.1 -9.2) (end 5.1 9.2) (stroke (width 0.28) (type default)) (fill none) (layer "F.SilkS"))
    (fp_arc (start -1 -9.2) (mid 0 -8.2) (end 1 -9.2) (stroke (width 0.28) (type default)) (fill none) (layer "F.SilkS"))
    (fp_circle (center -3.2 -7.7) (end -2.8 -7.7) (stroke (width 0.28) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "AHCT125" (at 0 0 90) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.16))))
${padLines.join("\n")}
  )`;
}

function handBypassCap() {
    return `(footprint "C_1206_HAND_SOLDER" (layer "F.Cu") (at 111 18.5)
    (property "Reference" "C28" (at 0 -2.2 0) (layer "F.SilkS"))
    (property "Value" "100nF_25V_AHCT125_BYPASS" (at 0 2.2 0) (layer "F.Fab") hide)
    (fp_rect (start -2.2 -1.3) (end 2.2 1.3) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -1.1 0) (size 1.8 1.8) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net 2 "+5V"))
    (pad "2" smd roundrect (at 1.1 0) (size 1.8 1.8) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net 3 "GND"))
  )`;
}

function anchorizeBuffer(block) {
    block = block.replace(/^\(footprint\s+"[^"]+"/, '(footprint "DNP_BUFFER_TEST_ANCHOR"');
    block = block.replace(/\(property "Value" "[^"]+"/, '(property "Value" "DNP_TEST_ANCHOR_ONLY"');
    block = resizeSmdPads(block, 1.6, 1.0);
    block = block.replaceAll('(layers "F.Cu" "F.Paste" "F.Mask")', '(layers "F.Cu" "F.Mask")');
    if (!block.includes("(attr ")) {
        const pos = block.lastIndexOf(")");
        block = `${block.slice(0, pos)}\n    (attr smd exclude_from_bom exclude_from_pos_files)\n${block.slice(pos)}`;
    }
    return block;
}

// Replace every ordinary 0805 resistor/capacitor with a forgiving 1206 copper
// land while keeping the original pad centers, so all proven routes remain intact.
replaceFootprints(({ block, ref }) => {
    if (!ref || !/^[RC]\d+$/.test(ref) || !/0805/.test(block)) return block;
    let next = block.replace(/^\(footprint\s+"[^"]+"/, `(footprint "${ref.startsWith("R") ? "R" : "C"}_1206_HAND_SOLDER"`);
    next = resizeSmdPads(next, 1.8, 1.8);
    return next;
});

// Give the existing 1210 ceramics more exposed toe copper without moving them.
for (const ref of ["C11", "C18", "C25"]) {
    editFootprint(ref, (block) =>
        resizeSmdPads(
            block.replace(/^\(footprint\s+"[^"]+"/, '(footprint "C_1210_HAND_SOLDER"'),
            1.8,
            2.9,
        ),
    );
}

// The TLV9002 SOIC is already hand friendly; extend its toe pads and restore a
// visible outline/reference. The LTC4367 must remain MSOP-8, but long pads make
// drag soldering practical while preserving the 0.65 mm pin pitch.
editFootprint("U10", (block) => {
    block = resizeSmdPads(block, 2.2, 0.7).replace(/^\(footprint\s+"[^"]+"/, '(footprint "SOIC-8_TLV9002_HAND_SOLDER_LONG_PAD"');
    block = unhideReference(block);
    block = appendToFootprint(block, '(fp_rect (start -3.8 -3.0) (end 3.8 3.0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))');
    block = appendToFootprint(block, '(fp_circle (center -2.1 -2.2) (end -1.75 -2.2) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))');
    return block;
});
editFootprint("U4", (block) => {
    block = resizeSmdPads(block, 2.2, 0.5).replace(/^\(footprint\s+"[^"]+"/, '(footprint "MSOP-8_LTC4367_HAND_SOLDER_LONG_PAD"');
    block = unhideReference(block);
    block = appendToFootprint(block, '(fp_rect (start -3.7 -3.0) (end 3.7 3.0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))');
    block = appendToFootprint(block, '(fp_circle (center -2.5 -1.4) (end -2.2 -1.4) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))');
    return block;
});

// Swap all four SOP PhotoMOS relays for the higher-capacity through-hole DIP4
// AQY212GH. Short bridge traces retain the already-validated contact routing.
const photoBridgeRoutes = [];
for (const ref of ["U6", "U7", "U8", "U9"]) {
    const old = board.slice(footprintBounds(ref).start, footprintBounds(ref).end);
    const { x, y } = footprintAt(old);
    const nets = [1, 2, 3, 4].map((pin) => padNet(old, pin).id);
    editFootprint(ref, (block) => dipPhotoMos(ref, block));
    for (const [pin, oldDx, newDx, dy] of [
        [1, 2.65, 3.81, -1.27],
        [2, 2.65, 3.81, 1.27],
        [3, -2.65, -3.81, 1.27],
        [4, -2.65, -3.81, -1.27],
    ])
        photoBridgeRoutes.push(segment(x + oldDx, y + dy, x + newDx, y + dy, 0.35, "F.Cu", nets[pin - 1]));
}

// The four little AHCT buffers are now one socketable/replaceable PDIP-14.
// Keep their old lands only as excluded test anchors, which also prevents
// dangling-track DRC noise and gives convenient probing points.
for (const ref of ["U_RGB", "U_TRIG_L", "U_TRIG_F", "U_TRIG_R"])
    editFootprint(ref, anchorizeBuffer);

insertBefore("(segment", [dipAhct125(), handBypassCap()].join("\n  "));

const bufferRoutes = [
    // U11 VCC to the existing 5 V back-layer spine, plus local C28 bypass.
    segment(107.81, 17.88, 106, 17.88, 0.5, "F.Cu", 2),
    via(106, 17.88, 2, 1.0, 0.5),
    segment(107.81, 17.88, 109.9, 18.5, 0.45, "F.Cu", 2),
    segment(112.1, 18.5, 113, 18.5, 0.4, "F.Cu", 3),
    via(113, 18.5, 3, 1.0, 0.5),

    // RGB channel, input taps the existing GPIO2 route at y=16. Output uses
    // a layer-switched corridor that avoids the 5 V trunk and GPIO2 route.
    segment(100.19, 20.42, 100.19, 16, 0.3, "F.Cu", 17),
    segment(100.19, 22.96, 116, 22.96, 0.3, "F.Cu", 52),
    via(116, 22.96, 52),
    segment(116, 22.96, 116, 89, 0.3, "B.Cu", 52),
    via(116, 89, 52),
    segment(116, 89, 116, 95, 0.3, "F.Cu", 52),
    via(116, 95, 52),
    segment(116, 95, 116, 103.5, 0.3, "B.Cu", 52),
    segment(116, 103.5, 90, 103.5, 0.3, "B.Cu", 52),
    via(90, 103.5, 52),
    segment(90, 103.5, 69.1, 103.5, 0.3, "F.Cu", 52),

    // Left ultrasonic trigger channel.
    segment(100.19, 28.04, 98, 28.04, 0.3, "F.Cu", 16),
    via(98, 28.04, 16),
    segment(98, 28.04, 98, 10, 0.3, "B.Cu", 16),
    via(98, 10, 16),
    segment(98, 10, 102.9, 10, 0.3, "F.Cu", 16),
    segment(100.19, 30.58, 96, 30.58, 0.3, "F.Cu", 71),
    via(96, 30.58, 71),
    segment(96, 30.58, 96, 11, 0.3, "B.Cu", 71),
    via(96, 11, 71),
    segment(96, 11, 105.1, 11, 0.3, "F.Cu", 71),

    // Front ultrasonic trigger channel.
    segment(107.81, 30.58, 94, 30.58, 0.3, "F.Cu", 21),
    via(94, 30.58, 21),
    segment(94, 30.58, 94, 39, 0.3, "B.Cu", 21),
    via(94, 39, 21),
    segment(94, 39, 102.9, 40, 0.3, "F.Cu", 21),
    segment(107.81, 33.12, 108, 41, 0.3, "F.Cu", 72),

    // Right ultrasonic trigger channel.
    segment(107.81, 22.96, 92, 22.96, 0.3, "F.Cu", 22),
    via(92, 22.96, 22),
    segment(92, 22.96, 92, 46, 0.3, "B.Cu", 22),
    via(92, 46, 22),
    segment(92, 46, 102.9, 46, 0.3, "F.Cu", 22),
    segment(107.81, 25.5, 90, 25.5, 0.3, "F.Cu", 73),
    via(90, 25.5, 73),
    segment(90, 25.5, 90, 47, 0.3, "B.Cu", 73),
    via(90, 47, 73),
    segment(90, 47, 105.1, 47, 0.3, "F.Cu", 73),

    ...photoBridgeRoutes,
];
insertBefore("(zone", bufferRoutes.join("\n  "));

// Restore high-value hand-assembly markings that the production silk cleanup
// intentionally removes from autogenerated footprints.
for (const ref of ["C10", "C16", "C19", "C24", "C26"]) {
    editFootprint(ref, (block) => {
        block = unhideReference(block);
        const p1 = padBlock(block, 1).match(/\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
        if (!p1) return block;
        const px = Number(p1[1]);
        const py = Number(p1[2]);
        return appendToFootprint(
            block,
            `(fp_text user "+" (at ${px} ${py - 2.2}) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.2))))`,
        );
    });
}

insertBefore(
    "(segment",
    '(gr_text "HAND-SOLDER BUILD | 1206 PASSIVES | DIP LOGIC/PHOTOMOS" (at 64 183.5) (layer "F.SilkS") (effects (font (size 0.72 0.72) (thickness 0.15))))',
);

const bomRows = [
    'Comment,Designator,Footprint,LCSC Part #,Manufacturer,Manufacturer Part Number,Assembly Notes',
    '"1uF 25V X7R","C1,C2",1206,,,"Generic 1206 25V X7R","Hand solder; oversized 1206 lands"',
    '"1uF 50V X7R","C18,C25",1210,,KEMET,C1210C105K5RACTU,"Hand solder; extended toe pads"',
    '"100nF 25V X7R","C3,C20,C21,C22,C23,C27,C28",1206,,,"Generic 1206 25V X7R","Hand solder; C28 is U11 bypass"',
    '"10nF HALL RC 25V C0G","C4,C5,C6,C7,C8,C9",1206,,KEMET,C1206C103J3GACTU,"Hand solder; oversized 1206 lands"',
    '"22uF 100V low-ESR","C10,C26",CP_Radial_D8_P3.5,,Panasonic,EEUFC2A220,"Hand/THT; polarity marked"',
    '"4.7uF 100V X7R",C11,1210,,TDK,C3225X7S2A475K250AB,"Hand solder; extended toe pads"',
    '"470uF 10V low-ESR",C16,CP_Radial_D8_P3.5,,Panasonic,EEUFR1A471,"Hand/THT; polarity marked"',
    '"470uF 50V low-ESR",C19,CP_Radial_D12.5_P5,,Panasonic,EEUFR1H471,"Hand/THT; 24V servo rail; polarity marked"',
    '"1000uF 10V low-ESR RGB bulk",C24,CP_Radial_D10_P5,,Panasonic,EEU-FS1A102,"Hand/THT; polarity marked"',
    '"SMCJ48A TVS",D1,SMC,,Littelfuse,SMCJ48A,"Large SMT, hand solder"',
    '"SMBJ26A 26V TVS",D2,SMB,,Littelfuse,SMBJ26A,"Large SMT, hand solder; cathode pad 1"',
    '"5x20 fuse holder","F1,F2,F3",0PTF0015P,,Littelfuse,0PTF0015P,"Hand/THT"',
    '"5A time-delay ceramic fuse 400VDC","F1_LINK,F2_LINK",5x20_cartridge,,Eaton Bussmann,S505H-5-R,"Hand install"',
    '"3.15A time-delay ceramic fuse 400VDC",F3_LINK,5x20_cartridge,,Eaton Bussmann,S505H-3.15-R,"Hand install"',
    '"120R@100MHz 6A ferrite",FB2,1206,,Murata,BLM31KN121SN1L,"Large SMT, hand solder"',
    '"36-42V battery terminal",J_BAT,PTH_2x1_5.00mm,,Phoenix Contact,1935161,"Hand/THT"',
    '"ESP32 socket 1x15","J_ESP_L,J_ESP_R",PinSocket_1x15_P2.54mm,,Samtec,SSW-115-01-G-S,"Hand/THT"',
    '"Mini-Fit Jr 2x2 vertical",J_PI_PWR,MiniFitJr_2x2,,Molex,0039281043,"Hand/THT"',
    '"24V servo header 1x3",J_SERVO,PinHeader_1x03_P2.54mm,,Samtec,TSW-103-07-G-S,"Hand/THT"',
    '"3.50mm terminal 1x2","J_24V_AUX,J_LBRK,J_LREV,J_RBRK,J_RREV",TerminalBlock_1x02_P3.50mm,,Phoenix Contact,1984617,"Hand/THT"',
    '"Enable header 1x2","JP_LBRK,JP_LREV,JP_RBRK,JP_RREV",PinHeader_1x02_P2.54mm,,Samtec,TSW-102-07-G-S,"Hand/THT"',
    '"100V N-MOSFET","Q5,Q6",TO-220,,STMicroelectronics,STP100N10F7,"Hand/THT"',
    '"330R 1pct","R10,R12,R16,R18,R43,R45,R48",1206,,Yageo,RC1206FR-07330RL,"Hand solder; oversized 1206 lands"',
    '"1k 1pct","R13,R14",1206,,Yageo,RC1206FR-071KL,"Hand solder"',
    '"10k 1pct","R1,R3,R5,R7,R19,R21,R23,R25,R27,R51,R52",1206,,Yageo,RC1206FR-0710KL,"Hand solder"',
    '"12k 1pct HALL","R2,R20,R22,R24,R26,R28",1206,,Yageo,RC1206FR-0712KL,"Hand solder"',
    '"15k 1pct ULTRASONIC","R4,R6,R8",1206,,Yageo,RC1206FR-0715KL,"Hand solder"',
    '"20k 1pct BAT ADC",R42,1206,,Yageo,RC1206FR-0720KL,"Hand solder"',
    '"22k 1pct throttle gain","R47,R50",1206,,Yageo,RC1206FR-0722KL,"Hand solder"',
    '"6.04k 1pct throttle gain","R46,R49",1206,,Yageo,RC1206FR-076K04L,"Hand solder"',
    '"37.4k 1pct",R36,1206,,Yageo,RC1206FR-0737K4L,"Hand solder"',
    '"49.9k 1pct",R35,1206,,Yageo,RC1206FR-0749K9L,"Hand solder"',
    '"100k 1pct","R9,R11,R15,R17,R29,R30,R53",1206,,Yageo,RC1206FR-07100KL,"Hand solder"',
    '"240k 1pct","R40,R41",1206,,Yageo,RC1206FR-07240KL,"Hand solder; use >=50V working rating"',
    '"470k 1pct",R39,1206,,Yageo,RC1206FR-07470KL,"Hand solder"',
    '"806k 1pct UWS trim-up",R44,1206,,Yageo,RC1206FR-07806KL,"Hand solder"',
    '"2.45M 1pct","R37,R38",1206,,Yageo,RC1206FR-072M45L,"Hand solder; series pair shares surge voltage"',
    '"Quad 5V AHCT buffer",U11,DIP-14,,Texas Instruments,SN74AHCT125N,"Hand/THT; replaces four SOT-23-5 buffers"',
    '"Dual rail-to-rail throttle op amp",U10,SOIC-8,,Texas Instruments,TLV9002IDR,"Hand solder; long toe pads"',
    '"60V PhotoMOS floating contact","U6,U7,U8,U9",DIP-4,,Panasonic Industry,AQY212GH,"Hand/THT; 5mA recommended LED drive minimum"',
    '"LTC4367 overvoltage controller",U4,MSOP-8,,Analog Devices,LTC4367IMS8#PBF,"Hand solder; long toe pads; only fine-pitch IC"',
    '"5V isolated DC-DC module",PS1,Murata_UWS_Q48_THT,,Murata Power Solutions,UWS-5/10-Q48N-C,"Hand/THT"',
    '"24V 2.5A isolated DC-DC module",PS2,Traco_TEN60WIN_THT,,Traco Power,TEN 60-4815WIN,"Hand/THT"',
];
fs.writeFileSync(BOM, `${bomRows.join("\n")}\n`);

fs.writeFileSync(BOARD, board);
fs.writeFileSync(
    ENCODED,
    zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n",
);
execFileSync(process.execPath, ["scripts/export-esp32-carrier-v3-cpl.mjs", BOARD], {
    stdio: "inherit",
});
console.log(`applied hand-solder production transform to ${BOARD}`);
