import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const boardPath = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb';
const encodedPath = `${boardPath}.gz.b64`;
execFileSync(process.execPath, ['scripts/route-esp32-carrier-v3-clean.mjs'], { stdio: 'inherit' });
let board = fs.readFileSync(boardPath, 'utf8');

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

function footprintBounds(ref) {
  for (const entry of blocks('(footprint')) {
    if (entry.text.includes(`(property "Reference" "${ref}"`)) return entry;
  }
  throw new Error(`footprint ${ref} not found`);
}

function replaceFootprint(ref, replacement) {
  const { start, end } = footprintBounds(ref);
  board = board.slice(0, start) + replacement + board.slice(end);
}

function moveFootprint(ref, x, y, rot = null) {
  const { start, end, text } = footprintBounds(ref);
  const next = text.replace(
    /^(\(footprint[^\n]*?\(at\s+)[-\d.]+\s+[-\d.]+(?:\s+[-\d.]+)?(\))/,
    `$1${x} ${y}${rot === null ? '' : ` ${rot}`}$2`,
  );
  board = board.slice(0, start) + next + board.slice(end);
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

// Put the EN and RT parts directly beside their pins so those adjacent 0.5 mm
// pitch signals never have to cross the VIN rail.
replaceFootprint('R31', smd2({ ref: 'R31', value: '100k_EN_PULLUP', x: 83.5, y: 124.25, n1: 60, s1: 'PWR_EN', n2: 57, s2: 'VIN_PROTECTED', span: 1.1, sx: 1.0, sy: 0.9 }));
replaceFootprint('R32', smd2({ ref: 'R32', value: '88.7k_RT_500kHz', x: 83.5, y: 122.0, n1: 61, s1: 'PWR_RT', n2: 3, s2: 'GND', span: 1.1, sx: 1.0, sy: 0.9 }));
moveFootprint('R34', 76, 116);
// Move the right-side local input capacitor outside the U5 pin escape corridor.
replaceFootprint('C13', smd2({ ref: 'C13', value: '0.47uF_100V_LOCAL_R', x: 90, y: 126, n1: 57, s1: 'VIN_PROTECTED', n2: 3, s2: 'GND' }));

function getNetId(text) {
  return Number(text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1);
}
function coordYs(text) {
  return [...text.matchAll(/\((?:start|end|at)\s+[-\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]));
}

// Remove every prior route/via for new v3 nets, then rebuild them with dedicated
// non-crossing lanes.  Legacy v2 routing has net IDs <= 52.
const deletions = [];
for (const token of ['(segment', '(via']) {
  for (const entry of blocks(token)) {
    const net = getNetId(entry.text);
    const ys = coordYs(entry.text);
    const isNewNet = net >= 53 && net <= 67;
    const isCustomPowerOrGround = (net === 2 || net === 3) && ys.some((y) => y >= 110);
    const isCustomServo = net === 15 && (entry.text.includes('(start 8 80)') || entry.text.includes('(start 5 ') || entry.text.includes('(at 5 '));
    if (isNewNet || isCustomPowerOrGround || isCustomServo) deletions.push(entry);
  }
}
for (const { start, end } of deletions.sort((a, b) => b.start - a.start)) {
  board = board.slice(0, start) + board.slice(end);
}

const r = [];

// 53 BAT_RAW: avoid the adjacent battery ground pin.
r.push(seg(7,118,7,113.5,1.5,'F.Cu',53), seg(7,113.5,18,113.5,1.5,'F.Cu',53), seg(18,113.5,18,118,1.5,'F.Cu',53));

// 54 BAT_FUSED: high-current top lane and independent local taps.
r.push(
  seg(22,118,22,113.5,1.5,'F.Cu',54), seg(22,113.5,51.54,113.5,1.5,'F.Cu',54), seg(51.54,113.5,51.54,118,1.5,'F.Cu',54),
  seg(24.5,113.5,24.5,126,0.7,'F.Cu',54),
  seg(34.8,113.5,34.8,118.05,0.3,'F.Cu',54),
  via(45,113.5,54), seg(45,113.5,45,131.0,0.3,'B.Cu',54), seg(45,131.0,48.5,131.0,0.3,'B.Cu',54), via(48.5,131.0,54), seg(48.5,131.0,47.6,134,0.25,'F.Cu',54),
  seg(41.9,126,41.9,123.8,0.25,'F.Cu',54), via(41.9,123.8,54), seg(41.9,123.8,43,113.5,0.25,'B.Cu',54), via(43,113.5,54),
);

// 67 / 59 / 58 divider chain and separate UV/OV sense lanes.
r.push(
  seg(44.4,134,41.6,134,0.22,'F.Cu',67),
  seg(38.4,134,35.1,134,0.22,'F.Cu',59),
  seg(32.9,134,29.1,134,0.22,'F.Cu',58),
  seg(38.4,134,38.4,131.5,0.22,'F.Cu',59), via(38.4,131.5,59), seg(38.4,131.5,38.4,119.35,0.22,'B.Cu',59), seg(38.4,119.35,32.4,119.35,0.22,'B.Cu',59), via(32.4,119.35,59), seg(32.4,119.35,34.8,119.35,0.22,'F.Cu',59),
  seg(29.1,134,29.1,131.5,0.22,'F.Cu',58), via(29.1,131.5,58), seg(29.1,131.5,29.1,120.65,0.22,'B.Cu',58), seg(29.1,120.65,32.4,120.65,0.22,'B.Cu',58), via(32.4,120.65,58), seg(32.4,120.65,34.8,120.65,0.22,'F.Cu',58),
);

// 65 SHDN has its own short B.Cu lane to R39.
r.push(seg(39.2,121.95,40.2,122.8,0.22,'F.Cu',65), via(40.2,122.8,65), seg(40.2,122.8,44.1,126,0.22,'B.Cu',65), via(44.1,126,65));

// 55 GATE distribution uses the very top of the extension, away from BAT divider/sense lanes.
r.push(
  seg(39.2,118.05,40.5,116.5,0.25,'F.Cu',55), via(40.5,116.5,55),
  seg(40.5,116.5,40.5,110,0.25,'B.Cu',55), seg(40.5,110,64,110,0.25,'B.Cu',55),
  seg(47,110,47,118,0.25,'B.Cu',55), via(47,118,55), seg(47,118,49,118,0.25,'F.Cu',55),
  seg(64,110,64,118,0.25,'B.Cu',55), via(64,118,55), seg(64,118,62.16,118,0.25,'F.Cu',55),
);

// 56 source-to-source back-to-back protection node.
r.push(seg(54.08,118,57.08,118,1.4,'F.Cu',56));

// 57 protected VIN.  U4 VOUT sense goes below the divider, while the buck input
// stays on F.Cu at the left and reaches the right VIN pins under U5 on B.Cu.
r.push(
  seg(39.2,119.35,40.2,120.0,0.22,'F.Cu',57), via(40.2,120.0,57),
  seg(40.2,120.0,40.2,139,0.22,'B.Cu',57), seg(40.2,139,59.62,139,0.22,'B.Cu',57), seg(59.62,139,59.62,118,0.22,'B.Cu',57),
  seg(59.62,118,59.62,124,0.9,'F.Cu',57), seg(59.62,124,66.5,124,0.9,'F.Cu',57), seg(66.5,124,66.5,126,0.6,'F.Cu',57),
  seg(66.5,124,73.1,124,0.6,'F.Cu',57), seg(73.1,124,73.1,126,0.5,'F.Cu',57),
  seg(73.1,124,73.8,124,0.5,'F.Cu',57), seg(73.8,124,73.8,126.25,0.5,'F.Cu',57),
  seg(73.8,125.25,75.55,125.25,0.35,'F.Cu',57), seg(73.8,125.75,75.55,125.75,0.35,'F.Cu',57), seg(73.8,126.25,75.55,126.25,0.35,'F.Cu',57),
  via(70,130,57), seg(66.5,124,70,130,0.5,'F.Cu',57), seg(70,130,88.9,130,0.5,'B.Cu',57), via(88.9,130,57), seg(88.9,130,88.9,126,0.5,'F.Cu',57),
  seg(88.9,126,87,126,0.5,'F.Cu',57), seg(87,124.25,87,126.25,0.5,'F.Cu',57),
  seg(80.45,125.25,87,125.25,0.35,'F.Cu',57), seg(80.45,125.75,87,125.75,0.35,'F.Cu',57), seg(80.45,126.25,87,126.25,0.35,'F.Cu',57),
  seg(84.6,124.25,87,124.25,0.25,'F.Cu',57),
);

// 60 EN and 61 RT now terminate immediately at their resistors.
r.push(seg(80.45,124.25,82.4,124.25,0.18,'F.Cu',60));
r.push(seg(80.45,123.75,81.2,122.7,0.18,'F.Cu',61), seg(81.2,122.7,82.4,122,0.18,'F.Cu',61));

// R32 ground and C13 ground.
r.push(seg(84.6,122,85.8,121.0,0.25,'F.Cu',3), via(85.8,121.0,3));
r.push(seg(91.1,126,92.5,126,0.35,'F.Cu',3), via(92.5,126,3));

// 63 soft-start escapes straight upward; adjacent top GND pins fan away from it.
r.push(seg(78.25,122.55,78.25,119.5,0.18,'F.Cu',63), seg(78.25,119.5,78.9,118,0.18,'F.Cu',63));
r.push(seg(78.75,122.55,79.7,121.0,0.22,'F.Cu',3), via(79.7,121.0,3), seg(77.75,122.55,76.7,121.0,0.22,'F.Cu',3), via(76.7,121.0,3), seg(81.1,118,82.2,117.0,0.25,'F.Cu',3), via(82.2,117.0,3));

// 62 feedback network.  R34 moved to x=76, keeping its GND pad away from the FB path.
r.push(
  seg(67.1,112,73.1,112,0.18,'F.Cu',62),
  seg(73.1,112,74.9,116,0.18,'F.Cu',62),
  seg(74.9,116,74.9,118.5,0.18,'F.Cu',62), via(74.9,118.5,62),
  seg(74.9,118.5,75.0,121.0,0.18,'B.Cu',62), via(75.0,121.0,62), seg(75.0,121.0,76.75,122.55,0.18,'F.Cu',62),
  seg(77.1,116,78.3,116,0.25,'F.Cu',3), via(78.3,116,3),
);

// Regulated +5 to R33/C15 and BIAS uses a far-right B.Cu trunk, never through C10 or Pi GND pads.
r.push(
  seg(64.9,112,63.5,112,0.22,'F.Cu',2), via(63.5,112,2),
  seg(70.9,112,69.5,112,0.22,'F.Cu',2), via(69.5,112,2),
  seg(63.5,112,63.5,109,0.3,'B.Cu',2), seg(69.5,112,69.5,109,0.3,'B.Cu',2), seg(63.5,109,94,109,0.4,'B.Cu',2), seg(69.5,109,94,109,0.4,'B.Cu',2),
  seg(75.55,123.75,74.2,122.7,0.22,'F.Cu',2), via(74.2,122.7,2), seg(74.2,122.7,94,122.7,0.3,'B.Cu',2),
  seg(94,109,94,138,0.5,'B.Cu',2), via(94,138,2,1.1,0.55),
);

// U5 side GND pins and exposed pads.  Vias are offset away from the VIN rails.
r.push(
  seg(75.55,127.25,74.1,127.25,0.25,'F.Cu',3), via(74.1,127.25,3), seg(75.55,127.75,74.1,128.0,0.25,'F.Cu',3), via(74.1,128.0,3), seg(75.55,128.25,74.1,128.75,0.25,'F.Cu',3), via(74.1,128.75,3),
  seg(80.45,127.25,82.5,127.25,0.25,'F.Cu',3), via(82.5,127.25,3), seg(80.45,127.75,82.5,128.0,0.25,'F.Cu',3), via(82.5,128.0,3), seg(80.45,128.25,82.5,128.75,0.25,'F.Cu',3), via(82.5,128.75,3),
  via(77.3,124.25,3,0.8,0.4), via(78.7,124.25,3,0.8,0.4), via(77.3,126,3,0.8,0.4), via(78.7,126,3,0.8,0.4), via(77.3,127.75,3,0.8,0.4), via(78.7,127.75,3,0.8,0.4),
);

// Local input capacitor grounds.
r.push(seg(69.5,126,68.5,128,0.3,'F.Cu',3), via(68.5,128,3), seg(70.9,126,70.9,128,0.3,'F.Cu',3), via(70.9,128,3));

// 66 compact SW fanout.  Individual pin escapes are narrow until they merge below pin 11.
for (const x of [77.25,77.75,78.25,78.75,79.25]) r.push(seg(x,129.45,x,131.2,0.18,'F.Cu',66));
r.push(seg(77.25,131.2,79.25,131.2,0.8,'F.Cu',66), seg(78.25,131.2,78,135,1.4,'F.Cu',66));

// Output +5 branch to the legacy bus runs along y=137, above the Pi connector, then up the far right edge.
r.push(via(94,138,2,1.1,0.55), seg(94,138,124,137,1.2,'B.Cu',2), seg(124,137,124,92,1.2,'B.Cu',2), seg(124,92,42,92,1.2,'B.Cu',2));

// Output ceramic grounds, with vias offset from their SMD pads.
r.push(seg(100.5,143,100.5,146,0.4,'F.Cu',3), via(100.5,146,3,1.0,0.5), seg(105.5,143,105.5,146,0.4,'F.Cu',3), via(105.5,146,3,1.0,0.5));

// 15 servo signal follows the extreme left edge.  64 servo power goes around the header GND pin.
r.push(seg(8,80,5,82,0.22,'F.Cu',15), via(5,82,15), seg(5,82,5,143,0.22,'B.Cu',15), via(5,143,15), seg(5,143,6,145,0.22,'F.Cu',15));
r.push(
  via(16.2,149,2), seg(16.2,149,16.2,145,0.7,'F.Cu',2),
  seg(19.8,145,19.8,141.5,0.7,'F.Cu',64), seg(19.8,141.5,8.54,141.5,0.7,'F.Cu',64), seg(8.54,141.5,8.54,145,0.7,'F.Cu',64),
  seg(19.8,145,25,145,0.7,'F.Cu',64),
);

// Ground only SMD parts that cannot connect directly to the B.Cu plane through a PTH pad.
r.push(
  seg(29.5,126,31.0,126,0.35,'F.Cu',3), via(31.0,126,3),
  seg(26.4,134,25.0,134,0.25,'F.Cu',3), via(25.0,134,3),
  seg(34.8,121.95,33.5,123.0,0.25,'F.Cu',3), via(33.5,123.0,3),
);

const insert = board.indexOf('(zone');
board = board.slice(0, insert) + r.join('\n  ') + '\n  ' + board.slice(insert);
fs.writeFileSync(boardPath, board);
fs.writeFileSync(encodedPath, zlib.gzipSync(Buffer.from(board), { level: 9 }).toString('base64') + '\n');
console.log(`DRC2 routed ${boardPath}`);
