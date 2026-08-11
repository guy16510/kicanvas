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
        if (c === '"') {
            inString = true;
            continue;
        }
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
        if (c === '"') {
            inString = true;
            continue;
        }
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

function editPad(block, number, edit) {
    const marker = `(pad "${number}"`;
    const start = block.indexOf(marker);
    if (start < 0) throw new Error(`pad ${number} not found`);
    const end = endOfBlock(block, start);
    return block.slice(0, start) + edit(block.slice(start, end)) + block.slice(end);
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

function resizeThroughHolePads(block, size, drill) {
    let cursor = 0;
    const edits = [];
    while ((cursor = block.indexOf("(pad", cursor)) >= 0) {
        const end = endOfBlock(block, cursor);
        let pad = block.slice(cursor, end);
        if (/\bthru_hole\b/.test(pad)) {
            pad = pad.replace(/\(size\s+[-\d.]+\s+[-\d.]+\)/, `(size ${size} ${size})`);
            pad = pad.replace(/\(drill\s+[-\d.]+\)/, `(drill ${drill})`);
            edits.push({ start: cursor, end, text: pad });
        }
        cursor = end;
    }
    for (const item of edits.reverse())
        block = block.slice(0, item.start) + item.text + block.slice(item.end);
    return block;
}

function hideReference(block) {
    const marker = '(property "Reference"';
    const start = block.indexOf(marker);
    if (start < 0) return block;
    const end = endOfBlock(block, start);
    let property = block.slice(start, end);
    if (!/\)\s*hide\)$/.test(property)) property = `${property.slice(0, -1)} hide)`;
    return block.slice(0, start) + property + block.slice(end);
}

function removeDirectChildren(block, prefixes) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    const removals = [];
    for (let i = 0; i < block.length; i += 1) {
        const c = block[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "(") {
            if (depth === 1 && prefixes.some((prefix) => block.startsWith(prefix, i))) {
                const end = endOfBlock(block, i);
                removals.push({ start: i, end });
                i = end - 1;
                continue;
            }
            depth += 1;
        } else if (c === ")") depth -= 1;
    }
    for (const item of removals.reverse())
        block = block.slice(0, item.start) + block.slice(item.end);
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
        if (c === '"') {
            inString = true;
            continue;
        }
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

function n(value) {
    return Number(value).toFixed(3);
}

function segmentKey(text) {
    const m = text.match(/\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)\s+\(width\s+([-\d.]+)\)\s+\(layer\s+"([^"]+)"\)\s+\(net\s+(\d+)\)\)/s);
    if (!m) return null;
    const forward = `S|${m[7]}|${m[6]}|${n(m[1])},${n(m[2])}|${n(m[3])},${n(m[4])}`;
    const reverse = `S|${m[7]}|${m[6]}|${n(m[3])},${n(m[4])}|${n(m[1])},${n(m[2])}`;
    return forward < reverse ? forward : reverse;
}

function viaKey(text) {
    const m = text.match(/\(via\s+\(at\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(net\s+(\d+)\)\)/);
    return m ? `V|${m[3]}|${n(m[1])},${n(m[2])}` : null;
}

const originalTargetSegments = [
    [16, "B.Cu", 75.4, 30.08, 79.4, 30.08], [16, "B.Cu", 79.4, 30.08, 83, 10],
    [21, "B.Cu", 75.4, 42.78, 79.4, 42.78], [21, "B.Cu", 79.4, 42.78, 83, 40],
    [22, "B.Cu", 75.4, 45.32, 79.4, 45.32], [22, "B.Cu", 79.4, 45.32, 83, 46],
    [16, "F.Cu", 83, 10, 102.9, 10], [21, "F.Cu", 83, 40, 102.9, 40],
    [22, "F.Cu", 83, 46, 102.9, 46], [17, "B.Cu", 75.4, 32.62, 79.4, 32.62],
    [17, "B.Cu", 79.4, 32.62, 83, 16], [17, "F.Cu", 83, 16, 118, 16],
    [17, "B.Cu", 118, 16, 118, 90], [17, "F.Cu", 118, 90, 118, 107.2],
    [17, "F.Cu", 118, 107.2, 64, 107.2], [17, "F.Cu", 64, 107.2, 64, 102.5],
    [17, "F.Cu", 64, 102.5, 66.9, 102.5], [71, "F.Cu", 105.1, 11, 108, 11],
    [71, "F.Cu", 108, 11, 112, 10], [72, "F.Cu", 105.1, 41, 108, 41],
    [72, "F.Cu", 108, 41, 112, 40], [73, "F.Cu", 105.1, 47, 108, 47],
    [73, "F.Cu", 108, 47, 112, 46], [52, "F.Cu", 69.1, 103.5, 72, 105.5],
    [52, "F.Cu", 72, 105.5, 88.9, 105.5],
].map(([net, layer, x1, y1, x2, y2]) => {
    const a = `S|${net}|${layer}|${n(x1)},${n(y1)}|${n(x2)},${n(y2)}`;
    const b = `S|${net}|${layer}|${n(x2)},${n(y2)}|${n(x1)},${n(y1)}`;
    return a < b ? a : b;
});
const originalTargetVias = [
    [16, 83, 10], [21, 83, 40], [22, 83, 46], [17, 83, 16], [17, 118, 16], [17, 118, 90],
].map(([net, x, y]) => `V|${net}|${n(x)},${n(y)}`);
const preserveTarget = new Set([...originalTargetSegments, ...originalTargetVias]);
const targetNets = new Set([16, 17, 21, 22, 52, 71, 72, 73]);

// Drop only routes injected by the first-pass package transform. The original
// electrical routes remain as trusted branch points for the new through-hole bay.
for (const kind of ["segment", "via"]) {
    for (const item of topLevelBlocks(kind).reverse()) {
        const net = Number(item.text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
        if (!targetNets.has(net)) continue;
        const key = kind === "segment" ? segmentKey(item.text) : viaKey(item.text);
        if (preserveTarget.has(key)) continue;
        board = board.slice(0, item.start) + board.slice(item.end);
    }
}

// Remove first-pass power/bypass stubs and PhotoMOS bridge stubs. Keep the
// known-good +5 V tap via at 106,17.88, it becomes the supply branch for U11.
for (const item of topLevelBlocks("segment").reverse()) {
    const m = item.text.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\).*?\(end\s+([-\d.]+)\s+([-\d.]+)\).*?\(net\s+(\d+)\)/s);
    if (!m) continue;
    const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4]), net = Number(m[5]);
    const oldPower = net === 2 && ((Math.abs(x1 - 107.81) < 0.01 && Math.abs(y1 - 17.88) < 0.01) || (Math.abs(x2 - 107.81) < 0.01 && Math.abs(y2 - 17.88) < 0.01));
    const oldGround = net === 3 && ((Math.abs(x1 - 112.1) < 0.01 && Math.abs(y1 - 18.5) < 0.01) || (Math.abs(x2 - 112.1) < 0.01 && Math.abs(y2 - 18.5) < 0.01));
    const photoStub = Math.abs(Math.abs(x2 - x1) - 1.16) < 0.02 && [36.73, 39.27, 42.73, 45.27, 60.73, 63.27, 66.73, 69.27].some((y) => Math.abs(y1 - y) < 0.02 && Math.abs(y2 - y) < 0.02);
    if (oldPower || oldGround || photoStub) board = board.slice(0, item.start) + board.slice(item.end);
}
for (const item of topLevelBlocks("via").reverse()) {
    const key = viaKey(item.text);
    if (key === `V|3|${n(113)},${n(18.5)}`) board = board.slice(0, item.start) + board.slice(item.end);
}

// A 1206 body is much easier to place than 0805. Keep its copper conservative,
// 1.5 mm square lands retain a visible iron target without invading neighbors.
for (const { text } of topLevelBlocks("footprint")) {
    const ref = text.match(/\(property "Reference" "([^"]+)"/)?.[1];
    if (!ref || !/^[RC]\d+$/.test(ref) || !text.includes("_1206_HAND_SOLDER")) continue;
    editFootprint(ref, (block) => resizeSmdPads(block, 1.5, 1.5));
}

// Existing 1210 power ceramics are already large enough. Do not enlarge them
// further, their first-pass dimensions are intentionally left unchanged.

// Long toes help with an iron, extra pin-to-pin width does not. Keep the original
// pitch-direction clearance on the two ICs that must remain surface mount.
editFootprint("U10", (block) => {
    block = resizeSmdPads(block, 2.0, 0.6);
    block = removeDirectChildren(block, ["(fp_rect", "(fp_circle", "(fp_text user"]);
    block = hideReference(block);
    block = editPad(block, "1", (pad) => pad.replace("smd roundrect", "smd rect").replace(/\s*\(roundrect_rratio\s+[-\d.]+\)/, ""));
    return block;
});
editFootprint("U4", (block) => {
    block = resizeSmdPads(block, 1.8, 0.4);
    block = removeDirectChildren(block, ["(fp_rect", "(fp_circle", "(fp_text user"]);
    block = hideReference(block);
    block = editPad(block, "1", (pad) => pad.replace("smd roundrect", "smd rect").replace(/\s*\(roundrect_rratio\s+[-\d.]+\)/, ""));
    return block;
});

// Legacy single-gate locations are copper test anchors only. Restore the original
// small pad geometry so the proven local routes remain DRC-clean. Paste remains
// removed and the anchors remain excluded from BOM/CPL.
for (const ref of ["U_RGB", "U_TRIG_L", "U_TRIG_F", "U_TRIG_R"])
    editFootprint(ref, (block) => resizeSmdPads(block, 1.1, 0.55));

// Move each PhotoMOS slightly left so its two 7.62 mm pin rows straddle the
// existing isolation keepout. 1.8 mm annular lands are generous with a 0.9 mm drill
// and leave real clearance on the 2.54 mm pin pitch.
const photoYs = { U6: 38, U7: 44, U8: 62, U9: 68 };
for (const [ref, y] of Object.entries(photoYs)) {
    editFootprint(ref, (block) => {
        block = block.replace(/\(at\s+19\.4\s+[-\d.]+\)/, `(at 17.5 ${y})`);
        block = resizeThroughHolePads(block, 1.8, 0.9);
        block = removeDirectChildren(block, ["(fp_rect", "(fp_circle", "(fp_text user"]);
        return hideReference(block);
    });
}

// U11 gets its own 20 mm right-side hand-solder bay. The 1.8 mm PTH lands are
// deliberately smaller than the first pass, but still much easier than SOT-23-5.
editFootprint("U11", (block) => {
    block = block.replace(/\(at\s+104\s+25\.5\)/, "(at 139 25.5)");
    block = resizeThroughHolePads(block, 1.8, 0.9);
    block = removeDirectChildren(block, ["(fp_rect", "(fp_circle", "(fp_text user"]);
    return hideReference(block);
});
editFootprint("C28", (block) => {
    block = block.replace(/\(at\s+111\s+18\.5\)/, "(at 145 15.5)");
    block = resizeSmdPads(block, 1.5, 1.5);
    block = removeDirectChildren(block, ["(fp_rect", "(fp_circle", "(fp_text user"]);
    return hideReference(block);
});

// Hide large assembly references that overlap pads on a dense board. Keep the
// explicit + polarity marks, those are the markings that matter while soldering.
for (const ref of ["C10", "C16", "C19", "C24", "C26"])
    editFootprint(ref, hideReference);

// Extend the rectangular board and the existing ground pours into the new logic
// bay. Existing mounting-hole/antenna keepouts remain intact and continue to clip
// the refill automatically.
board = board.replace(
    /(\(gr_rect\s+\(start\s+1\s+1\)\s+\(end\s+)129(\s+190\)[\s\S]*?\(layer\s+"Edge\.Cuts"\)\))/,
    "$1149$2",
);
board = board.replaceAll("(xy 128 2) (xy 128 98)", "(xy 148 2) (xy 148 98)");
board = board.replaceAll("(xy 128 108) (xy 128 189)", "(xy 148 108) (xy 148 189)");

// Move the hand-build label to the empty extension and use a fabrication-safe
// 1 mm text height. Rotate it so it consumes very little horizontal bay width.
for (const item of topLevelBlocks("gr_text").reverse()) {
    if (!item.text.includes("HAND-SOLDER BUILD")) continue;
    board = board.slice(0, item.start) + board.slice(item.end);
}
insertBefore("(segment", '(gr_text "HAND-SOLDER BUILD | 1206 + DIP" (at 139 145 90) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.18))))');

// New PhotoMOS bridge traces connect the old, already-routed SOP endpoints to the
// relocated DIP rows without disturbing the isolation gap.
const photoNets = {
    U6: [33, 3, 34, 74], U7: [36, 3, 37, 75], U8: [41, 3, 42, 76], U9: [44, 3, 45, 77],
};
const photoRoutes = [];
for (const [ref, y] of Object.entries(photoYs)) {
    const nets = photoNets[ref];
    photoRoutes.push(segment(22.05, y - 1.27, 21.31, y - 1.27, 0.35, "F.Cu", nets[0]));
    photoRoutes.push(segment(22.05, y + 1.27, 21.31, y + 1.27, 0.35, "F.Cu", nets[1]));
    photoRoutes.push(segment(16.75, y + 1.27, 13.69, y + 1.27, 0.35, "F.Cu", nets[2]));
    photoRoutes.push(segment(16.75, y - 1.27, 13.69, y - 1.27, 0.35, "F.Cu", nets[3]));
}

const u11Routes = [
    // +5 V, branch from the known-good 106,17.88 tap. U11 pin 14 is PTH.
    segment(142.81, 17.88, 106, 17.88, 0.5, "F.Cu", 2),
    // Local bypass from U11 pin 14 to C28 pad 1. C28 pad 2 lands in F.Cu GND zone.
    segment(142.81, 17.88, 143.9, 15.5, 0.4, "F.Cu", 2),

    // RGB input, branch to existing AUX_GPIO2 via at 118,16.
    segment(135.19, 20.42, 131, 20.42, 0.3, "B.Cu", 17),
    segment(131, 20.42, 131, 18, 0.3, "B.Cu", 17),
    segment(131, 18, 120, 18, 0.3, "B.Cu", 17),
    segment(120, 18, 118, 16, 0.3, "B.Cu", 17),

    // Left ultrasonic trigger input, branch to existing via at 83,10.
    segment(135.19, 28.04, 132, 28.04, 0.3, "B.Cu", 16),
    segment(132, 28.04, 132, 13.5, 0.3, "B.Cu", 16),
    segment(132, 13.5, 86, 13.5, 0.3, "B.Cu", 16),
    segment(86, 13.5, 83, 10, 0.3, "B.Cu", 16),

    // Front ultrasonic trigger input, separate back-copper lane.
    segment(142.81, 30.58, 144.5, 30.58, 0.3, "B.Cu", 21),
    segment(144.5, 30.58, 144.5, 36.5, 0.3, "B.Cu", 21),
    segment(144.5, 36.5, 86, 36.5, 0.3, "B.Cu", 21),
    segment(86, 36.5, 83, 40, 0.3, "B.Cu", 21),

    // Right ultrasonic trigger input, lower separate back-copper lane.
    segment(142.81, 22.96, 146, 22.96, 0.3, "B.Cu", 22),
    segment(146, 22.96, 146, 49.5, 0.3, "B.Cu", 22),
    segment(146, 49.5, 86, 49.5, 0.3, "B.Cu", 22),
    segment(86, 49.5, 83, 46, 0.3, "B.Cu", 22),

    // Level-shifted outputs go straight to the existing PTH trigger headers.
    segment(135.19, 30.58, 130.5, 30.58, 0.3, "B.Cu", 71),
    segment(130.5, 30.58, 130.5, 12.5, 0.3, "B.Cu", 71),
    segment(130.5, 12.5, 115, 12.5, 0.3, "B.Cu", 71),
    segment(115, 12.5, 112, 10, 0.3, "B.Cu", 71),

    segment(142.81, 33.12, 147, 33.12, 0.3, "B.Cu", 72),
    segment(147, 33.12, 147, 37.5, 0.3, "B.Cu", 72),
    segment(147, 37.5, 115, 37.5, 0.3, "B.Cu", 72),
    segment(115, 37.5, 112, 40, 0.3, "B.Cu", 72),

    segment(142.81, 25.5, 147, 25.5, 0.3, "B.Cu", 73),
    segment(147, 25.5, 147, 48.5, 0.3, "B.Cu", 73),
    segment(147, 48.5, 115, 48.5, 0.3, "B.Cu", 73),
    segment(115, 48.5, 112, 46, 0.3, "B.Cu", 73),

    // RGB shifted output stays on front copper, then joins the existing net52
    // trace at x=85,y=105.5. The top GND pour ends at y=98.
    segment(135.19, 22.96, 133.5, 22.96, 0.35, "F.Cu", 52),
    segment(133.5, 22.96, 133.5, 100, 0.35, "F.Cu", 52),
    segment(133.5, 100, 85, 100, 0.35, "F.Cu", 52),
    segment(85, 100, 85, 105.5, 0.35, "F.Cu", 52),
];
insertBefore("(zone", [...photoRoutes, ...u11Routes].join("\n  "));

fs.writeFileSync(BOARD, board);
console.log("finalized hand-solder carrier layout");
console.log("- 20 mm right-side DIP logic bay");
console.log("- 1.5 mm 1206 lands, 1.8 mm PTH lands");
console.log("- PhotoMOS rows straddle original isolation keepouts");
console.log("- U4/U10 toe extensions preserve pin-pitch clearance");
console.log("- original trigger/RGB routes retained as validated branch points");
