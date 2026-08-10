import fs from "node:fs";

const boardPath =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const board = fs.readFileSync(boardPath, "utf8");
const epsilon = 1e-7;

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

function pointIn(block, token) {
    const match = block.match(
        new RegExp(`\\(${token}\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)`),
    );
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

const segments = [];
let segmentStart = 0;
while ((segmentStart = board.indexOf("(segment", segmentStart)) >= 0) {
    const segmentEnd = endOfBlock(board, segmentStart);
    const block = board.slice(segmentStart, segmentEnd);
    const width = block.match(/\(width\s+([-\d.]+)\)/);
    const layer = block.match(/\(layer\s+"([FB]\.Cu)"\)/);
    const net = block.match(/\(net\s+(?:\d+|"([^"]+)")\)/);
    const numericNet = block.match(/\(net\s+(\d+)\)/);
    const a = pointIn(block, "start");
    const b = pointIn(block, "end");
    if (a && b && width && layer && (net || numericNet))
        segments.push({
            index: segments.length,
            a,
            b,
            width: Number(width[1]),
            layer: layer[1],
            net: net?.[1] ?? numericNet[1],
        });
    segmentStart = segmentEnd;
}

function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(value, first, second) {
    return (
        value >= Math.min(first, second) - epsilon &&
        value <= Math.max(first, second) + epsilon
    );
}

function onSegment(a, b, point) {
    return (
        Math.abs(cross(a, b, point)) <= epsilon &&
        between(point.x, a.x, b.x) &&
        between(point.y, a.y, b.y)
    );
}

function intersects(first, second) {
    const c1 = cross(first.a, first.b, second.a);
    const c2 = cross(first.a, first.b, second.b);
    const c3 = cross(second.a, second.b, first.a);
    const c4 = cross(second.a, second.b, first.b);
    if (
        ((c1 > epsilon && c2 < -epsilon) ||
            (c1 < -epsilon && c2 > epsilon)) &&
        ((c3 > epsilon && c4 < -epsilon) ||
            (c3 < -epsilon && c4 > epsilon))
    )
        return true;
    return (
        onSegment(first.a, first.b, second.a) ||
        onSegment(first.a, first.b, second.b) ||
        onSegment(second.a, second.b, first.a) ||
        onSegment(second.a, second.b, first.b)
    );
}

const crossings = [];
function describe(segment) {
    return `segment ${segment.index} net ${segment.net} (${segment.a.x},${segment.a.y})->(${segment.b.x},${segment.b.y})`;
}
for (let first = 0; first < segments.length; first++) {
    for (let second = first + 1; second < segments.length; second++) {
        const a = segments[first];
        const b = segments[second];
        if (a.layer === b.layer && a.net !== b.net && intersects(a, b))
            crossings.push(
                `${a.layer}: ${describe(a)} intersects ${describe(b)}`,
            );
    }
}

if (segments.length < 300) {
    console.error(
        `ESP32 carrier v3 routing geometry FAILED: parsed only ${segments.length} segments`,
    );
    process.exit(1);
}

if (crossings.length) {
    console.error(
        `ESP32 carrier v3 routing geometry FAILED: ${crossings.length} foreign-net centerline crossing(s)`,
    );
    crossings.slice(0, 30).forEach((crossing) => console.error(` - ${crossing}`));
    process.exit(1);
}

console.log(
    `ESP32 carrier v3 routing geometry PASS: ${segments.length} segments, 0 foreign-net same-layer centerline crossings`,
);
