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

// Rebuild only FRONT_TRIG_5V and RGB_DATA_5V. Their original validated output
// stubs stay as branch targets.
const preserve = new Set([
    key(72,"F.Cu",105.1,41,108,41), key(72,"F.Cu",108,41,112,40),
    key(52,"F.Cu",69.1,103.5,72,105.5), key(52,"F.Cu",72,105.5,88.9,105.5),
]);
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (![52,72].includes(net)) continue;
        if (kind === "segment" && preserve.has(segmentKey(item.text))) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

// Replace only refinement-5 +5V escape geometry. This moves its AUX crossing to
// F.Cu across x=128.5, eliminating the LEFT_TRIG_5V B.Cu intersection.
const old5 = new Set([
    key(2,"B.Cu",142.81,17.88,148,17.88), key(2,"B.Cu",148,17.88,148,15),
    key(2,"B.Cu",148,15,120.5,15), key(2,"F.Cu",120.5,15,115.5,15),
    key(2,"B.Cu",115.5,15,106,15), key(2,"F.Cu",142.81,17.88,143.9,15.5),
]);
for (const item of topLevelBlocks("segment").reverse()) {
    if (old5.has(segmentKey(item.text))) board = board.slice(0, item.start) + board.slice(item.end);
}
for (const item of topLevelBlocks("via").reverse()) {
    const k = viaKey(item.text);
    if ([`V|2|${n(120.5)},${n(15)}`, `V|2|${n(115.5)},${n(15)}`].includes(k))
        board = board.slice(0, item.start) + board.slice(item.end);
}

const routes = [
    // +5V: B.Cu only on the far right and far left; the long y=15 crossing is
    // F.Cu, so it passes LEFT_TRIG_5V and AUX B.Cu without touching either.
    segment(142.81,17.88,148,17.88,0.45,"B.Cu",2),
    segment(148,17.88,148,15,0.45,"B.Cu",2),
    segment(148,15,134,15,0.45,"B.Cu",2),
    via(134,15,2),
    segment(134,15,115.5,15,0.45,"F.Cu",2),
    via(115.5,15,2),
    segment(115.5,15,106,15,0.45,"B.Cu",2),
    segment(142.81,17.88,143.9,15.5,0.35,"F.Cu",2),

    // FRONT_TRIG_5V: y=45 stays clear of the y=42 PTH row. The F.Cu AUX hop
    // stops at x=117 (before the x=116 +3V3 rail); B.Cu crosses that rail, and
    // a via at 114,43 is safely away from the RIGHT_TRIG_5V header at 112,46.
    segment(142.81,33.12,154,33.12,0.3,"B.Cu",72),
    segment(154,33.12,154,45,0.3,"B.Cu",72),
    segment(154,45,120.5,45,0.3,"B.Cu",72),
    via(120.5,45,72),
    segment(120.5,45,117,45,0.3,"F.Cu",72),
    via(117,45,72),
    segment(117,45,114,45,0.3,"B.Cu",72),
    segment(114,45,114,43,0.3,"B.Cu",72),
    via(114,43,72),
    segment(114,43,112,40,0.3,"F.Cu",72),

    // RGB: use F.Cu for the long descent so it cannot intersect the B.Cu trigger
    // outputs. A short B.Cu hop from y=35 to 42.5 crosses FRONT_TRIG's F.Cu lane.
    // Near RIGHT_TRIG, the F.Cu path steps 1 mm left of its x=128.5 endpoint,
    // then returns to x=129 below it. The final approach at x=85 avoids J_RGB_5V.
    segment(135.19,22.96,129,22.96,0.35,"F.Cu",52),
    segment(129,22.96,129,35,0.35,"F.Cu",52),
    via(129,35,52),
    segment(129,35,129,42.5,0.35,"B.Cu",52),
    via(129,42.5,52),
    segment(129,42.5,129,47,0.35,"F.Cu",52),
    segment(129,47,127.5,47,0.35,"F.Cu",52),
    segment(127.5,47,127.5,50.5,0.35,"F.Cu",52),
    segment(127.5,50.5,129,52,0.35,"F.Cu",52),
    segment(129,52,129,100,0.35,"F.Cu",52),
    segment(129,100,85,100,0.35,"F.Cu",52),
    segment(85,100,85,105.5,0.35,"F.Cu",52),
    segment(85,105.5,88.9,105.5,0.35,"F.Cu",52),
];

insertBefore("(zone", routes.join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 6");
console.log("- +5V crosses LEFT_TRIG_5V/AUX on F.Cu at y=15");
console.log("- FRONT_TRIG_5V avoids +3V3 and the RIGHT_TRIG_5V PTH header");
console.log("- RGB long route is on F.Cu and approaches R43 from x=85, clear of J_RGB_5V");
console.log("- zero-open topology and all hand-solder package geometry are unchanged");
