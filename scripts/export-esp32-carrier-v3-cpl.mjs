import fs from "node:fs";

const boardPath =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const outputPath =
    process.argv[3] ?? "fixtures/esp32_robot_carrier/CPL_JLCPCB.csv";
const board = fs.readFileSync(boardPath, "utf8");

function endOfBlock(source, start) {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
        if (source[index] === "(") depth += 1;
        if (source[index] !== ")") continue;
        depth -= 1;
        if (depth === 0) return index + 1;
    }
    throw new Error(`unterminated block at ${start}`);
}

function placement(block) {
    const match = block.match(
        /^\(footprint\s+"[^"]+"[\s\S]*?\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?/,
    );
    if (!match) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        rotation: Number(match[3] ?? 0),
    };
}

const excludedReferences = new Set(["JP_ESP_PWR"]);
const placements = [];
let start = 0;
while ((start = board.indexOf("(footprint", start)) >= 0) {
    const end = endOfBlock(board, start);
    const block = board.slice(start, end);
    const reference = block.match(/\(property "Reference" "([^"]+)"/);
    const location = placement(block);
    const hasSmdPad = /\(pad\s+"[^"]*"\s+smd\b/.test(block);
    const hasThroughHolePad = /\(pad\s+"[^"]*"\s+(?:thru_hole|np_thru_hole)\b/.test(
        block,
    );
    const excludedByFootprint =
        /\(attr\s[^)]*\bexclude_from_pos_files\b/.test(block) ||
        /\(attr\s[^)]*\bexclude_from_bom\b/.test(block);
    if (
        reference &&
        location &&
        hasSmdPad &&
        !hasThroughHolePad &&
        !excludedReferences.has(reference[1]) &&
        !excludedByFootprint
    )
        placements.push({ reference: reference[1], ...location });
    start = end;
}

placements.sort((left, right) =>
    left.reference.localeCompare(right.reference, undefined, { numeric: true }),
);
const rows = ["Designator,Mid X,Mid Y,Rotation,Layer"];
for (const item of placements)
    rows.push(
        `${item.reference},${item.x.toFixed(3)}mm,${item.y.toFixed(3)}mm,${item.rotation.toFixed(1)},Top`,
    );

fs.writeFileSync(outputPath, `${rows.join("\n")}\n`);
console.log(`wrote ${placements.length} SMT placements to ${outputPath}`);
