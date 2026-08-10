import fs from 'node:fs';
import zlib from 'node:zlib';

const fixture = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v2.kicad_pcb.gz.b64';
const encoded = fs.readFileSync(fixture, 'utf8').trim();
const text = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');

function balancedBlockAt(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated block at ${start}`);
}

function blocks(source, token) {
  const out = [];
  let at = 0;
  while ((at = source.indexOf(token, at)) >= 0) {
    out.push(balancedBlockAt(source, at));
    at += token.length;
  }
  return out;
}

const netNames = new Map();
for (const m of text.matchAll(/\(net\s+(\d+)\s+"([^"]+)"\)/g)) {
  netNames.set(Number(m[1]), m[2]);
}

const footprintBlocks = blocks(text, '(footprint');
const footprints = footprintBlocks.map((block) => {
  const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1] ?? '?';
  const value = block.match(/\(property\s+"Value"\s+"([^"]+)"/)?.[1] ?? '?';
  const atMatch = block.match(/^\(footprint[^\n]*\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?\)/);
  const at = atMatch ? [Number(atMatch[1]), Number(atMatch[2]), Number(atMatch[3] ?? 0)] : [];
  const pads = [...block.matchAll(/\(pad\s+"([^"]*)"[\s\S]*?\(net\s+(\d+)\s+"([^"]+)"\)/g)].map((m) => ({
    pad: m[1],
    net: Number(m[2]),
    name: m[3],
  }));
  return { ref, value, at, pads };
});

const edgeCuts = text.split('\n').filter((line) => line.includes('Edge.Cuts'));
const edgePoints = [];
for (const line of edgeCuts) {
  for (const m of line.matchAll(/\((?:start|end|center|mid)\s+([-\d.]+)\s+([-\d.]+)\)/g)) {
    edgePoints.push([Number(m[1]), Number(m[2])]);
  }
}
const bbox = edgePoints.length ? {
  minX: Math.min(...edgePoints.map((p) => p[0])),
  minY: Math.min(...edgePoints.map((p) => p[1])),
  maxX: Math.max(...edgePoints.map((p) => p[0])),
  maxY: Math.max(...edgePoints.map((p) => p[1])),
} : null;

const rawRefs = new Set([
  'R1','R2','R19','R20','R21','R22','R23','R24','R25','R26','R27','R28',
  'C3','J5VIN','JGNDIN','JPIOUT5','JPIOUTG','J_ESP_L','J_ESP_R',
]);
const rawBlocks = {};
for (const block of footprintBlocks) {
  const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1];
  if (ref && rawRefs.has(ref)) rawBlocks[ref] = block;
}

const segments = blocks(text, '(segment').filter((block) =>
  /\(net\s+(?:1|2|3|4|19|20|23|24|27)\)/.test(block)
);

console.log(JSON.stringify({
  bytes: Buffer.byteLength(text),
  bbox,
  edgeCuts,
  netCount: netNames.size,
  nets: [...netNames.entries()].sort((a, b) => a[0] - b[0]),
  footprintOccupancy: footprints.map(({ref, value, at}) => ({ref, value, at})),
  rawBlocks,
  relevantSegments: segments,
}, null, 2));
