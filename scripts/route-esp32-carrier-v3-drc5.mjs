import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const BOARD = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const ENCODED = `${BOARD}.gz.b64`;
execFileSync(process.execPath, ["scripts/route-esp32-carrier-v3-drc4.mjs"], {
    stdio: "inherit",
});
let board = fs.readFileSync(BOARD, "utf8");

function endOfBlock(source, start) {
    let d = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === "(") d++;
        else if (source[i] === ")" && --d === 0) return i + 1;
    }
    throw new Error("unterminated block");
}
function blocks(token) {
    const out = [];
    let p = 0;
    while ((p = board.indexOf(token, p)) >= 0) {
        const end = endOfBlock(board, p);
        out.push({ start: p, end, text: board.slice(p, end) });
        p = end;
    }
    return out;
}
function netId(text) {
    return Number(text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
}
function seg(x1, y1, x2, y2, w, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${w}) (layer "${layer}") (net ${net}))`;
}
function via(x, y, net, size = 0.9, drill = 0.45) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}

const del = [];
for (const token of ["(segment", "(via"]) {
    for (const e of blocks(token)) {
        const n = netId(e.text);
        if (n === 55) del.push(e);
        if (
            n === 2 &&
            (e.text.includes("(start 78 141)") ||
                e.text.includes("(start 91 141)") ||
                e.text.includes("(start 97.5 141)") ||
                e.text.includes("(start 102.5 141)") ||
                e.text.includes("(start 111 141)") ||
                e.text.includes("(start 115.2 141)"))
        )
            del.push(e);
    }
}
for (const e of del.sort((a, b) => b.start - a.start))
    board = board.slice(0, e.start) + board.slice(e.end);

const r = [];

// Gate: U4 leaves F.Cu immediately, crosses the VOUT-sense corridor on B.Cu,
// then returns to F.Cu for the whole lower lane. Q5 stays F.Cu. Q6 changes to
// B.Cu at x=70, well clear of C10 and the protected-VIN vertical at x=59.62.
r.push(
    seg(39.2, 118.05, 40, 117, 0.25, "F.Cu", 55),
    via(40, 117, 55),
    seg(40, 117, 40, 136, 0.25, "B.Cu", 55),
    via(40, 136, 55),
    seg(40, 136, 70, 136, 0.25, "F.Cu", 55),
    seg(49, 136, 49, 118, 0.25, "F.Cu", 55),
    via(70, 136, 55),
    seg(70, 136, 70, 116, 0.25, "B.Cu", 55),
    seg(70, 116, 62.16, 116, 0.25, "B.Cu", 55),
    seg(62.16, 116, 62.16, 118, 0.25, "B.Cu", 55),
);

// Shift the 8 A 5.1 V trunk upward. At y=138 it clears C17/C18 ground pads by
// several millimeters while keeping short vertical branches to every output pad.
r.push(
    seg(78, 141, 78, 138, 2.5, "F.Cu", 2),
    seg(78, 138, 115.2, 138, 2.5, "F.Cu", 2),
    seg(91, 138, 91, 144, 1.5, "F.Cu", 2),
    seg(97.5, 138, 97.5, 143, 1.5, "F.Cu", 2),
    seg(102.5, 138, 102.5, 143, 1.5, "F.Cu", 2),
    seg(111, 138, 111, 143, 1.5, "F.Cu", 2),
    seg(115.2, 138, 115.2, 143, 1.5, "F.Cu", 2),
);

const insert = board.indexOf("(zone");
board = board.slice(0, insert) + r.join("\n  ") + "\n  " + board.slice(insert);
fs.writeFileSync(BOARD, board);
fs.writeFileSync(
    ENCODED,
    zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n",
);
console.log(`DRC5 routed ${BOARD}`);
