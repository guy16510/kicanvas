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

// Remove only the hand-added routing for the three residual signal nets. Keep
// the original validated stubs/traces that lead to headers and RGB resistor.
const preserveSegments = new Set([
    key(71,"F.Cu",105.1,11,108,11), key(71,"F.Cu",108,11,112,10),
    key(72,"F.Cu",105.1,41,108,41), key(72,"F.Cu",108,41,112,40),
    key(52,"F.Cu",69.1,103.5,72,105.5), key(52,"F.Cu",72,105.5,88.9,105.5),
]);
const preserveVias = new Set();
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (![52,71,72].includes(net)) continue;
        const itemKey = kind === "segment" ? segmentKey(item.text) : viaKey(item.text);
        if ((kind === "segment" ? preserveSegments : preserveVias).has(itemKey)) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

// Remove refinement-4 +5V additions and the now-unused tap via at 106,17.88.
const old5 = new Set([
    key(2,"B.Cu",142.81,17.88,120.5,17.88),
    key(2,"F.Cu",120.5,17.88,115.5,17.88),
    key(2,"B.Cu",115.5,17.88,106,17.88),
    key(2,"F.Cu",142.81,17.88,143.9,15.5),
]);
for (const item of topLevelBlocks("segment").reverse()) {
    if (old5.has(segmentKey(item.text))) board = board.slice(0, item.start) + board.slice(item.end);
}
for (const item of topLevelBlocks("via").reverse()) {
    const k = viaKey(item.text);
    if ([`V|2|${n(120.5)},${n(17.88)}`, `V|2|${n(115.5)},${n(17.88)}`, `V|2|${n(106)},${n(17.88)}`].includes(k))
        board = board.slice(0, item.start) + board.slice(item.end);
}

const routes = [
    // +5V exits pad 14 outward, then crosses AUX B.Cu with a short F.Cu hop at
    // y=15. It joins the existing +5V B.Cu trunk directly at x=106,y=15.
    segment(142.81,17.88,148,17.88,0.45,"B.Cu",2),
    segment(148,17.88,148,15,0.45,"B.Cu",2),
    segment(148,15,120.5,15,0.45,"B.Cu",2),
    via(120.5,15,2),
    segment(120.5,15,115.5,15,0.45,"F.Cu",2),
    via(115.5,15,2),
    segment(115.5,15,106,15,0.45,"B.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // LEFT_TRIG_5V is on the left DIP row; exit LEFT, not across pad 9 on the
    // opposite row. B.Cu then runs above the logic field to the output header.
    segment(135.19,30.58,128.5,30.58,0.3,"B.Cu",71),
    segment(128.5,30.58,128.5,12,0.3,"B.Cu",71),
    segment(128.5,12,112,12,0.3,"B.Cu",71),
    segment(112,12,112,10,0.3,"B.Cu",71),

    // FRONT_TRIG_5V stays 3 mm below the y=42 PTH row. Cross AUX on F.Cu,
    // return to B.Cu after x=118, then join the existing net-72 trace on F.Cu
    // at y=41 without passing the GND via at x=110,y=45.
    segment(142.81,33.12,154,33.12,0.3,"B.Cu",72),
    segment(154,33.12,154,45,0.3,"B.Cu",72),
    segment(154,45,120.5,45,0.3,"B.Cu",72),
    via(120.5,45,72),
    segment(120.5,45,115.5,45,0.3,"F.Cu",72),
    via(115.5,45,72),
    segment(115.5,45,113.5,45,0.3,"B.Cu",72),
    via(113.5,45,72),
    segment(113.5,45,113.5,41,0.3,"F.Cu",72),
    segment(113.5,41,108,41,0.3,"F.Cu",72),

    // RGB exits the left DIP row to x=132. A small F.Cu vertical hop crosses
    // LEFT_TRIG_5V at y=30.58. From there B.Cu descends only to y=100, avoiding
    // J3V3/H4, then an F.Cu hop crosses the +5V B.Cu vertical at x=124.
    segment(135.19,22.96,132,22.96,0.35,"B.Cu",52),
    segment(132,22.96,132,28.5,0.35,"B.Cu",52),
    via(132,28.5,52),
    segment(132,28.5,132,33.5,0.35,"F.Cu",52),
    via(132,33.5,52),
    segment(132,33.5,132,100,0.35,"B.Cu",52),
    segment(132,100,126.5,100,0.35,"B.Cu",52),
    via(126.5,100,52),
    segment(126.5,100,121.5,100,0.35,"F.Cu",52),
    via(121.5,100,52),
    segment(121.5,100,88,100,0.35,"B.Cu",52),
    segment(88,100,88,105.5,0.35,"B.Cu",52),
    via(88,105.5,52),
    segment(88,105.5,88.9,105.5,0.35,"F.Cu",52),
];

insertBefore("(zone", routes.join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 5");
console.log("- zero-open topology from refinement 4 is preserved");
console.log("- +5V and LEFT_TRIG_5V escape away from opposite U11 DIP pads");
console.log("- FRONT_TRIG_5V clears the y=42 PTH row and x=110 GND via");
console.log("- RGB avoids J3V3, H4, +3V3 vertical copper, VIN_PROTECTED, and R43");
