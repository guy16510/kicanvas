import fs from "node:fs";

const BOARD = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
let board = fs.readFileSync(BOARD, "utf8");

function endOfBlock(source, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
        const c = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === "(") depth += 1;
        else if (c === ")" && --depth === 0) return i + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function topLevelBlocks(kind) {
    const out = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < board.length; i += 1) {
        const c = board[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === "(") {
            if (depth === 1 && board.startsWith(`(${kind}`, i)) {
                const end = endOfBlock(board, i);
                out.push({ start: i, end, text: board.slice(i, end) });
                i = end - 1;
                continue;
            }
            depth += 1;
        } else if (c === ")") depth -= 1;
    }
    return out;
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
    board = board.slice(0, start) + edit(board.slice(start, end)) + board.slice(end);
}

function resizeSmdPads(block, x, y) {
    let cursor = 0;
    const edits = [];
    while ((cursor = block.indexOf("(pad", cursor)) >= 0) {
        const end = endOfBlock(block, cursor);
        const pad = block.slice(cursor, end);
        if (/\bsmd\b/.test(pad)) {
            edits.push({ start: cursor, end, text: pad.replace(/\(size\s+[-\d.]+\s+[-\d.]+\)/, `(size ${x} ${y})`) });
        }
        cursor = end;
    }
    for (const item of edits.reverse()) block = block.slice(0, item.start) + item.text + block.slice(item.end);
    return block;
}

function topLevelIndex(token) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < board.length; i += 1) {
        const c = board[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === "(") {
            if (depth === 1 && board.startsWith(token, i)) return i;
            depth += 1;
        } else if (c === ")") depth -= 1;
    }
    return -1;
}

function insertBefore(token, text) {
    const at = topLevelIndex(token);
    if (at < 0) throw new Error(`top-level insertion token not found: ${token}`);
    board = board.slice(0, at) + text + "\n  " + board.slice(at);
}

function segment(x1, y1, x2, y2, width, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}
function via(x, y, net, size = 0.9, drill = 0.45) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}
function n(value) { return Number(value).toFixed(3); }
function segmentKey(text) {
    const m = text.match(/\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(layer\s+"([^"]+)"\)\s+\(net\s+(\d+)\)\)/);
    if (!m) return null;
    const a = `S|${m[6]}|${m[5]}|${n(m[1])},${n(m[2])}|${n(m[3])},${n(m[4])}`;
    const b = `S|${m[6]}|${m[5]}|${n(m[3])},${n(m[4])}|${n(m[1])},${n(m[2])}`;
    return a < b ? a : b;
}
function viaKey(text) {
    const m = text.match(/\(via\s+\(at\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(net\s+(\d+)\)\)/);
    return m ? `V|${m[3]}|${n(m[1])},${n(m[2])}` : null;
}

const originalSegments = [
    [16,"B.Cu",75.4,30.08,79.4,30.08],[16,"B.Cu",79.4,30.08,83,10],[16,"F.Cu",83,10,102.9,10],
    [21,"B.Cu",75.4,42.78,79.4,42.78],[21,"B.Cu",79.4,42.78,83,40],[21,"F.Cu",83,40,102.9,40],
    [22,"B.Cu",75.4,45.32,79.4,45.32],[22,"B.Cu",79.4,45.32,83,46],[22,"F.Cu",83,46,102.9,46],
    [17,"B.Cu",75.4,32.62,79.4,32.62],[17,"B.Cu",79.4,32.62,83,16],[17,"F.Cu",83,16,118,16],
    [17,"B.Cu",118,16,118,90],[17,"F.Cu",118,90,118,107.2],[17,"F.Cu",118,107.2,64,107.2],
    [17,"F.Cu",64,107.2,64,102.5],[17,"F.Cu",64,102.5,66.9,102.5],
    [71,"F.Cu",105.1,11,108,11],[71,"F.Cu",108,11,112,10],
    [72,"F.Cu",105.1,41,108,41],[72,"F.Cu",108,41,112,40],
    [73,"F.Cu",105.1,47,108,47],[73,"F.Cu",108,47,112,46],
    [52,"F.Cu",69.1,103.5,72,105.5],[52,"F.Cu",72,105.5,88.9,105.5],
].map(([net,layer,x1,y1,x2,y2]) => {
    const a = `S|${net}|${layer}|${n(x1)},${n(y1)}|${n(x2)},${n(y2)}`;
    const b = `S|${net}|${layer}|${n(x2)},${n(y2)}|${n(x1)},${n(y1)}`;
    return a < b ? a : b;
});
const originalVias = [[16,83,10],[21,83,40],[22,83,46],[17,83,16],[17,118,16],[17,118,90]]
    .map(([net,x,y]) => `V|${net}|${n(x)},${n(y)}`);
const preserve = new Set([...originalSegments, ...originalVias]);
const targetNets = new Set([16,17,21,22,52,71,72,73]);

// Start this pass from the proven original routes. Everything injected for U11
// in prior refinement passes is removed and then rebuilt around the measured
// +3V3/AUX/+5 obstacle columns.
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (!targetNets.has(net)) continue;
        const key = kind === "segment" ? segmentKey(item.text) : viaKey(item.text);
        if (preserve.has(key)) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

// Remove prior U11 +5 branches and the temporary +5 tap at 106,17.88. The new
// route terminates at the existing validated +5 via at 106,9.
for (const item of topLevelBlocks("segment").reverse()) {
    const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
    if (net !== 2) continue;
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)/);
    if (!m) continue;
    const points = [[Number(m[1]),Number(m[2])],[Number(m[3]),Number(m[4])]];
    const injected = points.some(([x,y]) => x > 129 || (Math.abs(x-106)<0.02 && Math.abs(y-17.88)<0.02) || (Math.abs(x-130)<0.02 && (Math.abs(y-7)<0.02 || Math.abs(y-17.88)<0.02)) || (Math.abs(x-143.9)<0.02 && Math.abs(y-15.5)<0.02));
    if (injected) board = board.slice(0, item.start) + board.slice(item.end);
}
for (const item of topLevelBlocks("via").reverse()) {
    if (viaKey(item.text) === `V|2|${n(106)},${n(17.88)}`) board = board.slice(0, item.start) + board.slice(item.end);
}

// R53 remains a large 1206, but move it away from the diagonal servo trace rather
// than shrinking its hand-solder lands. Pad 1 reconnects to the old route endpoint.
editFootprint("R53", (block) => {
    block = block.replace(/\(at\s+48\s+66(?:\s+0)?\)/, "(at 45 69 0)");
    return resizeSmdPads(block, 1.5, 1.5);
});

// The two reverse PhotoMOS devices sit beside the long B.Cu throttle-filter run
// at x=23.5. Shift only those two left by 1 mm, enough to clear both the track
// and their enable headers while retaining the isolation keepout between pin rows.
for (const [ref,y] of [["U8",62],["U9",68]])
    editFootprint(ref, (block) => block.replace(new RegExp(`\\(at\\s+19\\s+${y}\\)`), `(at 18 ${y})`));

// Remove the old U8/U9 bridge stubs before rebuilding them for the shifted DIP rows.
for (const item of topLevelBlocks("segment").reverse()) {
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\).*?\(width\s+0\.35\)/s);
    if (!m) continue;
    const xs = [Number(m[1]),Number(m[3])];
    const ys = [Number(m[2]),Number(m[4])];
    const reverseY = [60.73,63.27,66.73,69.27];
    const oldBridge = reverseY.some((y) => ys.every((actual) => Math.abs(actual-y)<0.02)) &&
        xs.some((x) => [22.81,15.19,22.05,16.75].some((expected) => Math.abs(x-expected)<0.02));
    if (oldBridge) board = board.slice(0, item.start) + board.slice(item.end);
}

// Fill the whole routing bay with GND instead of crossing a raw zone boundary.
// KiCad refill clears the signal corridors around these tracks and vias.
board = board.replaceAll("(xy 148 2) (xy 148 98)", "(xy 155 2) (xy 155 98)");
board = board.replaceAll("(xy 148 108) (xy 148 189)", "(xy 155 108) (xy 155 189)");

const routes = [
    // R53 pull-down relocation.
    segment(46.9,66,43.9,69,0.28,"F.Cu",15),

    // Shifted U8/U9 PhotoMOS bridges.
    segment(22.05,60.73,21.81,60.73,0.35,"F.Cu",41),
    segment(22.05,63.27,21.81,63.27,0.35,"F.Cu",3),
    segment(16.75,63.27,14.19,63.27,0.35,"F.Cu",42),
    segment(16.75,60.73,14.19,60.73,0.35,"F.Cu",76),
    segment(22.05,66.73,21.81,66.73,0.35,"F.Cu",44),
    segment(22.05,69.27,21.81,69.27,0.35,"F.Cu",3),
    segment(16.75,69.27,14.19,69.27,0.35,"F.Cu",45),
    segment(16.75,66.73,14.19,66.73,0.35,"F.Cu",77),

    // U11 +5V. Go above the logic bay and terminate at the existing +5 via at 106,9.
    segment(142.81,17.88,150.5,17.88,0.45,"F.Cu",2),
    segment(150.5,17.88,150.5,7,0.45,"F.Cu",2),
    segment(150.5,7,106,7,0.45,"F.Cu",2),
    segment(106,7,106,9,0.45,"F.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // AUX_GPIO2 input simply joins its existing same-net B.Cu spine at x=118.
    segment(135.19,20.42,118,20.42,0.30,"B.Cu",17),

    // LEFT_TRIG input. F/B/F/B slalom crosses +3V3(x126 F), AUX(x118 B),
    // +3V3(x116 F), and +5V(x106 B), then joins the original via at 83,10.
    segment(135.19,28.04,130,28.04,0.30,"F.Cu",16),
    segment(130,28.04,130,23,0.30,"F.Cu",16),
    segment(130,23,128,23,0.30,"F.Cu",16), via(128,23,16),
    segment(128,23,120,23,0.30,"B.Cu",16), via(120,23,16),
    segment(120,23,117,23,0.30,"F.Cu",16), via(117,23,16),
    segment(117,23,108,23,0.30,"B.Cu",16), via(108,23,16),
    segment(108,23,104,23,0.30,"F.Cu",16), via(104,23,16),
    segment(104,23,90,23,0.30,"B.Cu",16),
    segment(90,23,90,10,0.30,"B.Cu",16),
    segment(90,10,83,10,0.30,"B.Cu",16),

    // FRONT_TRIG input, same obstacle slalom on a separate lane.
    segment(142.81,30.58,151,30.58,0.30,"F.Cu",21),
    segment(151,30.58,151,35,0.30,"F.Cu",21), via(151,35,21),
    segment(151,35,120,35,0.30,"B.Cu",21), via(120,35,21),
    segment(120,35,117,35,0.30,"F.Cu",21), via(117,35,21),
    segment(117,35,108,35,0.30,"B.Cu",21), via(108,35,21),
    segment(108,35,104,35,0.30,"F.Cu",21), via(104,35,21),
    segment(104,35,90,35,0.30,"B.Cu",21),
    segment(90,35,90,40,0.30,"B.Cu",21),
    segment(90,40,83,40,0.30,"B.Cu",21),

    // RIGHT_TRIG input uses the outer front-copper lane before entering the same slalom.
    segment(142.81,22.96,154,22.96,0.30,"F.Cu",22),
    segment(154,22.96,154,50,0.30,"F.Cu",22), via(154,50,22),
    segment(154,50,120,50,0.30,"B.Cu",22), via(120,50,22),
    segment(120,50,117,50,0.30,"F.Cu",22), via(117,50,22),
    segment(117,50,108,50,0.30,"B.Cu",22), via(108,50,22),
    segment(108,50,104,50,0.30,"F.Cu",22), via(104,50,22),
    segment(104,50,90,50,0.30,"B.Cu",22),
    segment(90,50,90,46,0.30,"B.Cu",22),
    segment(90,46,83,46,0.30,"B.Cu",22),

    // LEFT_TRIG_5V stays on B.Cu at y=14, below the AUX B.Cu spine start at y=16.
    segment(135.19,30.58,132,30.58,0.30,"B.Cu",71),
    segment(132,30.58,132,14,0.30,"B.Cu",71),
    segment(132,14,112,14,0.30,"B.Cu",71),
    segment(112,14,112,10,0.30,"B.Cu",71),

    // FRONT_TRIG_5V crosses AUX on a 3 mm F.Cu bridge, then returns to B.Cu.
    segment(142.81,33.12,140,33.12,0.30,"B.Cu",72),
    segment(140,33.12,140,36,0.30,"B.Cu",72),
    segment(140,36,120,36,0.30,"B.Cu",72), via(120,36,72),
    segment(120,36,117,36,0.30,"F.Cu",72), via(117,36,72),
    segment(117,36,113,36,0.30,"B.Cu",72),
    segment(113,36,113,38.5,0.30,"B.Cu",72),
    segment(113,38.5,112,40,0.30,"B.Cu",72),

    // RIGHT_TRIG_5V uses the same short AUX crossing, then a separate B.Cu column.
    segment(142.81,25.5,120,25.5,0.30,"B.Cu",73), via(120,25.5,73),
    segment(120,25.5,117,25.5,0.30,"F.Cu",73), via(117,25.5,73),
    segment(117,25.5,115,25.5,0.30,"B.Cu",73),
    segment(115,25.5,115,44,0.30,"B.Cu",73),
    segment(115,44,112,46,0.30,"B.Cu",73),

    // RGB output goes around the package above it, down the outer F.Cu lane,
    // then below the AUX vertical endpoint before joining R43 pad 1.
    segment(135.19,22.96,132,22.96,0.35,"F.Cu",52),
    segment(132,22.96,132,12,0.35,"F.Cu",52),
    segment(132,12,152.5,12,0.35,"F.Cu",52),
    segment(152.5,12,152.5,109,0.35,"F.Cu",52),
    segment(152.5,109,88.9,109,0.35,"F.Cu",52),
    segment(88.9,109,88.9,105.5,0.35,"F.Cu",52),
];
insertBefore("(zone", routes.join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied second native-DRC hand-solder refinement");
console.log("- routes explicitly slalom +3V3/AUX/+3V3/+5V obstacle columns");
console.log("- RGB and +5 use separate outer/front-copper corridors");
console.log("- U8/U9 clear the long L_THROTTLE_FILTERED B.Cu run");
console.log("- R53 stays 1206 and is relocated instead of shrunk");
console.log("- GND pours cover the full hand-solder bay for refill-safe crossings");
