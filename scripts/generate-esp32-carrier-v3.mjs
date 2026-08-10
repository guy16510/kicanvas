import fs from "node:fs";
import zlib from "node:zlib";

const SOURCE =
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v2.kicad_pcb.gz.b64";
const OUT = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const OUT_B64 = `${OUT}.gz.b64`;

const encoded = fs.readFileSync(SOURCE, "utf8").trim();
let board = zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");

function balancedEnd(source, start) {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    throw new Error(`unterminated block at ${start}`);
}

function removeFootprint(ref) {
    let cursor = 0;
    while (true) {
        const start = board.indexOf("(footprint", cursor);
        if (start < 0) return;
        const end = balancedEnd(board, start);
        const block = board.slice(start, end);
        if (block.includes(`(property "Reference" "${ref}"`)) {
            board = board.slice(0, start) + board.slice(end);
            return;
        }
        cursor = end;
    }
}

function addNets(entries) {
    const firstFootprint = board.indexOf("(footprint");
    const before = board.slice(0, firstFootprint);
    const re = /\n\s*\(net\s+\d+\s+"[^"]+"\)/g;
    let match;
    let lastEnd = -1;
    while ((match = re.exec(before))) lastEnd = match.index + match[0].length;
    if (lastEnd < 0)
        throw new Error("net declaration insertion point not found");
    const declarations = entries
        .map(([id, name]) => `\n  (net ${id} "${name}")`)
        .join("");
    board = board.slice(0, lastEnd) + declarations + board.slice(lastEnd);
}

function insertFootprints(text) {
    const at = board.indexOf("(segment");
    if (at < 0) throw new Error("segment insertion point not found");
    board = board.slice(0, at) + text + "\n  " + board.slice(at);
}

function insertRouting(text) {
    const at = board.indexOf("(zone");
    if (at >= 0) board = board.slice(0, at) + text + "\n  " + board.slice(at);
    else
        board =
            board.slice(0, board.lastIndexOf(")")) +
            "\n  " +
            text +
            "\n" +
            board.slice(board.lastIndexOf(")"));
}

function passive({
    ref,
    value,
    x,
    y,
    rot = 0,
    net1,
    name1,
    net2,
    name2,
    kind = "C",
    size = "0805",
}) {
    const span = size === "1206" ? 1.7 : 1.4;
    const pad = size === "1206" ? 1.7 : 1.4;
    const silkX = size === "1206" ? 1.9 : 1.5;
    const silkY = size === "1206" ? 1.1 : 0.9;
    return `(footprint "${kind}_${size}" (layer "F.Cu") (at ${x} ${y} ${rot})
    (property "Reference" "${ref}" (at 0 -1.9 ${rot}) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 1.9 ${rot}) (layer "F.Fab") hide)
    (fp_rect (start -${silkX} -${silkY}) (end ${silkX} ${silkY}) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -${span} 0 ${rot}) (size ${pad} ${pad}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net1} "${name1}"))
    (pad "2" smd roundrect (at ${span} 0 ${rot}) (size ${pad} ${pad}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net2} "${name2}"))
  )`;
}

function radialCap({ ref, value, x, y, net1, name1, net2 = 3, name2 = "GND" }) {
    return `(footprint "CP_Radial_D8.0mm_P3.50mm" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 1.75 -5 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 1.75 5 0) (layer "F.Fab") hide)
    (fp_circle (center 1.75 0) (end 5.75 0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0) (size 2.4 2.4) (drill 1) (layers "*.Cu" "*.Mask") (net ${net1} "${name1}"))
    (pad "2" thru_hole circle (at 3.5 0) (size 2.4 2.4) (drill 1) (layers "*.Cu" "*.Mask") (net ${net2} "${name2}"))
  )`;
}

function terminal2({
    ref,
    value,
    x,
    y,
    p1net,
    p1name,
    p2net = 3,
    p2name = "GND",
}) {
    return `(footprint "TerminalBlock_1x02_P5.08" (layer "F.Cu") (at ${x} ${y} 90)
    (property "Reference" "${ref}" (at 2.54 -4 90) (layer "F.SilkS"))
    (property "Value" "${value}" (at 2.54 4 90) (layer "F.Fab") hide)
    (fp_rect (start -2.5 -3) (end 7.6 3) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0 90) (size 3.4 3.4) (drill 1.5) (layers "*.Cu" "*.Mask") (net ${p1net} "${p1name}"))
    (pad "2" thru_hole circle (at 5.08 0 90) (size 3.4 3.4) (drill 1.5) (layers "*.Cu" "*.Mask") (net ${p2net} "${p2name}"))
  )`;
}

function fuse2410({ x, y }) {
    return `(footprint "Fuse_2410_HandSolder" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "F1" (at 0 -2.4 0) (layer "F.SilkS"))
    (property "Value" "3A_63V_MIN" (at 0 2.4 0) (layer "F.Fab") hide)
    (fp_rect (start -4 -1.8) (end 4 1.8) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -3 0) (size 2.4 3.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net 53 "BAT_RAW"))
    (pad "2" smd roundrect (at 3 0) (size 2.4 3.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net 54 "BAT_FUSED"))
  )`;
}

function diodeSMC({ ref, value, x, y, net1, name1, net2, name2 }) {
    return `(footprint "Diode_SMC" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -4.2 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 4.2 0) (layer "F.Fab") hide)
    (fp_rect (start -4.4 -3.2) (end 4.4 3.2) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -3.4 0) (size 3.0 4.0) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net ${net1} "${name1}"))
    (pad "2" smd roundrect (at 3.4 0) (size 3.0 4.0) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15) (net ${net2} "${name2}"))
  )`;
}

function inductor() {
    return `(footprint "Coilcraft_XEL6060" (layer "F.Cu") (at 66 128.5 90)
    (property "Reference" "L1" (at 0 -4.2 90) (layer "F.SilkS"))
    (property "Value" "2.7uH_XEL6060" (at 0 4.2 90) (layer "F.Fab") hide)
    (fp_rect (start -3.5 -3.5) (end 3.5 3.5) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -2.3 0 90) (size 2.8 5.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.1) (net 56 "PWR_SW"))
    (pad "2" smd roundrect (at 2.3 0 90) (size 2.8 5.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.1) (net 2 "+5V"))
  )`;
}

function lt8645s() {
    const nets = new Map([
        [1, [2, "+5V"]],
        [4, [55, "VIN_PROTECTED"]],
        [5, [55, "VIN_PROTECTED"]],
        [6, [55, "VIN_PROTECTED"]],
        [8, [3, "GND"]],
        [9, [3, "GND"]],
        [10, [3, "GND"]],
        [12, [56, "PWR_SW"]],
        [13, [56, "PWR_SW"]],
        [14, [56, "PWR_SW"]],
        [15, [56, "PWR_SW"]],
        [16, [56, "PWR_SW"]],
        [17, [3, "GND"]],
        [18, [3, "GND"]],
        [19, [3, "GND"]],
        [21, [55, "VIN_PROTECTED"]],
        [22, [55, "VIN_PROTECTED"]],
        [23, [55, "VIN_PROTECTED"]],
        [25, [58, "PWR_EN"]],
        [26, [59, "PWR_RT"]],
        [28, [3, "GND"]],
        [29, [61, "PWR_SS"]],
        [30, [3, "GND"]],
        [32, [57, "PWR_FB"]],
        [33, [3, "GND"]],
        [34, [3, "GND"]],
        [35, [3, "GND"]],
        [36, [3, "GND"]],
        [37, [3, "GND"]],
        [38, [3, "GND"]],
    ]);
    const padNet = (pin) =>
        nets.has(pin) ? ` (net ${nets.get(pin)[0]} "${nets.get(pin)[1]}")` : "";
    const pads = [];
    const ys = [
        -2.25, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.25,
    ];
    for (let i = 0; i < 10; i++)
        pads.push(
            `    (pad "${i + 1}" smd roundrect (at -2.45 ${ys[i]}) (size 1.15 0.38) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${padNet(i + 1)})`,
        );
    const xsBottom = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25];
    for (let i = 0; i < 6; i++)
        pads.push(
            `    (pad "${11 + i}" smd roundrect (at ${xsBottom[i]} 3.45) (size 0.38 1.15) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${padNet(11 + i)})`,
        );
    for (let i = 0; i < 10; i++)
        pads.push(
            `    (pad "${17 + i}" smd roundrect (at 2.45 ${ys[9 - i]}) (size 1.15 0.38) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${padNet(17 + i)})`,
        );
    const xsTop = [1.25, 0.75, 0.25, -0.25, -0.75, -1.25];
    for (let i = 0; i < 6; i++)
        pads.push(
            `    (pad "${27 + i}" smd roundrect (at ${xsTop[i]} -3.45) (size 0.38 1.15) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${padNet(27 + i)})`,
        );
    const ep = [
        [33, -0.7, -1.75],
        [34, 0.7, -1.75],
        [35, -0.7, 0],
        [36, 0.7, 0],
        [37, -0.7, 1.75],
        [38, 0.7, 1.75],
    ];
    for (const [pin, x, y] of ep)
        pads.push(
            `    (pad "${pin}" smd rect (at ${x} ${y}) (size 1.25 1.45) (layers "F.Cu" "F.Paste" "F.Mask")${padNet(pin)})`,
        );
    return `(footprint "LT8645S_LQFN32_6x4_ADI" (layer "F.Cu") (at 66 121.5)
    (property "Reference" "U5" (at 0 -5.2 0) (layer "F.SilkS"))
    (property "Value" "LT8645SEV#PBF" (at 0 5.2 0) (layer "F.Fab") hide)
    (fp_rect (start -2 -3) (end 2 3) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (fp_circle (center -2.7 -3.4) (end -2.45 -3.4) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
${pads.join("\n")}
  )`;
}

function piConnector() {
    return `(footprint "MiniFitJr_2x2_P4.20" (layer "F.Cu") (at 111 129)
    (property "Reference" "J_PI_PWR" (at 2.1 -4.5 0) (layer "F.SilkS"))
    (property "Value" "PI_5V_8A" (at 2.1 8.7 0) (layer "F.Fab") hide)
    (fp_rect (start -2.5 -2.5) (end 6.7 6.7) (stroke (width 0.35) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "2" thru_hole circle (at 4.2 0) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "3" thru_hole circle (at 0 4.2) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "4" thru_hole circle (at 4.2 4.2) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function servoHeader() {
    return `(footprint "PinHeader_1x03_P2.54" (layer "F.Cu") (at 8 80 90)
    (property "Reference" "J_SERVO" (at 2.54 -3 90) (layer "F.SilkS"))
    (property "Value" "SERVO_SIG_5V_GND" (at 2.54 3 90) (layer "F.Fab") hide)
    (fp_rect (start -1.4 -1.4) (end 6.5 1.4) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0 90) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 15 "SERVO_SIG"))
    (pad "2" thru_hole circle (at 2.54 0 90) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 60 "+5V_SERVO"))
    (pad "3" thru_hole circle (at 5.08 0 90) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function mountingHole(ref, x, y) {
    return `(footprint "MountingHole_3.2mm_M3" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -4 0) (layer "F.SilkS"))
    (property "Value" "M3" (at 0 4 0) (layer "F.Fab") hide)
    (fp_circle (center 0 0) (end 3 0) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask"))
  )`;
}

for (const ref of ["J5VIN", "JGNDIN", "JPIOUT5", "JPIOUTG", "J_SERVO"])
    removeFootprint(ref);
board = board.replace(
    "(gr_rect (start 1 1) (end 129 109)",
    "(gr_rect (start 1 1) (end 129 139)",
);

addNets([
    [53, "BAT_RAW"],
    [54, "BAT_FUSED"],
    [55, "VIN_PROTECTED"],
    [56, "PWR_SW"],
    [57, "PWR_FB"],
    [58, "PWR_EN"],
    [59, "PWR_RT"],
    [60, "+5V_SERVO"],
    [61, "PWR_SS"],
]);

const hallCaps = [
    passive({
        ref: "C4",
        value: "10nF",
        x: 24,
        y: 18.6,
        net1: 4,
        name1: "L_HALL_C_GPIO",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "C5",
        value: "10nF",
        x: 92,
        y: 32.5,
        rot: 180,
        net1: 19,
        name1: "L_HALL_A_GPIO",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "C6",
        value: "10nF",
        x: 92,
        y: 38.5,
        rot: 180,
        net1: 20,
        name1: "L_HALL_B_GPIO",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "C7",
        value: "10nF",
        x: 92,
        y: 56.5,
        rot: 180,
        net1: 23,
        name1: "R_HALL_A_GPIO",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "C8",
        value: "10nF",
        x: 92,
        y: 62.5,
        rot: 180,
        net1: 24,
        name1: "R_HALL_B_GPIO",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "C9",
        value: "10nF",
        x: 92,
        y: 80.5,
        rot: 180,
        net1: 27,
        name1: "R_HALL_C_GPIO",
        net2: 3,
        name2: "GND",
    }),
];

const powerParts = [
    terminal2({
        ref: "J_BAT",
        value: "36-42V_BATTERY",
        x: 8,
        y: 120,
        p1net: 53,
        p1name: "BAT_RAW",
    }),
    fuse2410({ x: 22, y: 120 }),
    diodeSMC({
        ref: "D1",
        value: "SS510_5A_100V_REVERSE_PROTECT",
        x: 34,
        y: 120,
        net1: 54,
        name1: "BAT_FUSED",
        net2: 55,
        name2: "VIN_PROTECTED",
    }),
    diodeSMC({
        ref: "D2",
        value: "SMCJ43A_TVS",
        x: 45,
        y: 128,
        rot: 90,
        net1: 55,
        name1: "VIN_PROTECTED",
        net2: 3,
        name2: "GND",
    }),
    radialCap({
        ref: "C10",
        value: "100uF_63V_INPUT_BULK",
        x: 49,
        y: 133,
        net1: 55,
        name1: "VIN_PROTECTED",
    }),
    passive({
        ref: "C11",
        value: "4.7uF_100V_X7R",
        x: 54,
        y: 121.5,
        net1: 55,
        name1: "VIN_PROTECTED",
        net2: 3,
        name2: "GND",
        size: "1206",
    }),
    passive({
        ref: "C12",
        value: "0.47uF_100V_X7R",
        x: 60,
        y: 121.5,
        net1: 55,
        name1: "VIN_PROTECTED",
        net2: 3,
        name2: "GND",
    }),
    lt8645s(),
    passive({
        ref: "C13",
        value: "0.47uF_100V_X7R",
        x: 72,
        y: 121.5,
        rot: 180,
        net1: 55,
        name1: "VIN_PROTECTED",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "R31",
        value: "100k_EN",
        x: 73,
        y: 116.5,
        net1: 55,
        name1: "VIN_PROTECTED",
        net2: 58,
        name2: "PWR_EN",
        kind: "R",
    }),
    passive({
        ref: "R32",
        value: "88.7k_500kHz",
        x: 77,
        y: 119.5,
        rot: 90,
        net1: 59,
        name1: "PWR_RT",
        net2: 3,
        name2: "GND",
        kind: "R",
    }),
    passive({
        ref: "C14",
        value: "0.1uF_SOFTSTART",
        x: 80,
        y: 119.5,
        rot: 90,
        net1: 61,
        name1: "PWR_SS",
        net2: 3,
        name2: "GND",
    }),
    passive({
        ref: "R33",
        value: "1.06M_FB_TOP",
        x: 60,
        y: 115.5,
        net1: 2,
        name1: "+5V",
        net2: 57,
        name2: "PWR_FB",
        kind: "R",
    }),
    passive({
        ref: "R34",
        value: "249k_FB_BOTTOM",
        x: 66,
        y: 115.5,
        net1: 57,
        name1: "PWR_FB",
        net2: 3,
        name2: "GND",
        kind: "R",
    }),
    passive({
        ref: "C15",
        value: "2.2pF_FF",
        x: 63,
        y: 112.8,
        net1: 2,
        name1: "+5V",
        net2: 57,
        name2: "PWR_FB",
    }),
    inductor(),
    radialCap({
        ref: "C16",
        value: "100uF_10V_OUTPUT_BULK",
        x: 75,
        y: 132,
        net1: 2,
        name1: "+5V",
    }),
    passive({
        ref: "C17",
        value: "22uF_10V_X7R",
        x: 84,
        y: 132,
        rot: 90,
        net1: 2,
        name1: "+5V",
        net2: 3,
        name2: "GND",
        size: "1206",
    }),
    passive({
        ref: "C18",
        value: "22uF_10V_X7R",
        x: 90,
        y: 132,
        rot: 90,
        net1: 2,
        name1: "+5V",
        net2: 3,
        name2: "GND",
        size: "1206",
    }),
    piConnector(),
    mountingHole("H5", 5, 135),
    mountingHole("H6", 124, 135),
];

const servoParts = [
    servoHeader(),
    passive({
        ref: "FB2",
        value: "FERRITE_5A_SERVO",
        x: 15,
        y: 82.54,
        net1: 2,
        name1: "+5V",
        net2: 60,
        name2: "+5V_SERVO",
        kind: "FB",
        size: "1206",
    }),
    radialCap({
        ref: "C19",
        value: "470uF_10V_SERVO_BULK",
        x: 21,
        y: 84,
        net1: 60,
        name1: "+5V_SERVO",
    }),
];

insertFootprints([...hallCaps, ...powerParts, ...servoParts].join("\n  "));

const segments = [
    // Hall RC capacitors are directly across each divider's lower resistor.
    '(segment (start 22.60 16.20) (end 22.60 18.60) (width 0.28) (layer "F.Cu") (net 4))',
    '(segment (start 25.40 16.20) (end 25.40 18.60) (width 0.40) (layer "F.Cu") (net 3))',
    '(segment (start 93.40 30.20) (end 93.40 32.50) (width 0.28) (layer "F.Cu") (net 19))',
    '(segment (start 90.60 30.20) (end 90.60 32.50) (width 0.40) (layer "F.Cu") (net 3))',
    '(segment (start 93.40 36.20) (end 93.40 38.50) (width 0.28) (layer "F.Cu") (net 20))',
    '(segment (start 90.60 36.20) (end 90.60 38.50) (width 0.40) (layer "F.Cu") (net 3))',
    '(segment (start 93.40 54.20) (end 93.40 56.50) (width 0.28) (layer "F.Cu") (net 23))',
    '(segment (start 90.60 54.20) (end 90.60 56.50) (width 0.40) (layer "F.Cu") (net 3))',
    '(segment (start 93.40 60.20) (end 93.40 62.50) (width 0.28) (layer "F.Cu") (net 24))',
    '(segment (start 90.60 60.20) (end 90.60 62.50) (width 0.40) (layer "F.Cu") (net 3))',
    '(segment (start 93.40 78.20) (end 93.40 80.50) (width 0.28) (layer "F.Cu") (net 27))',
    '(segment (start 90.60 78.20) (end 90.60 80.50) (width 0.40) (layer "F.Cu") (net 3))',

    // Battery protection path, input current is ~1.3A at full 5.1V/8A output.
    '(segment (start 8.00 120.00) (end 19.00 120.00) (width 2.00) (layer "F.Cu") (net 53))',
    '(segment (start 25.00 120.00) (end 30.60 120.00) (width 2.00) (layer "F.Cu") (net 54))',
    '(segment (start 37.40 120.00) (end 52.30 120.00) (width 2.20) (layer "F.Cu") (net 55))',
    '(segment (start 52.30 120.00) (end 52.30 121.50) (width 2.20) (layer "F.Cu") (net 55))',
    '(segment (start 55.70 121.50) (end 58.60 121.50) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 58.60 121.50) (end 63.55 120.75) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 58.60 121.50) (end 63.55 121.25) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 58.60 121.50) (end 63.55 121.75) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 69.40 121.75) (end 70.60 121.50) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 69.40 121.25) (end 70.60 121.50) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 69.40 120.75) (end 70.60 121.50) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 70.60 121.50) (end 73.60 121.50) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 41.60 128.00) (end 41.60 120.00) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 45.00 128.00) (end 41.60 128.00) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 49.00 133.00) (end 49.00 124.00) (width 1.20) (layer "F.Cu") (net 55))',
    '(segment (start 49.00 124.00) (end 52.30 121.50) (width 1.20) (layer "F.Cu") (net 55))',

    // Control and feedback around LT8645S.
    '(segment (start 69.40 119.75) (end 71.00 116.50) (width 0.28) (layer "F.Cu") (net 58))',
    '(segment (start 71.00 116.50) (end 71.60 116.50) (width 0.28) (layer "F.Cu") (net 58))',
    '(segment (start 74.40 116.50) (end 75.50 116.50) (width 0.40) (layer "F.Cu") (net 55))',
    '(segment (start 75.50 116.50) (end 75.50 121.50) (width 0.40) (layer "F.Cu") (net 55))',
    '(segment (start 75.50 121.50) (end 73.40 121.50) (width 0.40) (layer "F.Cu") (net 55))',
    '(segment (start 69.40 119.25) (end 75.60 119.50) (width 0.28) (layer "F.Cu") (net 59))',
    '(segment (start 69.40 118.25) (end 78.60 119.50) (width 0.28) (layer "F.Cu") (net 61))',
    '(segment (start 64.75 118.05) (end 64.40 115.50) (width 0.28) (layer "F.Cu") (net 57))',
    '(segment (start 64.40 115.50) (end 64.60 115.50) (width 0.28) (layer "F.Cu") (net 57))',
    '(segment (start 61.40 115.50) (end 61.60 112.80) (width 0.28) (layer "F.Cu") (net 2))',
    '(segment (start 64.40 112.80) (end 64.40 115.50) (width 0.28) (layer "F.Cu") (net 57))',

    // Compact SW node from all five switch pins to the inductor input.
    '(segment (start 64.75 124.95) (end 66.00 126.20) (width 2.00) (layer "F.Cu") (net 56))',
    '(segment (start 65.25 124.95) (end 66.00 126.20) (width 2.00) (layer "F.Cu") (net 56))',
    '(segment (start 65.75 124.95) (end 66.00 126.20) (width 2.00) (layer "F.Cu") (net 56))',
    '(segment (start 66.25 124.95) (end 66.00 126.20) (width 2.00) (layer "F.Cu") (net 56))',
    '(segment (start 66.75 124.95) (end 66.00 126.20) (width 2.00) (layer "F.Cu") (net 56))',

    // 5.1V output, wide copper to Pi connector, separate branch to legacy logic bus.
    '(segment (start 66.00 130.80) (end 75.00 130.80) (width 5.00) (layer "F.Cu") (net 2))',
    '(segment (start 75.00 130.80) (end 111.00 129.00) (width 5.00) (layer "F.Cu") (net 2))',
    '(segment (start 111.00 129.00) (end 115.20 129.00) (width 5.00) (layer "F.Cu") (net 2))',
    '(segment (start 80.00 130.80) (end 74.00 101.10) (width 2.00) (layer "B.Cu") (net 2))',
    '(segment (start 74.00 101.10) (end 74.00 92.00) (width 2.00) (layer "B.Cu") (net 2))',

    // BIAS from 5.1V output.
    '(segment (start 63.55 119.25) (end 60.00 115.50) (width 0.40) (layer "B.Cu") (net 2))',
    '(segment (start 60.00 115.50) (end 75.00 130.80) (width 0.80) (layer "B.Cu") (net 2))',

    // Servo branch, filtered from main +5V rail.
    '(segment (start 12.00 92.00) (end 13.60 82.54) (width 1.20) (layer "B.Cu") (net 2))',
    '(segment (start 16.40 82.54) (end 8.00 82.54) (width 1.50) (layer "F.Cu") (net 60))',
    '(segment (start 16.40 82.54) (end 21.00 84.00) (width 1.50) (layer "F.Cu") (net 60))',
];

const vias = [
    // LT8645S exposed-pad thermal vias to solid bottom ground plane.
    [65.3, 119.75],
    [66.7, 119.75],
    [65.3, 121.5],
    [66.7, 121.5],
    [65.3, 123.25],
    [66.7, 123.25],
    // Ground stitching around input/output capacitors and regulator.
    [55.4, 121.5],
    [73.4, 121.5],
    [78.4, 119.5],
    [81.4, 119.5],
    [78.5, 132],
    [84, 133.4],
    [90, 133.4],
    [48.4, 128],
].map(
    ([x, y]) =>
        `(via (at ${x} ${y}) (size 1.2) (drill 0.6) (layers "F.Cu" "B.Cu") (net 3))`,
);

const graphics = [
    '(gr_rect (start 3 111) (end 127 137) (stroke (width 0.4) (type dash)) (fill none) (layer "F.SilkS"))',
    '(gr_text "HIGH POWER 36-42V -> 5.1V / 8A" (at 65 113) (layer "F.SilkS") (effects (font (size 1.5 1.5) (thickness 0.3))))',
    '(gr_text "LT8645S 500kHz | KEEP HALL/SIGNAL WIRING ABOVE THIS LINE" (at 65 136) (layer "F.SilkS") (effects (font (size 1.0 1.0) (thickness 0.2))))',
    '(gr_text "BAT + / -" (at 10 115) (layer "F.SilkS") (effects (font (size 1.1 1.1) (thickness 0.2))))',
    '(gr_text "PI 5.1V HIGH CURRENT" (at 111 119) (layer "F.SilkS") (effects (font (size 1.1 1.1) (thickness 0.2))))',
];

const zones = [
    `(zone (net 3) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.4))
    (min_thickness 0.25) (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.4))
    (polygon (pts (xy 3 111) (xy 127 111) (xy 127 137) (xy 3 137)))
  )`,
    `(zone (net 2) (net_name "+5V") (layer "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25) (fill yes (thermal_gap 0.35) (thermal_bridge_width 0.5))
    (polygon (pts (xy 68 126.5) (xy 126 126.5) (xy 126 136) (xy 68 136)))
  )`,
];

insertRouting([...segments, ...vias, ...graphics, ...zones].join("\n  "));

fs.writeFileSync(OUT, board);
fs.writeFileSync(
    OUT_B64,
    zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n",
);
console.log(`generated ${OUT}: ${Buffer.byteLength(board)} bytes`);
