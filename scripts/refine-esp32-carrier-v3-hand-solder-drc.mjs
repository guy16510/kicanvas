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

// Remove the previous U11 signal routing while preserving the original validated
// routes that end at the DNP anchors and trigger headers.
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (!targetNets.has(net)) continue;
        const key = kind === "segment" ? segmentKey(item.text) : viaKey(item.text);
        if (preserve.has(key)) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

// Remove first-pass U11 +5/C28 wiring. Keep the +5 via at 106,17.88 because it
// is a proven tap into the existing supply network.
for (const item of topLevelBlocks("segment").reverse()) {
    const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
    if (net !== 2) continue;
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)/);
    if (!m) continue;
    const points = [[Number(m[1]),Number(m[2])],[Number(m[3]),Number(m[4])]];
    if (points.some(([x,y]) => (Math.abs(x-142.81)<0.02 && Math.abs(y-17.88)<0.02) || (Math.abs(x-143.9)<0.02 && Math.abs(y-15.5)<0.02)))
        board = board.slice(0, item.start) + board.slice(item.end);
}

// The only two dense passive locations need slightly smaller copper. The parts
// remain 1206, which is the assembly benefit the user actually cares about.
for (const ref of ["R43", "R53"]) editFootprint(ref, (block) => resizeSmdPads(block, 1.3, 1.3));

// U4 is the one unavoidable fine-pitch package. Its original pad geometry was
// electrically clean; restoring it is safer than forcing extra toe copper into
// the OV/GND pair. Pin 1 remains visually distinctive from the prior transform.
editFootprint("U4", (block) => resizeSmdPads(block, 1.35, 0.45));

// Shift PhotoMOS centers right to x=19.0. The DIP rows still straddle the existing
// isolation keepout, while the left row now clears the enable-header holes.
for (const [ref,y] of Object.entries({U6:38,U7:44,U8:62,U9:68})) {
    editFootprint(ref, (block) => block.replace(/\(at\s+17\.5\s+[-\d.]+\)/, `(at 19 ${y})`));
}

// Remove obsolete nearby silk labels that physically land on the larger DIP pads.
// Wiring/assembly documentation remains the authoritative connector map.
for (const item of topLevelBlocks("gr_text").reverse()) {
    if (!/(R BRK EN|L BRK EN|R REV EN|L REV EN|R GND|L GND)/.test(item.text)) continue;
    board = board.slice(0, item.start) + board.slice(item.end);
}

// Widen only the unfilled outer routing corridor. U11/C28 and the GND pours remain
// in x<=148, leaving x=149..155 as a clean two-layer bypass channel.
board = board.replace(
    /(\(gr_rect\s+\(start\s+1\s+1\)\s+\(end\s+)149(\s+190\)[\s\S]*?\(layer\s+"Edge\.Cuts"\)\))/,
    "$1156$2",
);

// Remove PhotoMOS bridge traces generated for the old x=17.5 centers.
for (const item of topLevelBlocks("segment").reverse()) {
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\).*?\(width\s+0\.35\)/s);
    if (!m) continue;
    const xs = [Number(m[1]), Number(m[3])];
    const ys = [Number(m[2]), Number(m[4])];
    const photoY = [36.73,39.27,42.73,45.27,60.73,63.27,66.73,69.27];
    const oldPhotoBridge = photoY.some((y) => ys.every((actual) => Math.abs(actual-y)<0.02)) &&
        xs.some((x) => Math.abs(x-21.31)<0.02 || Math.abs(x-13.69)<0.02);
    if (oldPhotoBridge) board = board.slice(0, item.start) + board.slice(item.end);
}

const photoNets = {U6:[33,3,34,74],U7:[36,3,37,75],U8:[41,3,42,76],U9:[44,3,45,77]};
const photoRoutes = [];
for (const [ref,y] of Object.entries({U6:38,U7:44,U8:62,U9:68})) {
    const nets = photoNets[ref];
    photoRoutes.push(segment(22.05,y-1.27,22.81,y-1.27,0.35,"F.Cu",nets[0]));
    photoRoutes.push(segment(22.05,y+1.27,22.81,y+1.27,0.35,"F.Cu",nets[1]));
    photoRoutes.push(segment(16.75,y+1.27,15.19,y+1.27,0.35,"F.Cu",nets[2]));
    photoRoutes.push(segment(16.75,y-1.27,15.19,y-1.27,0.35,"F.Cu",nets[3]));
}

const routes = [
    // U11 +5V, route above and around the package so it never crosses GND pin 1.
    segment(142.81,17.88,150,17.88,0.45,"F.Cu",2),
    segment(150,17.88,150,7,0.45,"F.Cu",2),
    segment(150,7,130,7,0.45,"F.Cu",2),
    segment(130,7,130,17.88,0.45,"F.Cu",2),
    segment(130,17.88,106,17.88,0.45,"F.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // LEFT_TRIG input: short B.Cu escape, then F.Cu into the original anchor.
    segment(135.19,28.04,128.5,28.04,0.3,"B.Cu",16),
    segment(128.5,28.04,128.5,14,0.3,"B.Cu",16),
    via(128.5,14,16),
    segment(128.5,14,106,14,0.3,"F.Cu",16),
    segment(106,14,102.9,10,0.3,"F.Cu",16),

    // AUX_GPIO2 input stays on front copper and joins the existing via at 118,16.
    segment(135.19,20.42,132,20.42,0.3,"F.Cu",17),
    segment(132,20.42,132,24,0.3,"F.Cu",17),
    segment(132,24,120,24,0.3,"F.Cu",17),
    segment(120,24,120,18,0.3,"F.Cu",17),
    segment(120,18,118,16,0.3,"F.Cu",17),

    // FRONT_TRIG input, F.Cu lane centered between the y=34 and y=40 headers.
    segment(142.81,30.58,145,30.58,0.3,"F.Cu",21),
    segment(145,30.58,145,37,0.3,"F.Cu",21),
    segment(145,37,109,37,0.3,"F.Cu",21),
    segment(109,37,104.5,38.5,0.3,"F.Cu",21),
    segment(104.5,38.5,102.9,40,0.3,"F.Cu",21),

    // RIGHT_TRIG input, F.Cu lane centered between the y=46 and y=52 headers.
    segment(142.81,22.96,147,22.96,0.3,"F.Cu",22),
    segment(147,22.96,147,49,0.3,"F.Cu",22),
    segment(147,49,109,49,0.3,"F.Cu",22),
    segment(109,49,104.5,47.5,0.3,"F.Cu",22),
    segment(104.5,47.5,102.9,46,0.3,"F.Cu",22),

    // Level-shifted trigger outputs use back copper and terminate at PTH headers.
    segment(135.19,30.58,130.5,30.58,0.3,"B.Cu",71),
    segment(130.5,30.58,130.5,12,0.3,"B.Cu",71),
    segment(130.5,12,116,12,0.3,"B.Cu",71),
    segment(116,12,112,10,0.3,"B.Cu",71),

    segment(142.81,33.12,146,33.12,0.3,"B.Cu",72),
    segment(146,33.12,146,37,0.3,"B.Cu",72),
    segment(146,37,116,37,0.3,"B.Cu",72),
    segment(116,37,112,40,0.3,"B.Cu",72),

    segment(142.81,25.5,147.5,25.5,0.3,"B.Cu",73),
    segment(147.5,25.5,147.5,49,0.3,"B.Cu",73),
    segment(147.5,49,116,49,0.3,"B.Cu",73),
    segment(116,49,112,46,0.3,"B.Cu",73),

    // RGB output takes the unfilled outer B.Cu bypass corridor, drops below the
    // top ground pour, then joins the existing F.Cu RGB_DATA_5V trace at x=85.
    segment(135.19,22.96,138.5,22.96,0.35,"B.Cu",52),
    segment(138.5,22.96,138.5,9.5,0.35,"B.Cu",52),
    segment(138.5,9.5,153,9.5,0.35,"B.Cu",52),
    segment(153,9.5,153,106.5,0.35,"B.Cu",52),
    segment(153,106.5,85,106.5,0.35,"B.Cu",52),
    segment(85,106.5,85,105.5,0.35,"B.Cu",52),
    via(85,105.5,52),
];

insertBefore("(zone", [...photoRoutes, ...routes].join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("refined hand-solder layout after native DRC feedback");
console.log("- U11 power route goes around package, not through GND pin 1");
console.log("- trigger inputs/outputs are separated by copper layer");
console.log("- RGB uses a dedicated outer bypass corridor");
console.log("- PhotoMOS DIP rows clear enable-header holes");
console.log("- R43/R53 use compact 1206 lands, U4 restores validated fine-pitch pads");
