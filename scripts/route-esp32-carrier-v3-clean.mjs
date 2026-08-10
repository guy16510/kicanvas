import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const boardPath =
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const encodedPath = `${boardPath}.gz.b64`;

execFileSync(process.execPath, ["scripts/finalize-esp32-carrier-v3.mjs"], {
    stdio: "inherit",
});
let board = fs.readFileSync(boardPath, "utf8");

function endOfBlock(source, start) {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) return i + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function footprintBounds(ref) {
    let p = 0;
    while (true) {
        const start = board.indexOf("(footprint", p);
        if (start < 0) throw new Error(`footprint ${ref} not found`);
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        if (block.includes(`(property "Reference" "${ref}"`))
            return { start, end, block };
        p = end;
    }
}

function editFootprint(ref, edit) {
    const { start, end, block } = footprintBounds(ref);
    const next = edit(block);
    board = board.slice(0, start) + next + board.slice(end);
}

function moveFootprint(ref, x, y, rot = null) {
    editFootprint(ref, (block) =>
        block.replace(
            /^(\(footprint[^\n]*?\(at\s+)[-\d.]+\s+[-\d.]+(?:\s+[-\d.]+)?(\))/,
            `$1${x} ${y}${rot === null ? "" : ` ${rot}`}$2`,
        ),
    );
}

function smd2({
    ref,
    value,
    x,
    y,
    n1,
    s1,
    n2,
    s2,
    span = 1.1,
    sx = 1.2,
    sy = 1.2,
}) {
    return `(footprint "SMD2_${sx}x${sy}" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.0 0) (layer "F.Fab") hide)
    (property "Value" "${value}" (at 0 2.0 0) (layer "F.Fab") hide)
    (pad "1" smd roundrect (at -${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n1} "${s1}"))
    (pad "2" smd roundrect (at ${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n2} "${s2}"))
  )`;
}

function replaceFootprint(ref, replacement) {
    const { start, end } = footprintBounds(ref);
    board = board.slice(0, start) + replacement + board.slice(end);
}

function seg(x1, y1, x2, y2, width, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}

function via(x, y, net, size = 1.0, drill = 0.5) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}

// Correct the 0.5 mm-pitch LT8645S perimeter land width.  The first draft used
// 0.38 mm tangential lands, leaving too little copper-to-copper clearance.
editFootprint("U5", (block) =>
    block
        .replaceAll("(size 1.15 0.38)", "(size 0.90 0.24)")
        .replaceAll("(size 0.38 1.15)", "(size 0.24 0.90)"),
);

// Correct LTC4367 UV/OV divider order.  The divider is VIN -> 2.45M -> 2.45M
// -> UV -> 37.4k -> OV -> 49.9k -> GND.  Typical thresholds are approximately
// 30.0 V UV rising and 50.0 V OV rising using the 0.525/0.500 V comparators.
replaceFootprint(
    "R38",
    smd2({
        ref: "R38",
        value: "2.45M_1pct_UV_TOP_A",
        x: 46,
        y: 134,
        n1: 67,
        s1: "UV_LOW_MID",
        n2: 54,
        s2: "BAT_FUSED",
        span: 1.6,
        sx: 1.6,
        sy: 1.4,
    }),
);
replaceFootprint(
    "R37",
    smd2({
        ref: "R37",
        value: "2.45M_1pct_UV_TOP_B",
        x: 40,
        y: 134,
        n1: 59,
        s1: "UV_SENSE",
        n2: 67,
        s2: "UV_LOW_MID",
        span: 1.6,
        sx: 1.6,
        sy: 1.4,
    }),
);
replaceFootprint(
    "R36",
    smd2({
        ref: "R36",
        value: "37.4k_1pct_UV_OV",
        x: 34,
        y: 134,
        n1: 58,
        s1: "OV_SENSE",
        n2: 59,
        s2: "UV_SENSE",
    }),
);
replaceFootprint(
    "R35",
    smd2({
        ref: "R35",
        value: "49.9k_1pct_OV_BOTTOM",
        x: 28,
        y: 134,
        n1: 3,
        s1: "GND",
        n2: 58,
        s2: "OV_SENSE",
    }),
);

// Move the feedback network above the protected VIN path and move the servo
// connector/filter into the board extension, away from the legacy logic area.
moveFootprint("C15", 66, 112);
moveFootprint("R33", 72, 112);
moveFootprint("R34", 72, 116);
moveFootprint("J_SERVO", 6, 145);
moveFootprint("FB2", 18, 145);
moveFootprint("C19", 25, 145);

// Remove the first-draft custom routing/graphics/zones while preserving every
// legacy v2 trace and zone.  The custom block starts at the first Hall-cap stub.
const routeStart = board.indexOf("(segment (start 22.9 16.2)");
if (routeStart < 0) throw new Error("custom route block start not found");
const customGroundZone = board.indexOf(
    '(zone (net 3) (net_name "GND") (layer "B.Cu")',
    routeStart,
);
if (customGroundZone < 0) throw new Error("custom GND zone not found");
const afterGroundZone = endOfBlock(board, customGroundZone);
const custom5VZone = board.indexOf(
    '(zone (net 2) (net_name "+5V") (layer "F.Cu")',
    afterGroundZone,
);
if (custom5VZone < 0) throw new Error("custom +5V zone not found");
const customEnd = endOfBlock(board, custom5VZone);
board = board.slice(0, routeStart) + board.slice(customEnd);

const routes = [];

// Hall filters.  C4-C9 are 10 nF from each divided GPIO node to ground.
routes.push(
    seg(22.9, 16.2, 22.9, 18.6, 0.25, "F.Cu", 4),
    seg(25.1, 16.2, 25.1, 18.6, 0.35, "F.Cu", 3),
    seg(93.1, 30.2, 93.1, 32.5, 0.25, "F.Cu", 19),
    seg(90.9, 30.2, 90.9, 32.5, 0.35, "F.Cu", 3),
    seg(93.1, 36.2, 93.1, 38.5, 0.25, "F.Cu", 20),
    seg(90.9, 36.2, 90.9, 38.5, 0.35, "F.Cu", 3),
    seg(93.1, 54.2, 93.1, 56.5, 0.25, "F.Cu", 23),
    seg(90.9, 54.2, 90.9, 56.5, 0.35, "F.Cu", 3),
    seg(93.1, 60.2, 93.1, 62.5, 0.25, "F.Cu", 24),
    seg(90.9, 60.2, 90.9, 62.5, 0.35, "F.Cu", 3),
    seg(93.1, 78.2, 93.1, 80.5, 0.25, "F.Cu", 27),
    seg(90.9, 78.2, 90.9, 80.5, 0.35, "F.Cu", 3),
);

// Battery connector to fuse.  Route around J_BAT ground pin rather than through it.
routes.push(
    seg(7, 118, 7, 113.5, 1.5, "F.Cu", 53),
    seg(7, 113.5, 18, 113.5, 1.5, "F.Cu", 53),
    seg(18, 113.5, 18, 118, 1.5, "F.Cu", 53),
);

// Fused battery bus along the top of the protection section, with local taps.
routes.push(
    seg(22, 118, 22, 113.5, 1.5, "F.Cu", 54),
    seg(22, 113.5, 51.54, 113.5, 1.5, "F.Cu", 54),
    seg(51.54, 113.5, 51.54, 118, 1.5, "F.Cu", 54),
    seg(23.6, 113.5, 23.6, 126, 0.8, "F.Cu", 54),
    seg(34.8, 113.5, 34.8, 118.05, 0.35, "F.Cu", 54),
);

// Divider chain, right-to-left, below the protection FETs.
routes.push(
    seg(47.6, 113.5, 47.6, 131.5, 0.25, "B.Cu", 54),
    via(47.6, 131.5, 54),
    seg(47.6, 131.5, 47.6, 134, 0.25, "F.Cu", 54),
    seg(47.6, 134, 47.6, 134, 0.25, "F.Cu", 54),
    seg(44.4, 134, 41.6, 134, 0.25, "F.Cu", 67),
    seg(38.4, 134, 35.1, 134, 0.25, "F.Cu", 59),
    seg(32.9, 134, 29.1, 134, 0.25, "F.Cu", 58),
);

// Sense taps travel on the back layer so they do not cross the high-current path.
routes.push(
    seg(38.4, 134, 38.4, 132, 0.25, "F.Cu", 59),
    via(38.4, 132, 59),
    seg(38.4, 132, 32.5, 119.35, 0.25, "B.Cu", 59),
    via(32.5, 119.35, 59),
    seg(32.5, 119.35, 34.8, 119.35, 0.25, "F.Cu", 59),
    seg(29.1, 134, 29.1, 132, 0.25, "F.Cu", 58),
    via(29.1, 132, 58),
    seg(29.1, 132, 32.5, 120.65, 0.25, "B.Cu", 58),
    via(32.5, 120.65, 58),
    seg(32.5, 120.65, 34.8, 120.65, 0.25, "F.Cu", 58),
);

// LTC4367 shutdown pull-up and gate drive.  Gate distribution stays on B.Cu.
routes.push(
    seg(39.2, 121.95, 40.5, 123, 0.25, "F.Cu", 65),
    via(40.5, 123, 65),
    seg(40.5, 123, 44.1, 126, 0.25, "B.Cu", 65),
    via(44.1, 126, 65),
    seg(41.9, 126, 41.9, 124.5, 0.25, "F.Cu", 54),
    via(41.9, 124.5, 54),
    seg(41.9, 124.5, 42.5, 113.5, 0.25, "B.Cu", 54),
    via(42.5, 113.5, 54),
    seg(39.2, 118.05, 40.5, 116.5, 0.3, "F.Cu", 55),
    via(40.5, 116.5, 55),
    seg(40.5, 116.5, 49, 116.0, 0.3, "B.Cu", 55),
    via(49, 116.0, 55),
    seg(49, 116.0, 49, 118, 0.3, "F.Cu", 55),
    seg(49, 116.0, 62.16, 116.0, 0.3, "B.Cu", 55),
    via(62.16, 116.0, 55),
    seg(62.16, 116.0, 62.16, 118, 0.3, "F.Cu", 55),
);

// Back-to-back MOSFET source common node.
routes.push(seg(54.08, 118, 57.08, 118, 1.5, "F.Cu", 56));

// LTC4367 VOUT sense connects to the protected side on B.Cu.
routes.push(
    seg(39.2, 119.35, 40.5, 120.5, 0.25, "F.Cu", 57),
    via(40.5, 120.5, 57),
    seg(40.5, 120.5, 59.62, 121.5, 0.25, "B.Cu", 57),
    seg(59.62, 121.5, 59.62, 118, 0.25, "B.Cu", 57),
);

// Protected VIN distribution.  Keep the fast input network immediately beside U5.
routes.push(
    seg(59.62, 118, 59.62, 124, 1.0, "F.Cu", 57),
    seg(59.62, 124, 66.5, 124, 1.0, "F.Cu", 57),
    seg(66.5, 124, 66.5, 126, 0.8, "F.Cu", 57),
    seg(66.5, 124, 73.1, 124, 0.8, "F.Cu", 57),
    seg(73.1, 124, 73.1, 126, 0.6, "F.Cu", 57),
    seg(73.1, 124, 73.8, 124, 0.6, "F.Cu", 57),
    via(73.8, 124, 57),
    seg(73.8, 124, 73.8, 120, 0.6, "B.Cu", 57),
    seg(73.8, 120, 82.3, 120, 0.6, "B.Cu", 57),
    seg(82.3, 120, 82.3, 124, 0.6, "B.Cu", 57),
    via(82.3, 124, 57),
    seg(82.3, 124, 82.9, 124, 0.6, "F.Cu", 57),
    seg(82.9, 124, 82.9, 126, 0.6, "F.Cu", 57),
);

// U5 left/right VIN pins into short local rails.
routes.push(
    seg(73.8, 124, 73.8, 126.4, 0.6, "F.Cu", 57),
    seg(73.8, 125.25, 75.55, 125.25, 0.45, "F.Cu", 57),
    seg(73.8, 125.75, 75.55, 125.75, 0.45, "F.Cu", 57),
    seg(73.8, 126.25, 75.55, 126.25, 0.45, "F.Cu", 57),
    seg(82.3, 124, 82.3, 126.4, 0.6, "F.Cu", 57),
    seg(80.45, 125.25, 82.3, 125.25, 0.45, "F.Cu", 57),
    seg(80.45, 125.75, 82.3, 125.75, 0.45, "F.Cu", 57),
    seg(80.45, 126.25, 82.3, 126.25, 0.45, "F.Cu", 57),
);

// U5 ground pins and exposed thermal pads to the solid bottom ground plane.
for (const [x, y] of [
    [74.0, 127.25],
    [74.0, 127.75],
    [74.0, 128.25],
    [82.0, 127.25],
    [82.0, 127.75],
    [82.0, 128.25],
    [78.75, 121.2],
    [77.75, 121.2],
    [77.3, 124.25],
    [78.7, 124.25],
    [77.3, 126],
    [78.7, 126],
    [77.3, 127.75],
    [78.7, 127.75],
]) {
    routes.push(via(x, y, 3, 0.9, 0.45));
}
routes.push(
    seg(75.55, 127.25, 74.0, 127.25, 0.35, "F.Cu", 3),
    seg(75.55, 127.75, 74.0, 127.75, 0.35, "F.Cu", 3),
    seg(75.55, 128.25, 74.0, 128.25, 0.35, "F.Cu", 3),
    seg(80.45, 127.25, 82.0, 127.25, 0.35, "F.Cu", 3),
    seg(80.45, 127.75, 82.0, 127.75, 0.35, "F.Cu", 3),
    seg(80.45, 128.25, 82.0, 128.25, 0.35, "F.Cu", 3),
    seg(78.75, 122.55, 78.75, 121.2, 0.3, "F.Cu", 3),
    seg(77.75, 122.55, 77.75, 121.2, 0.3, "F.Cu", 3),
);

// EN, RT, soft-start, and feedback escape directly away from U5 before turning.
routes.push(
    seg(80.45, 124.25, 83.0, 124.25, 0.25, "F.Cu", 60),
    via(83.0, 124.25, 60),
    seg(83.0, 124.25, 87.1, 120, 0.25, "B.Cu", 60),
    via(87.1, 120, 60),
    seg(84.9, 120, 84.9, 121.5, 0.25, "F.Cu", 57),
    via(84.9, 121.5, 57),
    seg(84.9, 121.5, 82.3, 120, 0.25, "B.Cu", 57),
    seg(80.45, 123.75, 84.9, 124, 0.25, "F.Cu", 61),
    seg(87.1, 124, 87.1, 126, 0.25, "F.Cu", 3),
    via(87.1, 126, 3),
    seg(78.25, 122.55, 78.25, 119.5, 0.25, "F.Cu", 63),
    seg(78.25, 119.5, 78.9, 118, 0.25, "F.Cu", 63),
    seg(81.1, 118, 81.1, 120.0, 0.25, "F.Cu", 3),
    via(81.1, 120.0, 3),
    seg(76.75, 122.55, 75.0, 121.0, 0.25, "F.Cu", 62),
    via(75.0, 121.0, 62),
    seg(75.0, 121.0, 73.1, 116, 0.25, "B.Cu", 62),
    via(73.1, 116, 62),
    seg(73.1, 116, 73.1, 116, 0.25, "F.Cu", 62),
    seg(70.9, 116, 73.1, 116, 0.25, "F.Cu", 62),
    seg(73.1, 116, 73.1, 112, 0.25, "F.Cu", 62),
    seg(73.1, 112, 73.1, 112, 0.25, "F.Cu", 62),
    seg(67.1, 112, 70.9, 112, 0.25, "F.Cu", 62),
);

// Feedback network +5 ends are tied to the regulated output through B.Cu.
routes.push(
    seg(64.9, 112, 63.5, 112, 0.25, "F.Cu", 2),
    via(63.5, 112, 2),
    seg(70.9, 112, 69.5, 112, 0.25, "F.Cu", 2),
    via(69.5, 112, 2),
    seg(63.5, 112, 68, 140, 0.35, "B.Cu", 2),
    seg(69.5, 112, 68, 140, 0.35, "B.Cu", 2),
);

// BIAS pin 1 also returns to the regulated output on B.Cu.
routes.push(
    seg(75.55, 123.75, 74.0, 122.5, 0.3, "F.Cu", 2),
    via(74.0, 122.5, 2),
    seg(74.0, 122.5, 70, 140, 0.4, "B.Cu", 2),
);

// Compact switch node from pins 12-16 to the inductor input at y=135.
for (const x of [77.25, 77.75, 78.25, 78.75, 79.25])
    routes.push(seg(x, 129.45, 78, 132.5, 0.45, "F.Cu", 66));
routes.push(seg(78, 132.5, 78, 135, 1.6, "F.Cu", 66));

// Regulated output is primarily a front-layer copper pour.  Stitch a low-current
// branch back to the legacy +5V bus at the far right edge of the board.
routes.push(
    via(90, 141, 2, 1.2, 0.6),
    seg(90, 141, 126, 148.5, 1.2, "B.Cu", 2),
    seg(126, 148.5, 126, 92, 1.2, "B.Cu", 2),
    seg(126, 92, 42, 92, 1.2, "B.Cu", 2),
);

// Output ceramic ground returns.
routes.push(
    seg(100.5, 143, 100.5, 146, 0.5, "F.Cu", 3),
    via(100.5, 146, 3, 1.1, 0.55),
    seg(105.5, 143, 105.5, 146, 0.5, "F.Cu", 3),
    via(105.5, 146, 3, 1.1, 0.55),
);

// Servo signal escape down the left edge and filtered 5V branch in the extension.
routes.push(
    seg(8, 80, 5, 82, 0.25, "F.Cu", 15),
    via(5, 82, 15),
    seg(5, 82, 5, 145, 0.25, "B.Cu", 15),
    via(5, 145, 15),
    seg(5, 145, 6, 145, 0.25, "F.Cu", 15),
    via(16.2, 148.5, 2),
    seg(16.2, 148.5, 16.2, 145, 0.8, "F.Cu", 2),
    seg(19.8, 145, 25, 145, 0.8, "F.Cu", 64),
    seg(19.8, 145, 8.54, 145, 0.8, "F.Cu", 64),
);

// Ground the discrete protection and servo parts into the lower B.Cu plane.
for (const [x, y] of [
    [12, 118],
    [30.4, 126],
    [26.4, 134],
    [70.9, 116],
    [67.5, 132],
    [28.5, 145],
    [11.08, 145],
    [94.5, 144],
    [111, 147.2],
    [115.2, 147.2],
]) {
    routes.push(via(x, y, 3, 1.1, 0.55));
}

const graphics = [
    '(gr_rect (start 3 110) (end 127 152) (stroke (width 0.35) (type dash)) (fill none) (layer "F.SilkS"))',
    '(gr_text "36-42V PROTECTED POWER | LTC4367 + LT8645S | 5.1V / 8A" (at 65 111.2) (layer "F.SilkS") (effects (font (size 1.1 1.1) (thickness 0.22))))',
    '(gr_text "POWER SECTION - KEEP HALL/SENSOR WIRES ABOVE" (at 65 151.5) (layer "F.SilkS") (effects (font (size 0.85 0.85) (thickness 0.17))))',
];

const zones = [
    `(zone (net 3) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.35)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.4))
    (polygon (pts (xy 2 108) (xy 128 108) (xy 128 153) (xy 2 153)))
  )`,
    `(zone (net 2) (net_name "+5V") (layer "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.45)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.35) (thermal_bridge_width 0.6))
    (polygon (pts (xy 75 139.5) (xy 121 139.5) (xy 121 150.5) (xy 75 150.5)))
  )`,
];

const insertAt = board.indexOf("(zone");
board =
    board.slice(0, insertAt) +
    [...routes, ...graphics, ...zones].join("\n  ") +
    "\n  " +
    board.slice(insertAt);

fs.writeFileSync(boardPath, board);
fs.writeFileSync(
    encodedPath,
    zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n",
);
console.log(`clean-routed ${boardPath}`);
