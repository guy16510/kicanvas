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
            edits.push({
                start: cursor,
                end,
                text: pad.replace(/\(size\s+[-\d.]+\s+[-\d.]+\)/, `(size ${x} ${y})`),
            });
        }
        cursor = end;
    }
    for (const item of edits.reverse())
        block = block.slice(0, item.start) + item.text + block.slice(item.end);
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
function key(net, layer, x1, y1, x2, y2) {
    const a = `S|${net}|${layer}|${n(x1)},${n(y1)}|${n(x2)},${n(y2)}`;
    const b = `S|${net}|${layer}|${n(x2)},${n(y2)}|${n(x1)},${n(y1)}`;
    return a < b ? a : b;
}

// Keep the original electrically validated routes and remove only the hand-added
// U11 routes from the previous DRC refinement. This makes the change surgical.
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

// Remove the prior U11 +5V path exactly; leave the established +5V network alone.
const oldPower = new Set([
    key(2,"F.Cu",142.81,17.88,150,17.88),
    key(2,"F.Cu",150,17.88,150,7),
    key(2,"F.Cu",150,7,130,7),
    key(2,"F.Cu",130,7,130,17.88),
    key(2,"F.Cu",130,17.88,106,17.88),
    key(2,"F.Cu",142.81,17.88,143.9,15.5),
]);
for (const item of topLevelBlocks("segment").reverse()) {
    if (oldPower.has(segmentKey(item.text)))
        board = board.slice(0, item.start) + board.slice(item.end);
}

// U8/U9 were the only PhotoMOS parts touching the x=23.5 throttle run. Shift
// those two left by 1 mm; the large 1.8 mm PTH pads remain unchanged.
for (const [ref,y] of [["U8",62],["U9",68]]) {
    editFootprint(ref, (block) => block.replace(new RegExp(`\\(at\\s+19\\s+${y}\\)`), `(at 18 ${y})`));
}

// R53 missed clearance by only 0.0184 mm. Keep the 1206 body and reduce only its
// square hand-solder lands from 1.3 mm to 1.2 mm instead of rerouting SERVO_SIG.
editFootprint("R53", (block) => resizeSmdPads(block, 1.2, 1.2));

// Replace just the U8/U9 bridge stubs for their new x=18 mm centers.
for (const item of topLevelBlocks("segment").reverse()) {
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\).*?\(width\s+0\.35\)/s);
    if (!m) continue;
    const xs = [Number(m[1]), Number(m[3])];
    const ys = [Number(m[2]), Number(m[4])];
    const reverseY = [60.73,63.27,66.73,69.27];
    const oldStub = reverseY.some((y) => ys.every((actual) => Math.abs(actual-y) < 0.02)) &&
        xs.some((x) => [22.81,22.05,16.75,15.19].some((v) => Math.abs(x-v) < 0.02));
    if (oldStub) board = board.slice(0, item.start) + board.slice(item.end);
}
const photoRoutes = [
    segment(22.05,60.73,21.81,60.73,0.35,"F.Cu",41),
    segment(22.05,63.27,21.81,63.27,0.35,"F.Cu",3),
    segment(16.75,63.27,14.19,63.27,0.35,"F.Cu",42),
    segment(16.75,60.73,14.19,60.73,0.35,"F.Cu",76),
    segment(22.05,66.73,21.81,66.73,0.35,"F.Cu",44),
    segment(22.05,69.27,21.81,69.27,0.35,"F.Cu",3),
    segment(16.75,69.27,14.19,69.27,0.35,"F.Cu",45),
    segment(16.75,66.73,14.19,66.73,0.35,"F.Cu",77),
];

const routes = [
    // U11 +5V: stay on B.Cu above the crowded logic field and join the existing
    // +5V trunk at x=106,y=9. C28 gets a short local F.Cu connection.
    segment(142.81,17.88,148,17.88,0.45,"B.Cu",2),
    segment(148,17.88,148,5,0.45,"B.Cu",2),
    segment(148,5,106,5,0.45,"B.Cu",2),
    segment(106,5,106,9,0.45,"B.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // LEFT_TRIG input: B.Cu escape then approach the DNP signal pad horizontally
    // on F.Cu at y=10, avoiding its neighboring GND pad at y=11.
    segment(135.19,28.04,128.5,28.04,0.3,"B.Cu",16),
    segment(128.5,28.04,128.5,8,0.3,"B.Cu",16),
    segment(128.5,8,108,8,0.3,"B.Cu",16),
    via(108,8,16),
    segment(108,8,102.9,8,0.3,"F.Cu",16),
    segment(102.9,8,102.9,10,0.3,"F.Cu",16),

    // AUX_GPIO2: leave U11 briefly on B.Cu so it cannot collide with LEFT_TRIG,
    // then join the already-validated AUX via at 118,16 on F.Cu.
    segment(135.19,20.42,130,20.42,0.3,"B.Cu",17),
    via(130,20.42,17),
    segment(130,20.42,120,20.42,0.3,"F.Cu",17),
    segment(120,20.42,118,16,0.3,"F.Cu",17),

    // FRONT_TRIG input: B.Cu crosses the +3V3 trunks, a short F.Cu hop crosses
    // the AUX B.Cu trunk, then a y=38 dogleg avoids the output header at 112,40.
    segment(142.81,30.58,150,30.58,0.3,"B.Cu",21),
    segment(150,30.58,150,40,0.3,"B.Cu",21),
    segment(150,40,119.5,40,0.3,"B.Cu",21),
    via(119.5,40,21),
    segment(119.5,40,117.5,40,0.3,"F.Cu",21),
    via(117.5,40,21),
    segment(117.5,40,114.5,40,0.3,"B.Cu",21),
    via(114.5,40,21),
    segment(114.5,40,114.5,38,0.3,"F.Cu",21),
    segment(114.5,38,108,38,0.3,"F.Cu",21),
    segment(108,38,108,40,0.3,"F.Cu",21),
    segment(108,40,102.9,40,0.3,"F.Cu",21),

    // RIGHT_TRIG input mirrors the front channel and approaches its DNP signal
    // pad from y=44, avoiding the RIGHT_TRIG_5V header at 112,46.
    segment(142.81,22.96,152,22.96,0.3,"B.Cu",22),
    segment(152,22.96,152,46,0.3,"B.Cu",22),
    segment(152,46,119.5,46,0.3,"B.Cu",22),
    via(119.5,46,22),
    segment(119.5,46,117.5,46,0.3,"F.Cu",22),
    via(117.5,46,22),
    segment(117.5,46,114.5,46,0.3,"B.Cu",22),
    via(114.5,46,22),
    segment(114.5,46,114.5,44,0.3,"F.Cu",22),
    segment(114.5,44,108,44,0.3,"F.Cu",22),
    segment(108,44,108,46,0.3,"F.Cu",22),
    segment(108,46,102.9,46,0.3,"F.Cu",22),

    // LEFT_TRIG_5V: route above the logic field. This removes the old crossing
    // with LEFT_TRIG near x=130.5,y=28.04.
    segment(135.19,30.58,140,30.58,0.3,"B.Cu",71),
    segment(140,30.58,140,6,0.3,"B.Cu",71),
    segment(140,6,112,6,0.3,"B.Cu",71),
    segment(112,6,112,10,0.3,"B.Cu",71),

    // FRONT_TRIG_5V: cross AUX with a tiny F.Cu hop, then approach its PTH
    // header from y=42 so it never shares the front input's y=40 corridor.
    segment(142.81,33.12,154,33.12,0.3,"B.Cu",72),
    segment(154,33.12,154,42,0.3,"B.Cu",72),
    segment(154,42,119.5,42,0.3,"B.Cu",72),
    via(119.5,42,72),
    segment(119.5,42,117.5,42,0.3,"F.Cu",72),
    via(117.5,42,72),
    segment(117.5,42,112,42,0.3,"B.Cu",72),
    segment(112,42,112,40,0.3,"B.Cu",72),

    // RIGHT_TRIG_5V uses a separate y=50 corridor and the same AUX layer hop.
    segment(142.81,25.5,155,25.5,0.3,"B.Cu",73),
    segment(155,25.5,155,50,0.3,"B.Cu",73),
    segment(155,50,119.5,50,0.3,"B.Cu",73),
    via(119.5,50,73),
    segment(119.5,50,117.5,50,0.3,"F.Cu",73),
    via(117.5,50,73),
    segment(117.5,50,112,50,0.3,"B.Cu",73),
    segment(112,50,112,46,0.3,"B.Cu",73),

    // RGB output: head left below the +3V3 horizontal rail, descend on B.Cu,
    // hop the +5V horizontal trunk on F.Cu, and join the validated RGB trace.
    segment(135.19,22.96,110,22.96,0.35,"F.Cu",52),
    via(110,22.96,52),
    segment(110,22.96,110,90,0.35,"B.Cu",52),
    via(110,90,52),
    segment(110,90,110,106,0.35,"F.Cu",52),
    via(110,106,52),
    segment(110,106,90,106,0.35,"B.Cu",52),
    segment(90,106,90,105.5,0.35,"B.Cu",52),
    via(90,105.5,52),
    segment(90,105.5,88.9,105.5,0.35,"F.Cu",52),
];

insertBefore("(zone", [...photoRoutes, ...routes].join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 3");
console.log("- U8/U9 shifted 1 mm left; 1.8 mm PTH pads retained");
console.log("- R53 remains 1206 with 1.2 mm square lands");
console.log("- DNP trigger anchors are approached horizontally, not diagonally");
console.log("- U11 routes use explicit layer hops around +3V3, AUX, +5V, and output headers");
