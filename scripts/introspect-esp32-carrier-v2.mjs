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

const footprints = blocks(text, '(footprint').map((block) => {
  const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1] ?? '?';
  const value = block.match(/\(property\s+"Value"\s+"([^"]+)"/)?.[1] ?? '?';
  const at = block.match(/^\(footprint[\s\S]*?\n\s*\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+[-\d.]+)?\)/)?.slice(1, 3).map(Number) ?? [];
  const pads = [...block.matchAll(/\(pad\s+"([^"]*)"[\s\S]*?\(net\s+(\d+)\s+"([^"]+)"\)/g)].map((m) => ({
    pad: m[1],
    net: Number(m[2]),
    name: m[3],
  }));
  return { ref, value, at, pads };
});

const relevant = footprints.filter((f) =>
  /^(R|C|Q|U|L|D|F|J|JP)/.test(f.ref) ||
  /HALL|ECHO|THROTTLE|BRAKE|REVERSE|5V|3V3|GND|ESP|RGB|SERVO/i.test(`${f.ref} ${f.value}`)
);

const edgePoints = [];
for (const line of text.split('\n')) {
  if (!line.includes('Edge.Cuts')) continue;
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

console.log(JSON.stringify({
  bytes: Buffer.byteLength(text),
  bbox,
  netCount: netNames.size,
  nets: [...netNames.entries()].sort((a, b) => a[0] - b[0]),
  footprints: relevant,
}, null, 2));
