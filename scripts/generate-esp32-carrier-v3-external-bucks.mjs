import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const BOARD = "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const ENCODED = `${BOARD}.gz.b64`;
const BOM = "fixtures/esp32_robot_carrier/BOM_JLCPCB.csv";
const CPL = "fixtures/esp32_robot_carrier/CPL_JLCPCB.csv";

execFileSync(process.execPath, ["scripts/add-esp32-carrier-v3-battery-sense.mjs"], {
  stdio: "inherit",
});

let board = fs.readFileSync(BOARD, "utf8");

function endOfBlock(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")" && --depth === 0) return i + 1;
  }
  throw new Error(`unterminated block at ${start}`);
}

function footprintBounds(ref) {
  const marker = `(property "Reference" "${ref}"`;
  const markerIndex = board.indexOf(marker);
  if (markerIndex < 0) throw new Error(`footprint ${ref} not found`);
  const start = board.lastIndexOf("(footprint", markerIndex);
  if (start < 0) throw new Error(`footprint start ${ref} not found`);
  return { start, end: endOfBlock(board, start) };
}

function removeFootprint(ref) {
  const { start, end } = footprintBounds(ref);
  board = board.slice(0, start) + board.slice(end);
}

function removeCopperForNet(net) {
  const removals = [];
  for (const token of ["(segment", "(via"]) {
    let start = 0;
    while ((start = board.indexOf(token, start)) >= 0) {
      const end = endOfBlock(board, start);
      const block = board.slice(start, end);
      if (new RegExp(`\\(net\\s+${net}(?:\\s|\\))`).test(block)) removals.push({ start, end });
      start = end;
    }
  }
  for (const item of removals.sort((a, b) => b.start - a.start)) {
    board = board.slice(0, item.start) + board.slice(item.end);
  }
}

function terminal4({ ref, value, x, y, outNet, outName, label }) {
  return `(footprint "TerminalBlock_1x04_P5.08_ExternalBuck" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -5.4 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 5.4 0) (layer "F.Fab") hide)
    (fp_rect (start -10.4 -4.2) (end 10.4 4.2) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "${label}" (at 0 3.1 0) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.16))))
    (fp_text user "VIN+" (at -7.62 -2.8 0) (layer "F.SilkS") (effects (font (size 0.65 0.65) (thickness 0.12))))
    (fp_text user "VIN-" (at -2.54 -2.8 0) (layer "F.SilkS") (effects (font (size 0.65 0.65) (thickness 0.12))))
    (fp_text user "OUT-" (at 2.54 -2.8 0) (layer "F.SilkS") (effects (font (size 0.65 0.65) (thickness 0.12))))
    (fp_text user "OUT+" (at 7.62 -2.8 0) (layer "F.SilkS") (effects (font (size 0.65 0.65) (thickness 0.12))))
    (pad "1" thru_hole rect (at -7.62 0) (size 4 4) (drill 1.6) (layers "*.Cu" "*.Mask") (net 57 "VIN_PROTECTED"))
    (pad "2" thru_hole circle (at -2.54 0) (size 4 4) (drill 1.6) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "3" thru_hole circle (at 2.54 0) (size 4 4) (drill 1.6) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "4" thru_hole circle (at 7.62 0) (size 4 4) (drill 1.6) (layers "*.Cu" "*.Mask") (net ${outNet} "${outName}"))
  )`;
}

function segment(x1, y1, x2, y2, width, layer, net) {
  return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}

function touchingLayers(x, y, net) {
  const layers = new Set();
  let start = 0;
  while ((start = board.indexOf("(segment", start)) >= 0) {
    const end = endOfBlock(board, start);
    const block = board.slice(start, end);
    if (!new RegExp(`\\(net\\s+${net}(?:\\s|\\))`).test(block)) {
      start = end;
      continue;
    }
    const layer = block.match(/\(layer\s+"([^"]+)"\)/)?.[1];
    for (const key of ["start", "end"]) {
      const m = block.match(new RegExp(`\\(${key}\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)`));
      if (!m) continue;
      if (Math.abs(Number(m[1]) - x) < 0.001 && Math.abs(Number(m[2]) - y) < 0.001 && layer) layers.add(layer);
    }
    start = end;
  }
  return [...layers];
}

function connectLegacyPads({ net, olds, target, width = 1.8 }) {
  const routes = [];
  let found = false;
  for (const [x, y] of olds) {
    for (const layer of touchingLayers(x, y, net)) {
      found = true;
      routes.push(segment(x, y, target[0], target[1], width, layer, net));
    }
  }
  if (!found) {
    const [x, y] = olds[0];
    routes.push(segment(x, y, target[0], target[1], width, "F.Cu", net));
  }
  return routes;
}

const bridgeRoutes = [
  ...connectLegacyPads({ net: 57, olds: [[68.53, 141.62]], target: [74.88, 134] }),
  ...connectLegacyPads({ net: 3, olds: [[68.53, 134], [68.53, 126.38]], target: [79.96, 134] }),
  ...connectLegacyPads({ net: 3, olds: [[96.47, 126.38], [96.47, 130.19]], target: [85.04, 134] }),
  ...connectLegacyPads({ net: 2, olds: [[96.47, 137.81], [96.47, 141.62]], target: [90.12, 134] }),
  ...connectLegacyPads({ net: 57, olds: [[59.14, 159.84]], target: [74.38, 170] }),
  ...connectLegacyPads({ net: 3, olds: [[59.14, 170]], target: [79.46, 170] }),
  ...connectLegacyPads({ net: 3, olds: [[104.86, 170]], target: [84.54, 170] }),
  ...connectLegacyPads({ net: 79, olds: [[104.86, 159.84]], target: [89.62, 170] }),
];

removeFootprint("PS1");
removeFootprint("PS2");
removeFootprint("R44");
removeCopperForNet(81);

const insertAt = board.indexOf("(zone");
if (insertAt < 0) throw new Error("zone insertion point not found");
const additions = [
  terminal4({ ref: "J_BUCK_5V", value: "EXTERNAL_5V_BUCK_4WIRE", x: 82.5, y: 134, outNet: 2, outName: "+5V", label: "EXT 5V BUCK" }),
  terminal4({ ref: "J_BUCK_24V", value: "EXTERNAL_24V_BUCK_4WIRE", x: 82, y: 170, outNet: 79, outName: "+24V", label: "EXT 24V BUCK" }),
  ...bridgeRoutes,
].join("\n  ");
board = board.slice(0, insertAt) + additions + "\n  " + board.slice(insertAt);

if (board.includes('property "Reference" "PS1"') || board.includes('property "Reference" "PS2"')) throw new Error("legacy converter footprint still present");
if (!board.includes('property "Reference" "J_BUCK_5V"') || !board.includes('property "Reference" "J_BUCK_24V"')) throw new Error("external buck terminals were not added");

fs.writeFileSync(BOARD, board);
fs.writeFileSync(ENCODED, zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n");

let bom = fs.readFileSync(BOM, "utf8");
const ps1Row = '"5V isolated DC-DC module","PS1",Murata_UWS_Q48_THT,,Murata Power Solutions,UWS-5/10-Q48N-C,Hand/THT; 18-75V input; 8A low-line; 5.10V trim limits high-line output to 9.8A/50W; negative-logic enable';
const ps2Row = '"24V 2.5A isolated DC-DC module","PS2",Traco_TEN60WIN_THT,,Traco Power,TEN 60-4815WIN,Hand/THT; active 60W module; 18-75V input; passive-on remote';
const r44Row = '"806k 1pct UWS trim-up","R44",0805,,Yageo,RC0805FR-07806KL,SMT; sets nominal 5V rail to approximately 5.10V per Murata trim equation';
for (const required of [ps1Row, ps2Row, r44Row]) {
  if (!bom.includes(required)) throw new Error(`BOM source row not found: ${required}`);
}
const replacementRows = [
  '"4-position 5.08mm external buck terminal","J_BUCK_5V,J_BUCK_24V",TerminalBlock_1x04_P5.08,,Generic,KF301-5.08-4P-compatible,"Hand/THT; 4-position 5.08mm; use >=60VDC and >=10A-rated connector; pin order VIN+, VIN-, OUT-, OUT+"',
  '"External 42V to 5V buck module","MOD_5V",Off-board,,Generic,60V+-input buck module,"Off-board; non-isolated is acceptable; input absolute max >=60V, 75V+ preferred; set output to 5.0-5.1V before connecting; >=6A verified continuous output; connect to J_BUCK_5V"',
  '"External 42V to 24V buck module","MOD_24V",Off-board,,Generic,60V+-input buck module,"Off-board; non-isolated is acceptable; input absolute max >=60V, 75V+ preferred; set output to 24V before connecting; >=3A verified continuous output, 5A+ advertised preferred; connect to J_BUCK_24V"',
].join("\n");
bom = bom.replace(ps1Row, replacementRows).replace(`\n${ps2Row}`, "").replace(`\n${r44Row}`, "");
fs.writeFileSync(BOM, bom);

let cpl = fs.readFileSync(CPL, "utf8");
const before = cpl;
cpl = cpl.split("\n").filter((line) => !line.startsWith("R44,")).join("\n");
if (cpl === before) throw new Error("R44 not found in CPL");
fs.writeFileSync(CPL, cpl);

console.log(`external buck conversion applied to ${BOARD}`);
console.log("PS1/PS2 industrial bricks removed; J_BUCK_5V/J_BUCK_24V added; BOM/CPL updated");
