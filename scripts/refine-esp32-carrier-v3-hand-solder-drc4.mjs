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

function segment(x1, y1, x2, y2, width, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}
function via(x, y, net, size = 0.9, drill = 0.45) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
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
function n(value) { return Number(value).toFixed(3); }
function key(net, layer, x1, y1, x2, y2) {
    const a = `S|${net}|${layer}|${n(x1)},${n(y1)}|${n(x2)},${n(y2)}`;
    const b = `S|${net}|${layer}|${n(x2)},${n(y2)}|${n(x1)},${n(y1)}`;
    return a < b ? a : b;
}
function segmentKey(text) {
    const m = text.match(/\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(layer\s+"([^"]+)"\)\s+\(net\s+(\d+)\)\)/);
    return m ? key(Number(m[6]),m[5],Number(m[1]),Number(m[2]),Number(m[3]),Number(m[4])) : null;
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
].map(([net,layer,x1,y1,x2,y2]) => key(net,layer,x1,y1,x2,y2));
const originalVias = [[16,83,10],[21,83,40],[22,83,46],[17,83,16],[17,118,16],[17,118,90]]
    .map(([net,x,y]) => `V|${net}|${n(x)},${n(y)}`);
const preserve = new Set([...originalSegments, ...originalVias]);
const targetNets = new Set([16,17,21,22,52,71,72,73]);
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (!targetNets.has(net)) continue;
        const itemKey = kind === "segment" ? segmentKey(item.text) : viaKey(item.text);
        if (preserve.has(itemKey)) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

const oldPower = new Set([
    key(2,"F.Cu",142.81,17.88,150,17.88), key(2,"F.Cu",150,17.88,150,7),
    key(2,"F.Cu",150,7,130,7), key(2,"F.Cu",130,7,130,17.88),
    key(2,"F.Cu",130,17.88,106,17.88), key(2,"F.Cu",142.81,17.88,143.9,15.5),
]);
for (const item of topLevelBlocks("segment").reverse()) {
    if (oldPower.has(segmentKey(item.text))) board = board.slice(0, item.start) + board.slice(item.end);
}

// Preserve the large DIP PhotoMOS placement. Instead of moving U8/U9 and breaking
// their validated contact wiring, jog the single B.Cu throttle trunk 2 mm right.
let throttleNet = null;
let throttleWidth = 0.35;
for (const item of topLevelBlocks("segment").reverse()) {
    const m = item.text.match(/\(start\s+23\.5\s+54\.5\)\s+\(end\s+23\.5\s+85\.5\)[\s\S]*?\(width\s+([-\d.]+)\)[\s\S]*?\(layer\s+"B\.Cu"\)\s+\(net\s+(\d+)\)/);
    const mr = item.text.match(/\(start\s+23\.5\s+85\.5\)\s+\(end\s+23\.5\s+54\.5\)[\s\S]*?\(width\s+([-\d.]+)\)[\s\S]*?\(layer\s+"B\.Cu"\)\s+\(net\s+(\d+)\)/);
    const hit = m ?? mr;
    if (!hit) continue;
    throttleWidth = Number(hit[1]);
    throttleNet = Number(hit[2]);
    board = board.slice(0, item.start) + board.slice(item.end);
    break;
}
if (throttleNet == null) throw new Error("L_THROTTLE_FILTERED trunk not found");
const throttleRoutes = [
    segment(23.5,54.5,25.5,56.5,throttleWidth,"B.Cu",throttleNet),
    segment(25.5,56.5,25.5,83.5,throttleWidth,"B.Cu",throttleNet),
    segment(25.5,83.5,23.5,85.5,throttleWidth,"B.Cu",throttleNet),
];

// R53 remains a physically large 1206; only its square copper lands are reduced
// 0.1 mm to clear the existing SERVO_SIG route.
editFootprint("R53", (block) => resizeSmdPads(block, 1.2, 1.2));

const routes = [
    // +5V joins the existing B.Cu trunk at 106,17.88. The F.Cu hop crosses only
    // the AUX B.Cu vertical, with vias kept 2.5 mm away from that trunk.
    segment(142.81,17.88,120.5,17.88,0.45,"B.Cu",2),
    via(120.5,17.88,2),
    segment(120.5,17.88,115.5,17.88,0.45,"F.Cu",2),
    via(115.5,17.88,2),
    segment(115.5,17.88,106,17.88,0.45,"B.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // LEFT_TRIG approaches the existing validated input trace from the LEFT.
    // This avoids C21 and all DNP-buffer GND/+5V pads.
    segment(135.19,28.04,138,28.04,0.3,"F.Cu",16),
    segment(138,28.04,138,14,0.3,"F.Cu",16),
    segment(138,14,98,14,0.3,"F.Cu",16),
    segment(98,14,98,10,0.3,"F.Cu",16),
    segment(98,10,102.9,10,0.3,"F.Cu",16),

    // AUX_GPIO2 stays below the +3V3 rail and joins its established via.
    segment(135.19,20.42,120,20.42,0.3,"F.Cu",17),
    segment(120,20.42,118,16,0.3,"F.Cu",17),

    // FRONT_TRIG: F.Cu outer escape; B.Cu crosses the x=126 +3V3 trunk; F.Cu
    // crosses AUX at x=118; B.Cu crosses x=116 +3V3; final F.Cu lane approaches
    // the original signal trace from x=98 instead of threading between C22 pads.
    segment(142.81,30.58,150,30.58,0.3,"F.Cu",21),
    segment(150,30.58,150,37,0.3,"F.Cu",21),
    segment(150,37,128.5,37,0.3,"F.Cu",21),
    via(128.5,37,21),
    segment(128.5,37,120.5,37,0.3,"B.Cu",21),
    via(120.5,37,21),
    segment(120.5,37,117,37,0.3,"F.Cu",21),
    via(117,37,21),
    segment(117,37,114,37,0.3,"B.Cu",21),
    via(114,37,21),
    segment(114,37,98,37,0.3,"F.Cu",21),
    segment(98,37,98,40,0.3,"F.Cu",21),
    segment(98,40,102.9,40,0.3,"F.Cu",21),

    // RIGHT_TRIG mirrors FRONT_TRIG on a y=48.5 lane, clear of C23 and the
    // validated RIGHT_TRIG_5V trace at y=47.
    segment(142.81,22.96,152,22.96,0.3,"F.Cu",22),
    segment(152,22.96,152,48.5,0.3,"F.Cu",22),
    segment(152,48.5,128.5,48.5,0.3,"F.Cu",22),
    via(128.5,48.5,22),
    segment(128.5,48.5,120.5,48.5,0.3,"B.Cu",22),
    via(120.5,48.5,22),
    segment(120.5,48.5,117,48.5,0.3,"F.Cu",22),
    via(117,48.5,22),
    segment(117,48.5,114,48.5,0.3,"B.Cu",22),
    via(114,48.5,22),
    segment(114,48.5,98,48.5,0.3,"F.Cu",22),
    segment(98,48.5,98,46,0.3,"F.Cu",22),
    segment(98,46,102.9,46,0.3,"F.Cu",22),

    // LEFT_TRIG_5V uses y=12, avoiding the H2 mounting hole and top keepout.
    segment(135.19,30.58,145,30.58,0.3,"B.Cu",71),
    segment(145,30.58,145,12,0.3,"B.Cu",71),
    segment(145,12,112,12,0.3,"B.Cu",71),
    segment(112,12,112,10,0.3,"B.Cu",71),

    // FRONT_TRIG_5V uses y=43.5, between the y=42 PTH row and C23 at y=45.
    // A single F.Cu hop crosses AUX; x=116 +3V3 is crossed back on B.Cu.
    segment(142.81,33.12,154,33.12,0.3,"B.Cu",72),
    segment(154,33.12,154,43.5,0.3,"B.Cu",72),
    segment(154,43.5,120.5,43.5,0.3,"B.Cu",72),
    via(120.5,43.5,72),
    segment(120.5,43.5,117,43.5,0.3,"F.Cu",72),
    via(117,43.5,72),
    segment(117,43.5,113,43.5,0.3,"B.Cu",72),
    segment(113,43.5,113,41,0.3,"B.Cu",72),
    segment(113,41,112,40,0.3,"B.Cu",72),

    // RIGHT_TRIG_5V keeps the previously-clear y=50 lane, with wider AUX-hop vias.
    segment(142.81,25.5,155,25.5,0.3,"B.Cu",73),
    segment(155,25.5,155,50,0.3,"B.Cu",73),
    segment(155,50,120.5,50,0.3,"B.Cu",73),
    via(120.5,50,73),
    segment(120.5,50,117,50,0.3,"F.Cu",73),
    via(117,50,73),
    segment(117,50,113,50,0.3,"B.Cu",73),
    segment(113,50,113,47,0.3,"B.Cu",73),
    segment(113,47,112,46,0.3,"B.Cu",73),

    // RGB_DATA_5V leaves the U11 pad to the left, negotiates +3V3/AUX at y=35.5,
    // descends at x=115 (outside the trigger-input lanes), hops AUX F.Cu at y=107.2,
    // then joins the original validated RGB trace at x=88.9 without approaching R43.
    segment(135.19,22.96,132,22.96,0.35,"F.Cu",52),
    segment(132,22.96,132,35.5,0.35,"F.Cu",52),
    segment(132,35.5,128,35.5,0.35,"F.Cu",52),
    via(128,35.5,52),
    segment(128,35.5,120.5,35.5,0.35,"B.Cu",52),
    via(120.5,35.5,52),
    segment(120.5,35.5,117,35.5,0.35,"F.Cu",52),
    via(117,35.5,52),
    segment(117,35.5,115,35.5,0.35,"B.Cu",52),
    via(115,35.5,52),
    segment(115,35.5,115,104.5,0.35,"F.Cu",52),
    via(115,104.5,52),
    segment(115,104.5,115,110,0.35,"B.Cu",52),
    via(115,110,52),
    segment(115,110,115,118,0.35,"F.Cu",52),
    segment(115,118,88,118,0.35,"F.Cu",52),
    via(88,118,52),
    segment(88,118,88,105.5,0.35,"B.Cu",52),
    via(88,105.5,52),
    segment(88,105.5,88.9,105.5,0.35,"F.Cu",52),
];

insertBefore("(zone", [...throttleRoutes, ...routes].join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 4");
console.log("- U8/U9 remain at validated x=19 DIP locations; throttle trunk jogs around them");
console.log("- R53 stays 1206 with 1.2 mm lands");
console.log("- trigger inputs join original traces from the left, away from DNP/capacitor pads");
console.log("- U11 routes avoid H2, y=42 PTH row, AUX, +3V3, and R43 using explicit lane/layer hops");
