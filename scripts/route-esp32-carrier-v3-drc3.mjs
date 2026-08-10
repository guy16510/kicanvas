import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const BOARD = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb';
const ENCODED = `${BOARD}.gz.b64`;

execFileSync(process.execPath, ['scripts/route-esp32-carrier-v3-drc2.mjs'], { stdio: 'inherit' });
let board = fs.readFileSync(BOARD, 'utf8');

function endOfBlock(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i + 1;
  }
  throw new Error(`unterminated block at ${start}`);
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

function footprint(ref) {
  for (const entry of blocks('(footprint')) {
    if (entry.text.includes(`(property "Reference" "${ref}"`)) return entry;
  }
  throw new Error(`footprint ${ref} not found`);
}

function replaceFootprint(ref, replacement) {
  const { start, end } = footprint(ref);
  board = board.slice(0, start) + replacement + board.slice(end);
}

function smd2({ ref, value, x, y, n1, s1, n2, s2, span = 1.1, sx = 1.2, sy = 1.2 }) {
  return `(footprint "SMD2_${sx}x${sy}" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.0 0) (layer "F.Fab") hide)
    (property "Value" "${value}" (at 0 2.0 0) (layer "F.Fab") hide)
    (pad "1" smd roundrect (at -${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n1} "${s1}"))
    (pad "2" smd roundrect (at ${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n2} "${s2}"))
  )`;
}

function seg(x1, y1, x2, y2, width, layer, net) {
  return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}

function via(x, y, net, size = 0.9, drill = 0.45) {
  return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}

// Move the LTC4367 shutdown pull-up down so BAT_FUSED and SHDN can approach it
// from different layers without sharing a via corridor.
replaceFootprint('R39', smd2({
  ref: 'R39', value: '470k_SHDN_PULLUP', x: 43, y: 130,
  n1: 54, s1: 'BAT_FUSED', n2: 65, s2: 'PROTECT_SHDN',
}));

function netId(text) {
  return Number(text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
}

function coords(text) {
  return [...text.matchAll(/\((?:start|end|at)\s+([-\d.]+)\s+([-\d.]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
}

// Rebuild the remaining problematic new nets from scratch. Also rebuild the
// custom +5/GND/servo routes in the board extension. Legacy v2 routes stay intact.
const removeNets = new Set([2, 3, 15, 54, 55, 57, 62, 65]);
const deletions = [];
for (const token of ['(segment', '(via']) {
  for (const entry of blocks(token)) {
    const net = netId(entry.text);
    if (!removeNets.has(net)) continue;
    const points = coords(entry.text);
    const custom = net === 54 || net === 55 || net === 57 || net === 62 || net === 65 ||
      (net === 2 || net === 3) && points.some(([, y]) => y >= 108) ||
      net === 15 && points.some(([x, y]) => x <= 11 && y >= 80);
    if (custom) deletions.push(entry);
  }
}
for (const { start, end } of deletions.sort((a, b) => b.start - a.start)) {
  board = board.slice(0, start) + board.slice(end);
}

const r = [];

// BAT_FUSED, preserve the high-current top rail and feed U4 directly.
r.push(
  seg(22,118,22,113.5,1.5,'F.Cu',54),
  seg(22,113.5,51.54,113.5,1.5,'F.Cu',54),
  seg(51.54,113.5,51.54,118,1.5,'F.Cu',54),
  seg(24.5,113.5,24.5,126,0.7,'F.Cu',54),
  seg(34.8,113.5,34.8,118.05,0.3,'F.Cu',54),
);

// BAT_FUSED to the top of the corrected LTC4367 divider, on B.Cu below the FETs.
r.push(
  via(45.5,113.5,54),
  seg(45.5,113.5,48.8,131.5,0.3,'B.Cu',54),
  via(48.8,131.5,54),
  seg(48.8,131.5,47.6,134,0.25,'F.Cu',54),
);

// BAT_FUSED to R39 pad 1, separate from the shutdown signal.
r.push(
  via(44,113.5,54),
  seg(44,113.5,47.5,132,0.25,'B.Cu',54),
  seg(47.5,132,41.9,132,0.25,'B.Cu',54),
  via(41.9,132,54),
  seg(41.9,132,41.9,130,0.25,'F.Cu',54),
);

// PROTECT_SHDN stays entirely on F.Cu from U4 pin 5 to R39 pad 2.
r.push(
  seg(39.2,121.95,45.5,121.95,0.25,'F.Cu',65),
  seg(45.5,121.95,45.5,130,0.25,'F.Cu',65),
  seg(45.5,130,44.1,130,0.25,'F.Cu',65),
);

// PROTECT_GATE: cross the protected-VIN vertical on F.Cu, not B.Cu. Q5 is
// reached directly from the B.Cu lane, Q6 is reached after a layer hop.
r.push(
  seg(39.2,118.05,42.5,118.05,0.25,'F.Cu',55),
  via(42.5,118.05,55),
  seg(42.5,118.05,42.5,134,0.25,'B.Cu',55),
  seg(42.5,134,58,134,0.25,'B.Cu',55),
  seg(49,134,49,118,0.25,'B.Cu',55),
  via(58,134,55),
  seg(58,134,64,134,0.25,'F.Cu',55),
  via(64,134,55),
  seg(64,134,64,118,0.25,'B.Cu',55),
  seg(64,118,62.16,118,0.25,'B.Cu',55),
);

// VIN_PROTECTED VOUT sense, move the first via away from U4's NC pin 6.
r.push(
  seg(39.2,119.35,41.5,119.35,0.25,'F.Cu',57),
  via(41.5,119.35,57),
  seg(41.5,119.35,41.5,142,0.25,'B.Cu',57),
  seg(41.5,142,59.62,142,0.25,'B.Cu',57),
  seg(59.62,142,59.62,118,0.35,'B.Cu',57),
);

// Protected VIN to left input capacitors and left VIN pins. Route around each
// capacitor's ground pad rather than straight through it.
r.push(
  seg(59.62,118,59.62,124,0.9,'F.Cu',57),
  seg(59.62,124,66.5,124,0.9,'F.Cu',57),
  seg(66.5,124,66.5,126,0.5,'F.Cu',57),
  seg(66.5,126,66.5,123.0,0.35,'F.Cu',57),
  seg(66.5,123.0,73.1,123.0,0.35,'F.Cu',57),
  seg(73.1,123.0,73.1,126,0.35,'F.Cu',57),
  seg(73.1,126,74.2,126,0.35,'F.Cu',57),
  seg(74.2,125.25,74.2,126.25,0.35,'F.Cu',57),
  seg(74.2,125.25,75.55,125.25,0.35,'F.Cu',57),
  seg(74.2,125.75,75.55,125.75,0.35,'F.Cu',57),
  seg(74.2,126.25,75.55,126.25,0.35,'F.Cu',57),
);

// Separate B.Cu feed from Q6's protected drain to the right-side input network.
// It drops immediately, so it does not pass through Q6's gate pad.
r.push(
  seg(59.62,118,59.62,115,0.7,'B.Cu',57),
  seg(59.62,115,88.9,115,0.7,'B.Cu',57),
  seg(88.9,115,88.9,124,0.5,'B.Cu',57),
  via(88.9,124,57),
  seg(88.9,124,88.9,126,0.35,'F.Cu',57),
  seg(88.9,123.4,84.6,123.4,0.3,'F.Cu',57),
  seg(84.6,123.4,84.6,124.25,0.3,'F.Cu',57),
  seg(84.6,123.4,82.4,123.4,0.3,'F.Cu',57),
  seg(82.4,123.4,82.4,126.25,0.3,'F.Cu',57),
  seg(80.45,125.25,82.4,125.25,0.3,'F.Cu',57),
  seg(80.45,125.75,82.4,125.75,0.3,'F.Cu',57),
  seg(80.45,126.25,82.4,126.25,0.3,'F.Cu',57),
);

// PWR_FB, route around R33's +5V pad and around the +5V vias instead of
// horizontally through them.
r.push(
  seg(67.1,112,67.1,114,0.25,'F.Cu',62),
  seg(67.1,114,73.1,114,0.25,'F.Cu',62),
  seg(73.1,114,73.1,112,0.25,'F.Cu',62),
  seg(73.1,114,74.9,116,0.25,'F.Cu',62),
  seg(74.9,116,74.9,120,0.25,'F.Cu',62),
  seg(74.9,120,75.4,121,0.25,'F.Cu',62),
  seg(75.4,121,76.75,122.55,0.25,'F.Cu',62),
);

// +5V feedback endpoints and BIAS join a single far-right B.Cu trunk.
r.push(
  seg(64.9,112,64.9,110,0.25,'F.Cu',2), via(64.9,110,2),
  seg(70.9,112,70.9,110,0.25,'F.Cu',2), via(70.9,110,2),
  seg(64.9,110,64.9,108,0.3,'B.Cu',2),
  seg(70.9,110,70.9,108,0.3,'B.Cu',2),
  seg(64.9,108,94,108,0.4,'B.Cu',2),
  seg(70.9,108,94,108,0.4,'B.Cu',2),
  seg(75.55,123.75,72.5,123.75,0.25,'F.Cu',2), via(72.5,123.75,2),
  seg(72.5,123.75,94,123.75,0.3,'B.Cu',2),
  seg(94,108,94,138,0.5,'B.Cu',2),
  via(94,138,2,1.1,0.55),
  seg(94,138,124,137,1.2,'B.Cu',2),
  seg(124,137,124,92,1.2,'B.Cu',2),
  seg(124,92,42,92,1.2,'B.Cu',2),
);

// U5 top GND pins escape straight up between NC and SS pins. This maintains
// copper clearance from NC pins 27 and 31.
r.push(
  seg(78.75,122.55,78.75,120.5,0.25,'F.Cu',3), via(78.75,120.5,3),
  seg(77.75,122.55,77.75,120.5,0.25,'F.Cu',3), via(77.75,120.5,3),
);

// U5 left/right ground pins fan outward to the bottom ground plane.
r.push(
  seg(75.55,127.25,74.0,127.25,0.25,'F.Cu',3), via(74.0,127.25,3),
  seg(75.55,127.75,74.0,128.0,0.25,'F.Cu',3), via(74.0,128.0,3),
  seg(75.55,128.25,74.0,128.75,0.25,'F.Cu',3), via(74.0,128.75,3),
  seg(80.45,127.25,82.5,127.25,0.25,'F.Cu',3), via(82.5,127.25,3),
  seg(80.45,127.75,82.5,128.0,0.25,'F.Cu',3), via(82.5,128.0,3),
  seg(80.45,128.25,82.5,128.75,0.25,'F.Cu',3), via(82.5,128.75,3),
);

// Exposed-pad thermal ground vias.
for (const [x,y] of [[77.3,124.25],[78.7,124.25],[77.3,126],[78.7,126],[77.3,127.75],[78.7,127.75]]) {
  r.push(via(x,y,3,0.8,0.4));
}

// Local grounds for the input capacitors, control parts, TVS and output caps.
r.push(
  seg(69.5,126,69.5,129,0.3,'F.Cu',3), via(69.5,129,3),
  seg(70.9,126,70.9,129,0.3,'F.Cu',3), via(70.9,129,3),
  seg(91.1,126,91.1,129,0.3,'F.Cu',3), via(91.1,129,3),
  seg(84.6,122,85.8,122,0.25,'F.Cu',3), via(85.8,122,3),
  seg(77.1,116,78.5,116,0.25,'F.Cu',3), via(78.5,116,3),
  seg(81.1,118,82.2,118,0.25,'F.Cu',3), via(82.2,118,3),
  seg(29.5,126,31.0,126,0.35,'F.Cu',3), via(31.0,126,3),
  seg(26.9,134,25.5,134,0.25,'F.Cu',3), via(25.5,134,3),
  seg(34.8,121.95,33.5,123,0.25,'F.Cu',3), via(33.5,123,3),
  seg(100.5,143,100.5,146,0.4,'F.Cu',3), via(100.5,146,3,1.0,0.5),
  seg(105.5,143,105.5,146,0.4,'F.Cu',3), via(105.5,146,3,1.0,0.5),
);

// Servo signal detours around H3 at x=5,y=95. Servo power remains in the lower
// extension and the PTH header/capacitor grounds connect directly to the plane.
r.push(
  seg(8,80,5,82,0.25,'F.Cu',15), via(5,82,15),
  seg(5,82,5,91,0.25,'B.Cu',15),
  seg(5,91,10,91,0.25,'B.Cu',15),
  seg(10,91,10,99,0.25,'B.Cu',15),
  seg(10,99,5,99,0.25,'B.Cu',15),
  seg(5,99,5,143,0.25,'B.Cu',15),
  via(5,143,15), seg(5,143,6,145,0.25,'F.Cu',15),
);

r.push(
  via(16.2,149,2), seg(16.2,149,16.2,145,0.7,'F.Cu',2),
  seg(19.8,145,19.8,141.5,0.7,'F.Cu',64),
  seg(19.8,141.5,8.54,141.5,0.7,'F.Cu',64),
  seg(8.54,141.5,8.54,145,0.7,'F.Cu',64),
  seg(19.8,145,25,145,0.7,'F.Cu',64),
);

const insert = board.indexOf('(zone');
board = board.slice(0, insert) + r.join('\n  ') + '\n  ' + board.slice(insert);

// All newly authored fine-control traces meet the board's 0.25 mm minimum.
board = board.replace(/\(width\s+(?:0\.18|0\.22)\)/g, '(width 0.25)');

fs.writeFileSync(BOARD, board);
fs.writeFileSync(ENCODED, zlib.gzipSync(Buffer.from(board), { level: 9 }).toString('base64') + '\n');
console.log(`DRC3 routed ${BOARD}`);
