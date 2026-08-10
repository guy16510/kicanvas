import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const BOARD = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb';
const ENCODED = `${BOARD}.gz.b64`;
execFileSync(process.execPath, ['scripts/route-esp32-carrier-v3-drc3.mjs'], { stdio: 'inherit' });
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
function netId(text) { return Number(text.match(/\(net\s+(\d+)\)/)?.[1] ?? -1); }
function coords(text) {
  return [...text.matchAll(/\((?:start|end|at)\s+([-\d.]+)\s+([-\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
}
function seg(x1,y1,x2,y2,w,layer,net) { return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${w}) (layer "${layer}") (net ${net}))`; }
function via(x,y,net,size=0.9,drill=0.45) { return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`; }

// Rebuild only the routes implicated by the DRC3 report. Component placement and
// the six Hall RC filters are unchanged.
const rebuild = new Set([2,3,54,55,57,65]);
const deletions=[];
for (const token of ['(segment','(via']) {
  for (const e of blocks(token)) {
    const n=netId(e.text);
    if (!rebuild.has(n)) continue;
    const pts=coords(e.text);
    const custom = [54,55,57,65].includes(n) || ([2,3].includes(n) && pts.some(([,y])=>y>=108));
    if (custom) deletions.push(e);
  }
}
for (const e of deletions.sort((a,b)=>b.start-a.start)) board=board.slice(0,e.start)+board.slice(e.end);

const r=[];

// BAT_FUSED stays entirely on F.Cu, including both protection-control branches.
r.push(
  seg(22,118,22,113.5,1.5,'F.Cu',54), seg(22,113.5,51.54,113.5,1.5,'F.Cu',54), seg(51.54,113.5,51.54,118,1.5,'F.Cu',54),
  seg(24.5,113.5,24.5,126,0.7,'F.Cu',54),
  seg(34.8,113.5,34.8,118.05,0.3,'F.Cu',54),
  seg(46.5,113.5,46.5,134,0.3,'F.Cu',54), seg(46.5,134,47.6,134,0.3,'F.Cu',54),
  seg(46.5,132,44,132,0.3,'F.Cu',54), seg(44,132,41.9,130,0.3,'F.Cu',54),
);

// Shutdown remains F.Cu and never shares the BAT_FUSED branch corridor.
r.push(seg(39.2,121.95,45.5,121.95,0.25,'F.Cu',65), seg(45.5,121.95,45.5,130,0.25,'F.Cu',65), seg(45.5,130,44.1,130,0.25,'F.Cu',65));

// Gate crosses the VOUT-sense vertical on F.Cu at y=136, then returns to B.Cu.
// Its Q6 leg uses x=67, clear of C10's PTH pad at x=64,y=132.
r.push(
  seg(39.2,118.05,40,117,0.25,'F.Cu',55), via(40,117,55), seg(40,117,40,136,0.25,'B.Cu',55), via(40,136,55),
  seg(40,136,58,136,0.25,'F.Cu',55), via(58,136,55),
  seg(58,136,67,136,0.25,'B.Cu',55), seg(49,136,49,118,0.25,'B.Cu',55),
  seg(67,136,67,116,0.25,'B.Cu',55), seg(67,116,62.16,116,0.25,'B.Cu',55), seg(62.16,116,62.16,118,0.25,'B.Cu',55)
);

// LTC4367 protected-output sense. First via is well clear of NC pin 6.
r.push(seg(39.2,119.35,41.5,119.35,0.25,'F.Cu',57), via(41.5,119.35,57), seg(41.5,119.35,41.5,145,0.25,'B.Cu',57), seg(41.5,145,59.62,145,0.25,'B.Cu',57), seg(59.62,145,59.62,118,0.35,'B.Cu',57));

// Left-side protected VIN, explicit branch to C10 and a route around C11/C12 GND pads.
r.push(
  seg(59.62,118,59.62,124,0.9,'F.Cu',57), seg(59.62,124,66.5,124,0.9,'F.Cu',57),
  seg(59.62,124,61,128,0.6,'F.Cu',57), seg(61,128,64,132,0.6,'F.Cu',57),
  seg(66.5,124,66.5,126,0.4,'F.Cu',57), seg(66.5,126,66.5,123,0.3,'F.Cu',57), seg(66.5,123,73.1,123,0.3,'F.Cu',57), seg(73.1,123,73.1,126,0.3,'F.Cu',57),
  seg(73.1,126,74.2,126,0.3,'F.Cu',57), seg(74.2,125.25,74.2,126.25,0.3,'F.Cu',57),
  seg(74.2,125.25,75.55,125.25,0.3,'F.Cu',57), seg(74.2,125.75,75.55,125.75,0.3,'F.Cu',57), seg(74.2,126.25,75.55,126.25,0.3,'F.Cu',57)
);

// Right-side VIN feed drops above the FET, traverses B.Cu at y=115, then fans
// out on F.Cu at y=126. This avoids R31's EN pad at y=124.25.
r.push(
  seg(59.62,118,59.62,115,0.7,'B.Cu',57), seg(59.62,115,88.9,115,0.7,'B.Cu',57), seg(88.9,115,88.9,124,0.5,'B.Cu',57), via(88.9,124,57),
  seg(88.9,124,88.9,126,0.35,'F.Cu',57), seg(88.9,126,83,126,0.35,'F.Cu',57),
  seg(84.6,124.25,84.6,126,0.3,'F.Cu',57),
  seg(83,125.25,83,126.25,0.3,'F.Cu',57), seg(80.45,125.25,83,125.25,0.3,'F.Cu',57), seg(80.45,125.75,83,125.75,0.3,'F.Cu',57), seg(80.45,126.25,83,126.25,0.3,'F.Cu',57)
);

// +5 V feedback endpoints join on B.Cu above the new power section.
r.push(
  seg(64.9,112,64.9,110,0.25,'F.Cu',2), via(64.9,110,2), seg(64.9,110,64.9,108,0.3,'B.Cu',2),
  seg(70.9,112,70.9,110,0.25,'F.Cu',2), via(70.9,110,2), seg(70.9,110,70.9,108,0.3,'B.Cu',2),
  seg(64.9,108,94,108,0.4,'B.Cu',2), seg(70.9,108,94,108,0.4,'B.Cu',2), seg(94,108,94,138,0.5,'B.Cu',2), via(94,138,2,1.1,0.55),
  seg(94,138,124,137,1.2,'B.Cu',2), seg(124,137,124,92,1.2,'B.Cu',2), seg(124,92,42,92,1.2,'B.Cu',2)
);

// BIAS uses a separate downward route into the +5 V output pour, so it never
// intersects the right-side protected-VIN feed.
r.push(seg(75.55,123.75,74,123.75,0.25,'F.Cu',2), via(74,123.75,2), seg(74,123.75,74,150,0.3,'B.Cu',2), seg(74,150,90,150,0.5,'B.Cu',2), via(90,150,2,1.1,0.55));

// Explicit 5.1 V high-current trunk from L1 to bulk/ceramic caps and both Pi +5 pads.
r.push(
  seg(78,141,115.2,141,2.5,'F.Cu',2),
  seg(91,141,91,144,1.5,'F.Cu',2),
  seg(97.5,141,97.5,143,1.5,'F.Cu',2),
  seg(102.5,141,102.5,143,1.5,'F.Cu',2),
  seg(111,141,111,143,1.5,'F.Cu',2),
  seg(115.2,141,115.2,143,1.5,'F.Cu',2)
);

// Servo +5 input is explicitly tied to the regulated output on B.Cu below all
// protection and control routing.
r.push(via(16.2,149,2), seg(16.2,149,90,149,0.8,'B.Cu',2), via(90,149,2,1.1,0.55), seg(16.2,149,16.2,145,0.7,'F.Cu',2));

// U5 top grounds route away from SS before the vias, eliminating the NC/SS squeeze.
r.push(
  seg(78.75,122.55,78.75,121.4,0.25,'F.Cu',3), seg(78.75,121.4,79.8,121.4,0.25,'F.Cu',3), seg(79.8,121.4,79.8,120.3,0.25,'F.Cu',3), via(79.8,120.3,3),
  seg(77.75,122.55,77.75,121.4,0.25,'F.Cu',3), seg(77.75,121.4,76.7,121.4,0.25,'F.Cu',3), seg(76.7,121.4,76.7,120.3,0.25,'F.Cu',3), via(76.7,120.3,3)
);

// Side and exposed-pad grounds.
r.push(
  seg(75.55,127.25,74,127.25,0.25,'F.Cu',3), via(74,127.25,3), seg(75.55,127.75,74,128,0.25,'F.Cu',3), via(74,128,3), seg(75.55,128.25,74,128.75,0.25,'F.Cu',3), via(74,128.75,3),
  seg(80.45,127.25,82.5,127.25,0.25,'F.Cu',3), via(82.5,127.25,3), seg(80.45,127.75,82.5,128,0.25,'F.Cu',3), via(82.5,128,3), seg(80.45,128.25,82.5,128.75,0.25,'F.Cu',3), via(82.5,128.75,3)
);
for (const [x,y] of [[77.3,124.25],[78.7,124.25],[77.3,126],[78.7,126],[77.3,127.75],[78.7,127.75]]) r.push(via(x,y,3,0.8,0.4));

// Local grounds.
r.push(
  seg(69.5,126,69.5,129,0.3,'F.Cu',3), via(69.5,129,3), seg(70.9,126,70.9,129,0.3,'F.Cu',3), via(70.9,129,3), seg(91.1,126,91.1,129,0.3,'F.Cu',3), via(91.1,129,3),
  seg(84.6,122,85.8,122,0.25,'F.Cu',3), via(85.8,122,3), seg(77.1,116,78.5,116,0.25,'F.Cu',3), via(78.5,116,3), seg(81.1,118,82.2,118,0.25,'F.Cu',3), via(82.2,118,3),
  seg(29.5,126,31,126,0.35,'F.Cu',3), via(31,126,3), seg(26.9,134,25.5,134,0.25,'F.Cu',3), via(25.5,134,3), seg(34.8,121.95,33.5,123,0.25,'F.Cu',3), via(33.5,123,3),
  seg(100.5,143,100.5,146,0.4,'F.Cu',3), via(100.5,146,3,1,0.5), seg(105.5,143,105.5,146,0.4,'F.Cu',3), via(105.5,146,3,1,0.5)
);

const insert=board.indexOf('(zone');
board=board.slice(0,insert)+r.join('\n  ')+'\n  '+board.slice(insert);
fs.writeFileSync(BOARD,board);
fs.writeFileSync(ENCODED,zlib.gzipSync(Buffer.from(board),{level:9}).toString('base64')+'\n');
console.log(`DRC4 routed ${BOARD}`);
