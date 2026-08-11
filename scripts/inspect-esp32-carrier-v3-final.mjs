import fs from "node:fs";

const boardPath = process.argv[2] ?? "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const board = fs.readFileSync(boardPath, "utf8");

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
  const blocks = [];
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
        blocks.push(board.slice(i, end));
        i = end - 1;
        continue;
      }
      depth += 1;
    } else if (c === ")") depth -= 1;
  }
  return blocks;
}

const allFootprints = topLevelBlocks("footprint");
const edgeBlocks = ["gr_rect", "gr_line", "gr_arc", "gr_curve", "gr_circle"]
  .flatMap(topLevelBlocks)
  .filter((block) => block.includes('(layer "Edge.Cuts")'));

const footprints = allFootprints.map((block) => {
  const ref = block.match(/\(property "Reference" "([^"]+)"/)?.[1] ?? "?";
  const at = block.match(/^\(footprint\s+"[^"]+"[\s\S]*?\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/);
  return at ? { ref, x: Number(at[1]), y: Number(at[2]), rotation: Number(at[3] ?? 0) } : { ref };
});

const zones = topLevelBlocks("zone").map((block) => ({
  net: block.match(/\(net\s+(\d+)\)/)?.[1] ?? "?",
  name: block.match(/\(net_name\s+"([^"]+)"\)/)?.[1] ?? "?",
  layer: block.match(/\(layer\s+"([^"]+)"\)/)?.[1] ?? "?",
  polygon: [...block.matchAll(/\(xy\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]),
}));

console.log("=== FINAL EDGE CUTS ===");
for (const block of edgeBlocks) console.log(block.replace(/\s+/g, " "));
console.log("=== FINAL ZONES ===");
for (const zone of zones) console.log(JSON.stringify(zone));
console.log("=== FOOTPRINT POSITIONS ===");
for (const fp of footprints.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))) console.log(JSON.stringify(fp));

const targetRefs = new Set(["U_TRIG_L", "U_TRIG_F", "U_TRIG_R", "U_RGB", "U6", "U7", "U8", "U9", "U4", "U10"]);
console.log("=== TARGET FOOTPRINT BLOCKS ===");
for (const block of allFootprints) {
  const ref = block.match(/\(property "Reference" "([^"]+)"/)?.[1];
  if (targetRefs.has(ref)) console.log(`--- ${ref} ---\n${block}`);
}

const targetNets = new Set([16, 17, 21, 22, 52, 71, 72, 73]);
console.log("=== TARGET ROUTED ITEMS ===");
for (const kind of ["segment", "via"]) {
  for (const block of topLevelBlocks(kind)) {
    const net = Number(block.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
    if (targetNets.has(net)) console.log(block.replace(/\s+/g, " "));
  }
}

console.log("=== GND ZONE SOURCE ===");
for (const block of topLevelBlocks("zone")) {
  if (block.includes('(net 3)') && block.includes('(layer "B.Cu")') && block.includes('(xy 2 2)')) {
    console.log(block);
    break;
  }
}

console.log("=== WORKFLOW FILES ===");
for (const file of fs.readdirSync(".github/workflows").sort()) {
  const content = fs.readFileSync(`.github/workflows/${file}`, "utf8");
  const name = content.match(/^name:\s*(.+)$/m)?.[1] ?? "?";
  console.log(`${file}: ${name}`);
}
