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

// The remaining native-DCR set is exclusively RGB_DATA_5V. Keep the two
// original validated net-52 stubs and replace every hand-added RGB route.
const preserve = new Set([
    key(52,"F.Cu",69.1,103.5,72,105.5),
    key(52,"F.Cu",72,105.5,88.9,105.5),
]);
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (net !== 52) continue;
        if (kind === "segment" && preserve.has(segmentKey(item.text))) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

const routes = [
    // Exit U11 on F.Cu, then use B.Cu to pass through the FRONT_TRIG input lane.
    segment(135.19,22.96,132,22.96,0.35,"F.Cu",52),
    segment(132,22.96,132,35,0.35,"F.Cu",52),
    via(132,35,52),
    segment(132,35,132,43.5,0.35,"B.Cu",52),

    // FRONT_TRIG_5V is B.Cu at y=45, so hop to F.Cu before it. RIGHT_TRIG is
    // F.Cu at y=48.5, so hop back to B.Cu before that. The final compact 0.8 mm
    // via is centered midway between RIGHT_TRIG (F y=48.5) and RIGHT_TRIG_5V
    // (B y=50), giving the required 0.20 mm copper clearance to both lanes.
    via(132,43.5,52,0.8,0.4),
    segment(132,43.5,132,47,0.35,"F.Cu",52),
    via(132,47,52,0.8,0.4),
    segment(132,47,132,49.25,0.35,"B.Cu",52),
    via(132,49.25,52,0.8,0.4),
    segment(132,49.25,132,100,0.35,"F.Cu",52),

    // At y=100, cross the existing +5V B.Cu trunk with a short F.Cu hop only.
    // AUX B.Cu ends at y=90, so the long middle section can safely return to B.Cu.
    via(132,100,52),
    segment(132,100,126.5,100,0.35,"B.Cu",52),
    via(126.5,100,52),
    segment(126.5,100,121.5,100,0.35,"F.Cu",52),
    via(121.5,100,52),
    segment(121.5,100,92,100,0.35,"B.Cu",52),

    // Approach R43 from below-left on B.Cu. This passes the J_RGB_5V vertical
    // only after that +5V track ends at y=103. Transition to F.Cu above the AUX
    // y=107.2 trace, then land directly on R43 pad 1 at 88.9,105.5.
    segment(92,100,87,106,0.35,"B.Cu",52),
    via(87,106,52),
    segment(87,106,88.9,105.5,0.35,"F.Cu",52),
];

insertBefore("(zone", routes.join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 7");
console.log("- only RGB_DATA_5V routing changed; package geometry and other nets are untouched");
console.log("- RGB alternates layers through the four trigger lanes with 0.8 mm mid-lane vias");
console.log("- y=100 +5V crossing uses a local F.Cu hop; long middle route stays on B.Cu");
console.log("- R43 is approached above AUX and after the J_RGB_5V +5V vertical ends");
