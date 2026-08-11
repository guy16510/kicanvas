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
function n(v) { return Number(v).toFixed(3); }
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

const removeSegments = new Set([
    `S|52|B.Cu|${n(87)},${n(106)}|${n(92)},${n(100)}`,
    `S|52|F.Cu|${n(87)},${n(106)}|${n(88.9)},${n(105.5)}`,
]);
for (const item of topLevelBlocks("segment").reverse()) {
    if (removeSegments.has(segmentKey(item.text)))
        board = board.slice(0, item.start) + board.slice(item.end);
}
for (const item of topLevelBlocks("via").reverse()) {
    if (viaKey(item.text) === `V|52|${n(87)},${n(106)}`)
        board = board.slice(0, item.start) + board.slice(item.end);
}

const replacement = [
    // Stay 4 mm right of J_RGB_5V while descending, then turn left at y=105.5.
    // The connector's +5V PTH is at (88,103), so this horizontal is 2.5 mm
    // below its center and comfortably outside copper/mask/hole clearance.
    segment(92,100,92,105.5,0.35,"B.Cu",52),
    segment(92,105.5,87,105.5,0.35,"B.Cu",52),
    via(87,105.5,52),
    segment(87,105.5,88.9,105.5,0.35,"F.Cu",52),
];
insertBefore("(zone", replacement.join("\n  "));
fs.writeFileSync(BOARD, board);

console.log("applied exact native-DRC hand-solder refinement 8");
console.log("- replaces only the final RGB diagonal that clipped J_RGB_5V +5V pad");
console.log("- RGB now approaches R43 horizontally at y=105.5 with 2.5 mm connector-pad separation");
console.log("- all package sizes, through-hole pads, thermals, and other nets remain unchanged");
