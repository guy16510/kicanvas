import fs from "node:fs";

const boardPath =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const board = fs.readFileSync(boardPath, "utf8");
const failures = [];
const footprintCache = new Map();

const requireText = (text, label = text) => {
    if (!board.includes(text)) failures.push(`missing ${label}: ${text}`);
};

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

function footprint(ref) {
    if (footprintCache.has(ref)) return footprintCache.get(ref);
    const marker = `(property "Reference" "${ref}"`;
    const markerIndex = board.indexOf(marker);
    if (markerIndex < 0) {
        failures.push(`missing footprint ${ref}`);
        footprintCache.set(ref, "");
        return "";
    }
    const start = board.lastIndexOf("(footprint", markerIndex);
    const block = board.slice(start, endOfBlock(board, start));
    footprintCache.set(ref, block);
    return block;
}

function requireFootprintText(ref, text, label = text) {
    const block = footprint(ref);
    if (block && !block.includes(text))
        failures.push(`${ref} missing ${label}: ${text}`);
}

function childBlock(parent, token) {
    const start = parent.indexOf(token);
    if (start < 0) return "";
    return parent.slice(start, endOfBlock(parent, start));
}

function requirePadNet(ref, pad, netName) {
    const block = childBlock(footprint(ref), `(pad "${pad}"`);
    if (!block || !block.includes(`"${netName}"`))
        failures.push(`${ref} pad ${pad}: expected ${netName}`);
}

function pointIn(block, token) {
    const match = block.match(
        new RegExp(`\\(${token}\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)`),
    );
    return match ? [Number(match[1]), Number(match[2])] : null;
}

function samePoint(actual, expected) {
    return (
        actual &&
        Math.abs(actual[0] - expected[0]) < 0.0001 &&
        Math.abs(actual[1] - expected[1]) < 0.0001
    );
}

function hasCopper({ type, first, second, layer, netName, netNumber }) {
    const token = `(${type}`;
    let start = 0;
    while ((start = board.indexOf(token, start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        const netMatches =
            block.includes(`(net "${netName}")`) ||
            block.includes(`(net ${netNumber})`);
        const layerMatches = !layer || block.includes(`(layer "${layer}")`);
        const startPoint = pointIn(block, type === "via" ? "at" : "start");
        const endPoint = type === "via" ? null : pointIn(block, "end");
        const geometryMatches =
            type === "via"
                ? samePoint(startPoint, first)
                : (samePoint(startPoint, first) && samePoint(endPoint, second)) ||
                  (samePoint(startPoint, second) && samePoint(endPoint, first));
        if (netMatches && layerMatches && geometryMatches) return true;
        start = end;
    }
    return false;
}

const batteryAdcNet = '"BATTERY_ADC_GPIO34"';
const frontEchoNet = '"FRONT_ECHO_GPIO"';
const uartRxNet = '"UART_RX0_GPIO3"';
const dividerMidNet = '"BATTERY_DIVIDER_MID"';

requireText(batteryAdcNet, "GPIO34 battery ADC net");
requireText(frontEchoNet, "GPIO33 front echo net");
requireText(dividerMidNet, "series-divider midpoint net");

requirePadNet("J_ESP_L", "4", "BATTERY_ADC_GPIO34");
requirePadNet("J_ESP_L", "7", "FRONT_ECHO_GPIO");
requirePadNet("J_ESP_R", "12", "UART_RX0_GPIO3");
requirePadNet("J_RX0", "1", "UART_RX0_GPIO3");
for (const ref of ["R5", "R6"])
    requireFootprintText(ref, frontEchoNet, "front echo moved from GPIO34");

for (const [ref, value, firstNet, secondNet] of [
    [
        "R40",
        "240k_1pct_BAT_ADC_TOP_A",
        '"VIN_PROTECTED"',
        dividerMidNet,
    ],
    ["R41", "240k_1pct_BAT_ADC_TOP_B", dividerMidNet, batteryAdcNet],
    [
        "R42",
        "20k_1pct_BAT_ADC_BOTTOM",
        batteryAdcNet,
        '"GND"',
    ],
    [
        "C20",
        "100nF_BAT_ADC_FILTER",
        batteryAdcNet,
        '"GND"',
    ],
]) {
    requireFootprintText(ref, `(property "Value" "${value}"`, value);
    requireFootprintText(ref, firstNet, `${firstNet} connection`);
    requireFootprintText(ref, secondNet, `${secondNet} connection`);
}

for (const label of [
    "Trashbot v1",
    "Burns Industries | CARRIER rev3",
    "ONBOARD 5V + 24V POWER",
    "36-42V INPUT AT J_BAT ONLY",
    "F ECHO / GPIO33",
    "BAT ADC GPIO34 / 25:1 / 100nF",
])
    requireText(`(gr_text "${label}"`, `silkscreen ${label}`);

for (const obsoleteLabel of [
    "ESP32 ROBOT CARRIER v2",
    "ESP32 ROBOT CARRIER v3",
    "5V INPUT ONLY",
    "5V ONLY - NO 36/42V BATTERY",
]) {
    if (board.includes(`(gr_text "${obsoleteLabel}"`))
        failures.push(`obsolete v2 silkscreen remains: ${obsoleteLabel}`);
}

for (const [route, label] of [
    [
        { type: "segment", first: [88.9, 115], second: [92, 115], layer: "B.Cu", netName: "VIN_PROTECTED", netNumber: 57 },
        "protected-voltage divider branch",
    ],
    [
        { type: "via", first: [92, 115], netName: "VIN_PROTECTED", netNumber: 57 },
        "protected-voltage divider layer transition",
    ],
    [
        { type: "segment", first: [103.1, 116], second: [105.9, 116], layer: "F.Cu", netName: "BATTERY_ADC_GPIO34", netNumber: 6 },
        "divider output route",
    ],
    [
        { type: "via", first: [39, 88], netName: "BATTERY_ADC_GPIO34", netNumber: 6 },
        "battery ADC layer transition",
    ],
    [
        { type: "segment", first: [45, 32.62], second: [50, 32.62], layer: "F.Cu", netName: "BATTERY_ADC_GPIO34", netNumber: 6 },
        "GPIO34 battery ADC route",
    ],
    [
        { type: "segment", first: [37, 40.24], second: [50, 40.24], layer: "F.Cu", netName: "FRONT_ECHO_GPIO", netNumber: 14 },
        "GPIO33 front echo route",
    ],
])
    if (!hasCopper(route)) failures.push(`missing ${label}`);

if (!board.includes("UART_RX0_GPIO3"))
    failures.push("UART0 RX was lost while assigning the battery ADC");

const topOhms = 240_000 * 2;
const bottomOhms = 20_000;
const dividerRatio = bottomOhms / (topOhms + bottomOhms);
const adcAt36V = 36 * dividerRatio;
const adcAt42V = 42 * dividerRatio;
const worstCaseDividerRatio =
    (bottomOhms * 1.01) / (topOhms * 0.99 + bottomOhms * 1.01);
const worstCaseAdcAtTvsClamp = 77.4 * worstCaseDividerRatio;

if (Math.abs(adcAt36V - 1.44) > 0.001)
    failures.push(`36 V must produce 1.44 V, got ${adcAt36V.toFixed(3)} V`);
if (Math.abs(adcAt42V - 1.68) > 0.001)
    failures.push(`42 V must produce 1.68 V, got ${adcAt42V.toFixed(3)} V`);
if (worstCaseAdcAtTvsClamp >= 3.3)
    failures.push(
        `TVS clamp can exceed the 3.3 V ADC rail at 1% tolerance: ${worstCaseAdcAtTvsClamp.toFixed(3)} V`,
    );

if (failures.length) {
    console.error("ESP32 carrier v3 battery-sense contract FAILED");
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exit(1);
}

console.log(
    `ESP32 carrier v3 battery-sense contract PASS: 36 V=${adcAt36V.toFixed(2)} V, 42 V=${adcAt42V.toFixed(2)} V at GPIO34`,
);
