import fs from "node:fs";

const boardPath =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const board = fs.readFileSync(boardPath, "utf8");
const failures = [];
const warnings = [];
const footprintCache = new Map();

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

function requireInFootprint(ref, text, label = text) {
    const block = footprint(ref);
    if (block && !block.includes(text)) failures.push(`${ref}: missing ${label}`);
}

function childBlock(parent, token) {
    const start = parent.indexOf(token);
    if (start < 0) return "";
    return parent.slice(start, endOfBlock(parent, start));
}

function padBlock(ref, pad) {
    return childBlock(footprint(ref), `(pad "${pad}"`);
}

function requirePadNet(ref, pad, netName) {
    const block = padBlock(ref, pad);
    if (!block || !block.includes(`"${netName}"`))
        failures.push(`${ref} pad ${pad}: expected ${netName}`);
}

function requirePadUnconnected(ref, pad) {
    const block = padBlock(ref, pad);
    if (!block || block.includes("(net "))
        failures.push(`${ref} pad ${pad}: expected intentionally unconnected pin`);
}

function requireEsp32HeaderGeometry(ref, x, y) {
    requireFootprintAt(ref, x, y, 0);
    requireInFootprint(
        ref,
        '(property "Value" "ESP32_DEVKIT_30PIN_SOCKET"',
        "30-pin DevKit socket value",
    );
    const block = footprint(ref);
    const pads = [...block.matchAll(/\(pad "(\d+)"\s+thru_hole/g)];
    if (pads.length !== 15)
        failures.push(`${ref}: expected exactly 15 through-hole socket pads`);
    for (let number = 1; number <= 15; number += 1) {
        const pad = padBlock(ref, String(number));
        const expected = [0, (number - 1) * 2.54];
        if (!samePoint(pointIn(pad, "at"), expected))
            failures.push(
                `${ref} pad ${number}: expected local coordinate ${expected.join(",")}`,
            );
        if (
            !pad.includes("thru_hole") ||
            !pad.includes("(size 2 2)") ||
            !pad.includes("(drill 1)")
        )
            failures.push(`${ref} pad ${number}: wrong socket pad/drill geometry`);
    }
}

function requirePart(ref, value, netNames) {
    requireInFootprint(ref, `(property "Value" "${value}"`, `value ${value}`);
    for (const netName of netNames)
        requireInFootprint(ref, `"${netName}"`, `net ${netName}`);
}

function requireMountingHole(ref, expectedPosition) {
    const block = footprint(ref);
    const position = pointIn(block, "at");
    if (!samePoint(position, expectedPosition))
        failures.push(
            `${ref}: expected mounting-hole position ${expectedPosition.join(",")}`,
        );
    if (
        block &&
        !/\(pad\s+"[^"]*"\s+np_thru_hole\s+circle[\s\S]*?\(drill\s+3\.2\)/.test(
            block,
        )
    )
        failures.push(`${ref}: expected a 3.2 mm non-plated M3 hole`);
}

function requireMountingKeepout(ref, expectedPosition, layer) {
    const suffix = layer === "F.Cu" ? "F" : "B";
    const marker = `(name "MOUNT_KEEP_${ref}_${suffix}")`;
    const markerIndex = board.indexOf(marker);
    if (markerIndex < 0) {
        failures.push(`${ref}: missing ${layer} screw-head copper keepout`);
        return;
    }
    const start = board.lastIndexOf("(zone", markerIndex);
    const block = board.slice(start, endOfBlock(board, start));
    if (
        !block.includes(`(layer "${layer}")`) ||
        !block.includes("(tracks not_allowed)") ||
        !block.includes("(vias not_allowed)") ||
        !block.includes("(pads allowed)") ||
        !block.includes("(copperpour not_allowed)")
    )
        failures.push(`${ref}: incomplete ${layer} screw-head keepout rules`);
    const [x, y] = expectedPosition;
    for (const point of [
        [x - 3.5, y - 3.5],
        [x + 3.5, y - 3.5],
        [x + 3.5, y + 3.5],
        [x - 3.5, y + 3.5],
    ])
        if (!block.includes(`(xy ${point[0]} ${point[1]})`))
            failures.push(`${ref}: ${layer} keepout is not 7 mm square`);
}

function requireEsp32AntennaKeepout(layer) {
    const suffix = layer === "F.Cu" ? "F" : "B";
    const marker = `(name "ESP32_ANT_KEEP_${suffix}")`;
    const markerIndex = board.indexOf(marker);
    if (markerIndex < 0) {
        failures.push(`missing ESP32 antenna keepout on ${layer}`);
        return;
    }
    const start = board.lastIndexOf("(zone", markerIndex);
    const block = board.slice(start, endOfBlock(board, start));
    for (const rule of [
        `(layer "${layer}")`,
        "(tracks not_allowed)",
        "(vias not_allowed)",
        "(pads allowed)",
        "(copperpour not_allowed)",
    ])
        if (!block.includes(rule))
            failures.push(`ESP32 antenna ${layer} keepout missing ${rule}`);
    for (const point of [
        [48, 13],
        [77.4, 13],
        [77.4, 24],
        [48, 24],
    ])
        if (!block.includes(`(xy ${point[0]} ${point[1]})`))
            failures.push(`ESP32 antenna ${layer} keepout has wrong boundary`);
}

function padUsers(netName) {
    const users = [];
    let start = 0;
    while ((start = board.indexOf("(footprint", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        const reference = block.match(/\(property "Reference" "([^"]+)"/);
        if (reference) {
            let padStart = 0;
            while ((padStart = block.indexOf("(pad ", padStart)) >= 0) {
                const padEnd = endOfBlock(block, padStart);
                const padBlockText = block.slice(padStart, padEnd);
                const pad = padBlockText.match(/\(pad "([^"]+)"/);
                if (pad && padBlockText.includes(`"${netName}"`))
                    users.push(`${reference[1]}.${pad[1]}`);
                padStart = padEnd;
            }
        }
        start = end;
    }
    return users.sort();
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

function connects(block, first, second) {
    const start = pointIn(block, "start");
    const end = pointIn(block, "end");
    return (
        (samePoint(start, first) && samePoint(end, second)) ||
        (samePoint(start, second) && samePoint(end, first))
    );
}

function hasSegment({ first, second, layer, netName, netNumber, minimumWidth = 0 }) {
    let start = 0;
    while ((start = board.indexOf("(segment", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        const netMatches =
            block.includes(`(net "${netName}")`) ||
            block.includes(`(net ${netNumber})`);
        const width = Number(block.match(/\(width\s+([-\d.]+)\)/)?.[1] ?? 0);
        if (
            netMatches &&
            block.includes(`(layer "${layer}")`) &&
            width >= minimumWidth &&
            connects(block, first, second)
        )
            return true;
        start = end;
    }
    return false;
}

function countViasNear({ netName, netNumber, xMin, xMax, yMin, yMax }) {
    let count = 0;
    let start = 0;
    while ((start = board.indexOf("(via", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        const point = pointIn(block, "at");
        const netMatches =
            block.includes(`(net "${netName}")`) ||
            block.includes(`(net ${netNumber})`);
        if (
            netMatches &&
            point &&
            point[0] >= xMin &&
            point[0] <= xMax &&
            point[1] >= yMin &&
            point[1] <= yMax
        )
            count += 1;
        start = end;
    }
    return count;
}

function requireViaAt(position, netNumber, size, drill) {
    let start = 0;
    while ((start = board.indexOf("(via", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        if (
            samePoint(pointIn(block, "at"), position) &&
            block.includes(`(net ${netNumber})`) &&
            block.includes(`(size ${size})`) &&
            block.includes(`(drill ${drill})`)
        )
            return;
        start = end;
    }
    failures.push(
        `missing ${size}/${drill} mm via on net ${netNumber} at ${position.join(",")}`,
    );
}

function requireFootprintAt(ref, x, y, rotation) {
    const at = pointIn(footprint(ref), "at");
    if (!samePoint(at, [x, y])) failures.push(`${ref}: wrong footprint position`);
    if (rotation === undefined) return;
    const match = footprint(ref).match(
        /\(at\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?(?:\s+(-?\d+(?:\.\d+)?))?/,
    );
    const actualRotation = match?.[1] ? Number(match[1]) : 0;
    const normalizedActual = ((actualRotation % 360) + 360) % 360;
    const normalizedExpected = ((rotation % 360) + 360) % 360;
    if (normalizedActual !== normalizedExpected)
        failures.push(`${ref}: expected rotation ${rotation}`);
}

function requireExclusivePadUsers(netName, expected) {
    const actual = padUsers(netName);
    const wanted = [...expected].sort();
    if (actual.join(",") !== wanted.join(","))
        failures.push(
            `${netName}: expected only ${wanted.join(", ")}; got ${actual.join(", ") || "none"}`,
        );
}

function hasDesignator(csv, ref) {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, "m").test(csv);
}

// Detect reference collisions before any manufacturing output is trusted.
const references = [
    ...board.matchAll(/\(property "Reference" "([^"]+)"/g),
].map((match) => match[1]);
const duplicateReferences = references.filter(
    (ref, index) => references.indexOf(ref) !== index,
);
if (duplicateReferences.length)
    failures.push(
        `duplicate references: ${[...new Set(duplicateReferences)].join(", ")}`,
    );

// A zero-item KiCad ratsnest does not prove that every no-net pad is
// intentional: pads without a net are omitted from that count. Audit those
// pads explicitly. The only functional no-net pads are the DevKit EN socket,
// LTC4367 FAULT output, and the TEN 60WIN Remote/Trim pins. UWS Trim is fitted.
// Mechanical NPTH pads are checked separately.
const allowedNoNetPads = new Set([
    "J_ESP_L.1",
    "U4.6",
    "PS2.3", // Positive-logic Remote On/Off; open circuit means ON
    "PS2.6", // Output Trim; nominal 24.0 V is used
]);
const actualNoNetPads = new Set();
for (const ref of references) {
    const block = footprint(ref);
    let padStart = 0;
    while ((padStart = block.indexOf("(pad ", padStart)) >= 0) {
        const padEnd = endOfBlock(block, padStart);
        const text = block.slice(padStart, padEnd);
        const pad = text.match(/\(pad "([^"]*)"/)?.[1];
        if (
            pad !== undefined &&
            !text.includes("np_thru_hole") &&
            !text.includes("(net ")
        )
            actualNoNetPads.add(`${ref}.${pad}`);
        padStart = padEnd;
    }
}
for (const pad of allowedNoNetPads)
    if (!actualNoNetPads.has(pad))
        failures.push(`${pad}: expected data-sheet-authorized no-net pad`);
for (const pad of actualNoNetPads)
    if (!allowedNoNetPads.has(pad))
        failures.push(`${pad}: unexpected unconnected functional pad`);

// Paste and mask layers must be declared in the board layer table. Pads may
// mention these layers even when the table omits them, but KiCad then silently
// skips the corresponding Gerber files.
for (const definition of [
    '(1 "F.Mask" user)',
    '(3 "B.Mask" user)',
    '(13 "F.Paste" user)',
    '(15 "B.Paste" user)',
])
    if (!board.includes(definition))
        failures.push(`missing fabrication layer definition ${definition}`);

const stackup = childBlock(childBlock(board, "(setup"), "(stackup");
for (const copperLayer of ["F.Cu", "B.Cu"]) {
    const layer = childBlock(stackup, `(layer "${copperLayer}"`);
    if (!layer.includes('(type "copper")') || !layer.includes("(thickness 0.07)"))
        failures.push(`${copperLayer}: stackup must specify 2 oz / 0.07 mm copper`);
}
const dielectric = childBlock(stackup, '(layer "dielectric 1"');
if (
    !dielectric.includes('(type "core")') ||
    !dielectric.includes("(thickness 1.44)") ||
    !dielectric.includes('(material "FR4")')
)
    failures.push("stackup must specify the 1.44 mm two-layer FR4 core");
if (!/\(gr_rect\s+\(start\s+1\s+1\)\s+\(end\s+129\s+190\)/s.test(board))
    failures.push("board outline must be 128 x 189 mm for the dual power-module bay");
if (
    !/\(polygon\s+\(pts\s+\(xy\s+2\s+108\)\s+\(xy\s+128\s+108\)\s+\(xy\s+128\s+189\)\s+\(xy\s+2\s+189\)/s.test(board)
)
    failures.push("lower ground plane must extend through the 24 V power bay");

for (const [text, position] of [
    ["Trashbot v1", [60, 5]],
    ["Burns Industries | CARRIER rev3", [60, 8]],
]) {
    const start = board.indexOf(`(gr_text "${text}"`);
    const block = start < 0 ? "" : board.slice(start, endOfBlock(board, start));
    if (
        !block ||
        !samePoint(pointIn(block, "at"), position) ||
        !block.includes('(layer "F.SilkS")')
    )
        failures.push(`missing front-silkscreen branding: ${text}`);
}

// Four true corner holes sit 4 mm in from the 128 x 189 mm board outline, with
// 7 mm square copper-free screw/washer areas on both layers. H3/H4 remain as
// interior supports for the long sensor/ESP32 section.
for (const [ref, position] of [
    ["H1", [5, 5]],
    ["H2", [125, 5]],
    ["H3", [5, 95]],
    ["H4", [115, 95]],
    ["H5", [5, 186]],
    ["H6", [125, 186]],
])
    requireMountingHole(ref, position);
for (const [ref, position] of [
    ["H1", [5, 5]],
    ["H2", [125, 5]],
    ["H5", [5, 186]],
    ["H6", [125, 186]],
])
    for (const layer of ["F.Cu", "B.Cu"])
        requireMountingKeepout(ref, position, layer);
for (const layer of ["F.Cu", "B.Cu"])
    requireEsp32AntennaKeepout(layer);

// 30-pin ESP32 DevKit V1 socket contract, antenna at the pad-1 end and USB at
// the pad-15 end. These GPIO assignments mirror hoverboard-robot's centralized
// board_config.h except for the documented GPIO34/GPIO33/GPIO12 migration.
const leftHeader = [
    null,
    "L_HALL_C_GPIO",
    "RIGHT_ECHO_GPIO",
    "BATTERY_ADC_GPIO34",
    "LEFT_ECHO_GPIO",
    "R_BRAKE_GPIO",
    "FRONT_ECHO_GPIO",
    "L_THROTTLE_GPIO",
    "R_THROTTLE_GPIO",
    "L_REVERSE_GPIO",
    "R_REVERSE_GPIO",
    "L_BRAKE_GPIO",
    "SERVO_SIG",
    "GND",
    "ESP32_VIN_USB_ISOLATED",
];
const rightHeader = [
    "+3V3",
    "GND",
    "LEFT_TRIG",
    "AUX_GPIO2",
    "MPU_SDA",
    "L_HALL_A_GPIO",
    "L_HALL_B_GPIO",
    "FRONT_TRIG",
    "RIGHT_TRIG",
    "R_HALL_A_GPIO",
    "R_HALL_B_GPIO",
    "UART_RX0_GPIO3",
    "UART_TX0_GPIO1",
    "R_HALL_C_GPIO",
    "MPU_SCL",
];
leftHeader.forEach((net, index) => {
    if (net) requirePadNet("J_ESP_L", index + 1, net);
    else requirePadUnconnected("J_ESP_L", index + 1);
});
rightHeader.forEach((net, index) => requirePadNet("J_ESP_R", index + 1, net));
requireEsp32HeaderGeometry("J_ESP_L", 50, 25);
requireEsp32HeaderGeometry("J_ESP_R", 75.4, 25);
if (Math.abs(75.4 - 50 - 25.4) > 0.0001)
    failures.push("ESP32 socket row spacing must be exactly 25.4 mm");

// The DevKit's UART0 pins are its USB bridge, ROM logging, flashing, and Pi
// command channel. No sensor or actuator may load either net. The carrier's
// breakout pads are passive test points only.
requireExclusivePadUsers("UART_RX0_GPIO3", ["J_ESP_R.12", "J_RX0.1"]);
requireExclusivePadUsers("UART_TX0_GPIO1", ["J_ESP_R.13", "J_TX0.1"]);

// Boot straps may never be driven by external peripherals. GPIO12 is used only
// as the left-brake PhotoMOS input; its 330R LED path and 100k pull-down are
// wholly on the carrier side of the isolation barrier. GPIO2 feeds only the
// high-impedance RGB-buffer input, and its former auxiliary connector is absent.
requirePart("R12", "330R_PHOTOMOS_LED", ["L_BRAKE_GPIO", "L_BRAKE_GATE"]);
requirePart("R11", "100k", ["L_BRAKE_GATE", "GND"]);
requireExclusivePadUsers("L_BRAKE_GPIO", ["J_ESP_L.12", "R12.2"]);
requireExclusivePadUsers("FRONT_ECHO_GPIO", ["J_ESP_L.7", "R5.2", "R6.1"]);
requireExclusivePadUsers("AUX_GPIO2", ["J_ESP_R.4", "U_RGB.2"]);
if (board.includes('(property "Reference" "J_AUX2"'))
    failures.push("GPIO2 boot strap must not have an external auxiliary pad");
if (board.includes('(property "Reference" "J_AUX12"'))
    failures.push("GPIO12 boot strap must not have an external auxiliary pad");

// Espressif specifies USB, 5 V-header, and 3.3 V-header power as mutually
// exclusive. A normally-open jumper makes the safe Pi-over-USB state the PCB
// default; close it only for standalone header-powered operation with USB out.
requirePart("JP_ESP_PWR", "OPEN_WHEN_USB_CONNECTED", [
    "+5V",
    "ESP32_VIN_USB_ISOLATED",
]);
requirePadNet("JP_ESP_PWR", "1", "ESP32_VIN_USB_ISOLATED");
requirePadNet("JP_ESP_PWR", "2", "+5V");
requireExclusivePadUsers("ESP32_VIN_USB_ISOLATED", [
    "JP_ESP_PWR.1",
    "J_ESP_L.15",
]);

requirePart("J_BAT", "36-42V_BATTERY", ["BAT_RAW", "GND"]);
requireFootprintAt("J_BAT", 7, 118, 0);
if (!samePoint(pointIn(padBlock("J_BAT", "1"), "at"), [0, 0]))
    failures.push("J_BAT pad 1 must be the 0 mm battery-positive position");
if (!samePoint(pointIn(padBlock("J_BAT", "2"), "at"), [5, 0]))
    failures.push("J_BAT pad 2 must match the selected terminal's 5.00 mm pitch");
requirePart("D1", "SMCJ48A_TVS", ["BAT_FUSED", "GND"]);
if (!samePoint(pointIn(padBlock("D1", "1"), "at"), [-3.4, 0]))
    failures.push("D1: missing SMC cathode pad");
if (!samePoint(pointIn(padBlock("D1", "2"), "at"), [3.4, 0]))
    failures.push("D1: missing SMC anode pad");

// All three replaceable fuses use the documented Littelfuse 0PTF0015P 5x20 mm
// through-hole holder (250 V, 6.3 A holder rating, 22 mm lead pitch). F1 must
// interrupt the raw battery before the TVS/protection stage; F2 protects only
// the Raspberry Pi branch and must not be bypassed by a direct +5 V pad route;
// F3 protects the 24 V servo branch.
requirePart("F1", "0PTF0015P_5x20_INPUT_5A", ["BAT_RAW", "BAT_FUSED"]);
requireFootprintAt("F1", 16, 108, 0);
requireInFootprint("F1", '(pad "1" thru_hole', "through-hole pad 1");
requireInFootprint("F1", '(pad "2" thru_hole', "through-hole pad 2");
requirePadNet("F1", "1", "BAT_RAW");
requirePadNet("F1", "2", "BAT_FUSED");
requirePart("F2", "0PTF0015P_5x20_PI_5A", [
    "+5V",
    "+5V_PI_FUSED",
]);
requireFootprintAt("F2", 120, 112, 270);
requireInFootprint("F2", '(pad "1" thru_hole', "through-hole pad 1");
requireInFootprint("F2", '(pad "2" thru_hole', "through-hole pad 2");
requirePadNet("F2", "1", "+5V");
requirePadNet("F2", "2", "+5V_PI_FUSED");
for (const ref of ["F1", "F2", "F3"]) {
    if (!samePoint(pointIn(padBlock(ref, "1"), "at"), [0, 0]))
        failures.push(`${ref} pad 1 must be at the holder origin`);
    if (!samePoint(pointIn(padBlock(ref, "2"), "at"), [22, 0]))
        failures.push(`${ref} must preserve the 0PTF0015P 22 mm lead pitch`);
    for (const pad of ["1", "2"])
        if (!padBlock(ref, pad).includes("(drill 1.6)"))
            failures.push(`${ref} pad ${pad} must use the 1.6 mm holder hole`);
}
requirePadNet("J_PI_PWR", "1", "+5V_PI_FUSED");
requirePadNet("J_PI_PWR", "2", "+5V_PI_FUSED");
requirePadNet("J_PI_PWR", "3", "GND");
requirePadNet("J_PI_PWR", "4", "GND");
for (const [pad, expected] of [
    ["1", [0, 0]],
    ["2", [4.2, 0]],
    ["3", [0, 5.5]],
    ["4", [4.2, 5.5]],
])
    if (!samePoint(pointIn(padBlock("J_PI_PWR", pad), "at"), expected))
        failures.push(
            `J_PI_PWR pad ${pad}: expected Mini-Fit Jr coordinate ${expected.join(",")}`,
        );
requireExclusivePadUsers("+5V_PI_FUSED", [
    "F2.2",
    "J_PI_PWR.1",
    "J_PI_PWR.2",
]);
for (const [route, label] of [
    [
        { first: [7, 108], second: [16, 108], layer: "F.Cu", netName: "BAT_RAW", netNumber: 53 },
        "battery connector to F1 input",
    ],
    [
        { first: [38, 108], second: [51.54, 108], layer: "B.Cu", netName: "BAT_FUSED", netNumber: 54 },
        "F1 output to protected-input bus",
    ],
    [
        { first: [124, 112], second: [120, 112], layer: "B.Cu", netName: "+5V", netNumber: 2, minimumWidth: 2.5 },
        "main 5 V rail to F2 input",
    ],
    [
        { first: [120, 134], second: [120, 143], layer: "F.Cu", netName: "+5V_PI_FUSED", netNumber: 70, minimumWidth: 2.5 },
        "F2 output to Pi connector",
    ],
]) {
    if (!hasSegment(route)) failures.push(`missing ${label} route`);
}
for (const [route, label] of [
    [
        { first: [96.47, 141.62], second: [96.47, 152], layer: "B.Cu", netName: "+5V", netNumber: 2, minimumWidth: 2.5 },
        "high-current module-to-F2 rail",
    ],
    [
        { first: [124, 152], second: [124, 92], layer: "B.Cu", netName: "+5V", netNumber: 2, minimumWidth: 2.5 },
        "high-current vertical 5 V rail",
    ],
    [
        { first: [120, 143], second: [115.2, 143], layer: "F.Cu", netName: "+5V_PI_FUSED", netNumber: 70, minimumWidth: 2.5 },
        "fused Pi positive rail",
    ],
    [
        { first: [18, 179], second: [18, 151], layer: "B.Cu", netName: "+24V_SERVO_FUSED", netNumber: 80, minimumWidth: 1.5 },
        "24 V fused servo trunk",
    ],
    [
        { first: [19.8, 141.5], second: [8.54, 141.5], layer: "F.Cu", netName: "+24V_SERVO", netNumber: 64, minimumWidth: 1.2 },
        "24 V servo filtered output rail",
    ],
    [
        { first: [88, 92], second: [88, 103], layer: "B.Cu", netName: "+5V", netNumber: 2, minimumWidth: 1.0 },
        "RGB 5 V output rail",
    ],
]) {
    if (!hasSegment(route)) failures.push(`missing ${label} at required width`);
}
for (const unsafeBypass of [
    { first: [111, 138], second: [111, 143], layer: "F.Cu", netName: "+5V", netNumber: 2 },
    { first: [115.2, 138], second: [115.2, 143], layer: "F.Cu", netName: "+5V", netNumber: 2 },
]) {
    if (hasSegment(unsafeBypass))
        failures.push("direct +5 V route bypasses the Raspberry Pi fuse");
}

// The exact WinXu controllers accept approximately 1.1-4.2 V throttle. The
// ESP32 DACs cannot reach 4.2 V directly, so a 5 V RRIO dual op amp raises both
// filtered DAC channels by 1 + 6.04k/22k. Pull-downs exist on both sides of
// each amplifier and the 330R output resistors limit wiring-fault current.
requirePart("R13", "1k", ["L_THROTTLE_FILTERED", "L_THROTTLE_GPIO"]);
requirePart("R14", "1k", ["R_THROTTLE_FILTERED", "R_THROTTLE_GPIO"]);
requirePart("R29", "100k_THROTTLE_INPUT_FAILSAFE", ["L_THROTTLE_FILTERED", "GND"]);
requirePart("R30", "100k_THROTTLE_INPUT_FAILSAFE", ["R_THROTTLE_FILTERED", "GND"]);
requirePart("U10", "TLV9002IDR_DUAL_THROTTLE_RRIO", [
    "+5V",
    "GND",
    "L_THROTTLE_FILTERED",
    "L_THROTTLE_AMP",
    "L_THROTTLE_FEEDBACK",
    "R_THROTTLE_FILTERED",
    "R_THROTTLE_AMP",
    "R_THROTTLE_FEEDBACK",
]);
for (const [pad, net] of [
    ["1", "L_THROTTLE_AMP"],
    ["2", "L_THROTTLE_FEEDBACK"],
    ["3", "L_THROTTLE_FILTERED"],
    ["4", "GND"],
    ["5", "R_THROTTLE_FILTERED"],
    ["6", "R_THROTTLE_FEEDBACK"],
    ["7", "R_THROTTLE_AMP"],
    ["8", "+5V"],
])
    requirePadNet("U10", pad, net);
requireFootprintAt("U10", 62.7, 75);
requirePart("C27", "100nF_THROTTLE_BYPASS", ["+5V", "GND"]);
for (const [ref, value, nets] of [
    ["R45", "330R_L_THROTTLE_OUTPUT", ["L_THROTTLE_OUT", "L_THROTTLE_AMP"]],
    ["R46", "6.04k_1pct_L_THROTTLE_GAIN", ["L_THROTTLE_OUT", "L_THROTTLE_FEEDBACK"]],
    ["R47", "22k_1pct_L_THROTTLE_GAIN", ["L_THROTTLE_FEEDBACK", "GND"]],
    ["R48", "330R_R_THROTTLE_OUTPUT", ["R_THROTTLE_OUT", "R_THROTTLE_AMP"]],
    ["R49", "6.04k_1pct_R_THROTTLE_GAIN", ["R_THROTTLE_OUT", "R_THROTTLE_FEEDBACK"]],
    ["R50", "22k_1pct_R_THROTTLE_GAIN", ["R_THROTTLE_FEEDBACK", "GND"]],
    ["R51", "10k_L_THROTTLE_OUTPUT_FAILSAFE", ["L_THROTTLE_OUT", "GND"]],
    ["R52", "10k_R_THROTTLE_OUTPUT_FAILSAFE", ["R_THROTTLE_OUT", "GND"]],
])
    requirePart(ref, value, nets);
requireExclusivePadUsers("L_THROTTLE_FILTERED", ["C1.1", "R13.1", "R29.1", "U10.3"]);
requireExclusivePadUsers("L_THROTTLE_AMP", ["R45.2", "U10.1"]);
requireExclusivePadUsers("L_THROTTLE_FEEDBACK", ["R46.2", "R47.2", "U10.2"]);
requireExclusivePadUsers("L_THROTTLE_OUT", ["J_LTHR.1", "R45.1", "R46.1", "R51.1"]);
requireExclusivePadUsers("R_THROTTLE_FILTERED", ["C2.1", "R14.1", "R30.2", "U10.5"]);
requireExclusivePadUsers("R_THROTTLE_AMP", ["R48.1", "U10.7"]);
requireExclusivePadUsers("R_THROTTLE_FEEDBACK", ["R49.1", "R50.2", "U10.6"]);
requireExclusivePadUsers("R_THROTTLE_OUT", ["J_RTHR.1", "R48.2", "R49.2", "R52.2"]);
for (const [ref, position] of [
    ["J_LCTRL_GND", [12, 52]],
    ["J_RCTRL_GND", [12, 58]],
]) {
    requireFootprintAt(ref, ...position);
    requirePadNet(ref, "1", "GND");
}
const throttleGain = 1 + 6_040 / 22_000;
const throttleMaximum = 3.3 * throttleGain;
if (throttleMaximum < 4.18 || throttleMaximum > 4.23)
    failures.push(`throttle amplifier must reach about 4.2 V, got ${throttleMaximum.toFixed(3)} V`);

// Each brake/reverse command presents a genuinely floating two-wire contact to
// the motor controller. AQY212SX is rated 60 V / 0.5 A with 1.5 kVrms I/O
// isolation; the series resistor supplies at least 5 mA at the ESP32's minimum
// normal 3.3 V high even with the PhotoMOS LED at its 1.5 V maximum drop.
for (const {
    relay,
    resistor,
    jumper,
    connector,
    gpioNet,
    gateNet,
    contactA,
    switchedA,
    contactB,
} of [
    {
        relay: "U6", resistor: "R10", jumper: "JP_RBRK", connector: "J_RBRK",
        gpioNet: "R_BRAKE_GPIO", gateNet: "R_BRAKE_GATE",
        contactA: "R_BRAKE_CONTACT_A", switchedA: "R_BRAKE_CONTACT_A_SW",
        contactB: "R_BRAKE_CONTACT_B",
    },
    {
        relay: "U7", resistor: "R12", jumper: "JP_LBRK", connector: "J_LBRK",
        gpioNet: "L_BRAKE_GPIO", gateNet: "L_BRAKE_GATE",
        contactA: "L_BRAKE_CONTACT_A", switchedA: "L_BRAKE_CONTACT_A_SW",
        contactB: "L_BRAKE_CONTACT_B",
    },
    {
        relay: "U8", resistor: "R16", jumper: "JP_LREV", connector: "J_LREV",
        gpioNet: "L_REVERSE_GPIO", gateNet: "L_REVERSE_GATE",
        contactA: "L_REVERSE_CONTACT_A", switchedA: "L_REVERSE_CONTACT_A_SW",
        contactB: "L_REVERSE_CONTACT_B",
    },
    {
        relay: "U9", resistor: "R18", jumper: "JP_RREV", connector: "J_RREV",
        gpioNet: "R_REVERSE_GPIO", gateNet: "R_REVERSE_GATE",
        contactA: "R_REVERSE_CONTACT_A", switchedA: "R_REVERSE_CONTACT_A_SW",
        contactB: "R_REVERSE_CONTACT_B",
    },
]) {
    requirePart(resistor, "330R_PHOTOMOS_LED", [gpioNet, gateNet]);
    requirePart(relay, "AQY212SX_60V_0.5A_PHOTOMOS", [
        gateNet,
        "GND",
        switchedA,
        contactB,
    ]);
    requirePadNet(relay, "1", gateNet);
    requirePadNet(relay, "2", "GND");
    requirePadNet(relay, "3", switchedA);
    requirePadNet(relay, "4", contactB);
    requirePadNet(jumper, "1", contactA);
    requirePadNet(jumper, "2", switchedA);
    requirePadNet(connector, "1", contactA);
    requirePadNet(connector, "2", contactB);
    requireExclusivePadUsers(contactA, [`${connector}.1`, `${jumper}.1`]);
    requireExclusivePadUsers(switchedA, [`${jumper}.2`, `${relay}.3`]);
    requireExclusivePadUsers(contactB, [`${connector}.2`, `${relay}.4`]);
    for (const layerSuffix of ["F", "B"])
        if (!board.includes(`(name "ISO_MOAT_${relay}_${layerSuffix}")`))
            failures.push(`${relay}: missing ${layerSuffix}.Cu isolation moat`);
}
for (const ref of ["Q1", "Q2", "Q3", "Q4"])
    if (references.includes(ref))
        failures.push(`${ref}: grounded open-drain stage must be replaced by PhotoMOS`);
const photoMosCurrentWorstMilliAmps = ((3.3 - 1.5) / 330) * 1000;
if (photoMosCurrentWorstMilliAmps < 5 || photoMosCurrentWorstMilliAmps > 12)
    failures.push(
        `PhotoMOS LED worst-case current is ${photoMosCurrentWorstMilliAmps.toFixed(2)} mA`,
    );

// Every Hall tap has its own small local RC filter: 10k series, 12k to ground,
// and 10nF from the divided GPIO node to ground. The 12k lower leg leaves
// useful margin below the ESP32's 3.3 V rail if a nominal 5 V Hall line runs
// high; 10nF suppresses motor-edge noise without materially delaying commutation
// state changes at hoverboard wheel speeds.
for (const [top, bottom, capacitor, gpioNet] of [
    ["R1", "R2", "C4", "L_HALL_C_GPIO"],
    ["R19", "R20", "C5", "L_HALL_A_GPIO"],
    ["R21", "R22", "C6", "L_HALL_B_GPIO"],
    ["R23", "R24", "C7", "R_HALL_A_GPIO"],
    ["R25", "R26", "C8", "R_HALL_B_GPIO"],
    ["R27", "R28", "C9", "R_HALL_C_GPIO"],
]) {
    requireInFootprint(top, '(property "Value" "10k"', "10k Hall top");
    requireInFootprint(
        bottom,
        '(property "Value" "12k_1pct_HALL"',
        "12k Hall bottom",
    );
    requireInFootprint(
        capacitor,
        '(property "Value" "10nF_HALL_RC"',
        "10nF Hall filter",
    );
    requirePart(capacitor, "10nF_HALL_RC", [gpioNet, "GND"]);
}
const worstHallVolts =
    5.5 * ((12_000 * 1.01) / (10_000 * 0.99 + 12_000 * 1.01));
if (worstHallVolts >= 3.3)
    failures.push(
        `Hall divider tolerance can exceed 3.3 V: ${worstHallVolts.toFixed(3)} V`,
    );

// JSN-SR04T / AJ-SR04M echo lines use the linked project's 10k/15k divider,
// keeping a 5.25 V worst-case echo below 3.2 V with 1% resistor tolerance.
for (const [top, bottom] of [
    ["R3", "R4"],
    ["R5", "R6"],
    ["R7", "R8"],
]) {
    requireInFootprint(top, '(property "Value" "10k"', "10k echo top");
    requireInFootprint(
        bottom,
        '(property "Value" "15k_1pct_ULTRASONIC"',
        "15k echo bottom",
    );
}
const worstEchoVolts =
    5.25 * ((15_000 * 1.01) / (10_000 * 0.99 + 15_000 * 1.01));
if (worstEchoVolts >= 3.3)
    failures.push(
        `ultrasonic divider tolerance can exceed 3.3 V: ${worstEchoVolts.toFixed(3)} V`,
    );

// JSN-SR04T and AJ-SR04M are 5 V ultrasonic modules. AJ-SR04M documents a
// trigger-high threshold as high as 0.7*VCC, so a direct 3.3 V GPIO is not a
// guaranteed high at the carrier's 5.0 V rail. Each trigger therefore uses a
// 74AHCT1G125 (TTL-compatible input) and local 100 nF bypass capacitor.
for (const [buffer, capacitor, gpioNet, outputNet, connector, headerPad] of [
    ["U_TRIG_L", "C21", "LEFT_TRIG", "LEFT_TRIG_5V", "J_LTRIG", 3],
    ["U_TRIG_F", "C22", "FRONT_TRIG", "FRONT_TRIG_5V", "J_FTRIG", 8],
    ["U_TRIG_R", "C23", "RIGHT_TRIG", "RIGHT_TRIG_5V", "J_RTRIG", 9],
]) {
    requirePart(buffer, "74AHCT1G125_TRIGGER_3V3_TO_5V", [
        gpioNet,
        outputNet,
        "+5V",
        "GND",
    ]);
    requirePadNet(buffer, "1", "GND");
    requirePadNet(buffer, "2", gpioNet);
    requirePadNet(buffer, "3", "GND");
    requirePadNet(buffer, "4", outputNet);
    requirePadNet(buffer, "5", "+5V");
    requirePart(capacitor, "100nF_TRIGGER_BYPASS", ["+5V", "GND"]);
    requirePadNet(connector, "1", outputNet);
    requireExclusivePadUsers(gpioNet, [`${buffer}.2`, `J_ESP_R.${headerPad}`]);
    requireExclusivePadUsers(outputNet, [`${buffer}.4`, `${connector}.1`]);
}
for (const label of [
    "L TRIG / GPIO15 / 5V",
    "F TRIG / GPIO5 / 5V",
    "R TRIG / GPIO18 / 5V",
]) {
    if (!board.includes(`(gr_text "${label}"`))
        failures.push(`missing ultrasonic trigger-buffer label: ${label}`);
}
for (const label of [
    "HALL 10k/12k + 10nF | ECHO 10k/15k",
    "RGB: ONE DATA / GPIO2 > 5V BUF",
]) {
    if (!board.includes(`(gr_text "${label}"`))
        failures.push(`missing interface label: ${label}`);
}

// Addressable RGB is one buffered data line, not three PWM color channels.
// A connector-side series resistor damps the cable edge, while local bulk
// capacitance supplies pixel turn-on transients without pulling the 5 V rail
// through a long narrow branch.
requirePart("U_RGB", "74AHCT1G125", ["AUX_GPIO2", "RGB_DATA_5V", "+5V", "GND"]);
requirePadNet("U_RGB", "1", "GND");
requirePadNet("U_RGB", "2", "AUX_GPIO2");
requirePadNet("U_RGB", "3", "GND");
requirePadNet("U_RGB", "4", "RGB_DATA_5V");
requirePadNet("U_RGB", "5", "+5V");
requirePart("C3", "100nF", ["+5V", "GND"]);
requireFootprintAt("C3", 72.5, 100.5, 0);
requirePart("R43", "330R_RGB_DATA", ["RGB_DATA_5V", "RGB_DATA_OUT"]);
requireFootprintAt("R43", 90, 105.5, 0);
requirePart("C24", "1000uF_10V_RGB_BULK", ["+5V", "GND"]);
requireFootprintAt("C24", 80, 102.5, 0);
requireInFootprint("C24", '(pad "1" thru_hole', "through-hole positive pad");
if (!board.includes('(gr_text "+"'))
    failures.push("missing RGB bulk-capacitor polarity mark");
requireInFootprint("JP4G", "(zone_connect 2)", "solid ground-zone connection");
requirePadNet("J_RGB_5V", "1", "+5V");
requirePadNet("J_RGB_DATA", "1", "RGB_DATA_OUT");
requirePadNet("J_RGB_GND", "1", "GND");
requireExclusivePadUsers("RGB_DATA_5V", ["R43.1", "U_RGB.4"]);
requireExclusivePadUsers("RGB_DATA_OUT", ["J_RGB_DATA.1", "R43.2"]);

// LTC4367 pinout and a 30 V UV-rising / 50 V OV three-resistor window. The
// final routing stage replaces the generator's early draft with this ordered
// chain: VIN -> 2x2.45M -> UV -> 37.4k -> OV -> 49.9k -> GND.
requireFootprintAt("U4", 37, 120);
if (
    !samePoint(pointIn(padBlock("U4", "1"), "at"), [-2.2, -0.975]) ||
    !samePoint(pointIn(padBlock("U4", "1"), "size"), [1.35, 0.45])
)
    failures.push("U4: missing standard MSOP-8 0.65 mm land geometry");
if (!samePoint(pointIn(padBlock("U4", "2"), "at"), [-2.2, -0.325]))
    failures.push("U4: missing standard MSOP-8 0.65 mm pitch");
for (const [pad, net] of [
    ["1", "BAT_FUSED"],
    ["2", "UV_SENSE"],
    ["3", "OV_SENSE"],
    ["4", "GND"],
    ["5", "PROTECT_SHDN"],
    ["7", "VIN_PROTECTED"],
    ["8", "PROTECT_GATE"],
])
    requirePadNet("U4", pad, net);
requirePart("R38", "2.45M_1pct_UV_TOP_A", ["BAT_FUSED", "UV_LOW_MID"]);
requirePart("R37", "2.45M_1pct_UV_TOP_B", ["UV_LOW_MID", "UV_SENSE"]);
requirePart("R36", "37.4k_1pct_UV_OV", ["UV_SENSE", "OV_SENSE"]);
requirePart("R35", "49.9k_1pct_OV_BOTTOM", ["OV_SENSE", "GND"]);

const uvTop = 2_450_000 * 2;
const uvMiddle = 37_400;
const ovBottom = 49_900;
const windowTotal = uvTop + uvMiddle + ovBottom;
const uvTrip = (0.525 * windowTotal) / (uvMiddle + ovBottom);
const ovTrip = (0.5 * windowTotal) / ovBottom;
if (uvTrip < 29 || uvTrip > 31)
    failures.push(`LTC4367 UV trip must be near 30 V, got ${uvTrip.toFixed(2)} V`);
if (ovTrip < 49 || ovTrip > 51)
    failures.push(`LTC4367 OV trip must be near 50 V, got ${ovTrip.toFixed(2)} V`);

// Murata UWS-5/10-Q48N-C manufacturer pin contract. The module accepts 18-75
// V, is trimmed to nominal 5.10 V, is rated 8 A at 18-36 V and nominally
// 10 A at 36-75 V, and
// uses the exact through-hole DOSA pattern on data-sheet page 18. Negative
// logic On/Off is tied to -VIN; both sense pins are tied locally because remote
// sensing is not used. Input and output returns are intentionally bonded.
requireFootprintAt("PS1", 82.5, 134);
if (!/\(fp_rect[\s\S]*?\(start\s+-16\.75\s+-11\.7\)[\s\S]*?\(end\s+16\.75\s+11\.7\)[\s\S]*?\(layer\s+"F\.CrtYd"\)/.test(footprint("PS1")))
    failures.push("PS1: missing 33.0 x 22.9 mm body courtyard");
for (const [pad, position, hole] of [
    ["1", [-13.97, 7.62], 1.4],
    ["2", [-13.97, 0], 1.4],
    ["3", [-13.97, -7.62], 1.4],
    ["4", [13.97, -7.62], 1.9],
    ["5", [13.97, -3.81], 1.4],
    ["6", [13.97, 0], 1.4],
    ["7", [13.97, 3.81], 1.4],
    ["8", [13.97, 7.62], 1.9],
]) {
    const padText = padBlock("PS1", pad);
    if (!samePoint(pointIn(padText, "at"), position))
        failures.push(`PS1 pad ${pad}: wrong DOSA coordinate`);
    if (!padText.includes(`(drill ${hole})`))
        failures.push(`PS1 pad ${pad}: expected ${hole} mm finished hole`);
}
requirePadNet("PS1", "1", "VIN_PROTECTED");
for (const pad of ["2", "3", "4", "5"]) requirePadNet("PS1", pad, "GND");
requirePadNet("PS1", "6", "UWS_TRIM");
for (const pad of ["7", "8"]) requirePadNet("PS1", pad, "+5V");
requirePart("R44", "806k_1pct_UWS_TRIM_5V1", ["UWS_TRIM", "GND"]);
requireExclusivePadUsers("UWS_TRIM", ["PS1.6", "R44.1"]);
const uwsNominal = 5;
const uwsTrimKohm = 806;
const uwsA = (5.11 * uwsNominal) / 1.225;
const uwsTrimPercent = (100 * uwsA - 511) / (uwsTrimKohm + 10.22 - uwsA);
const uwsTrimmedVoltage = uwsNominal * (1 + uwsTrimPercent / 100);
if (uwsTrimmedVoltage < 5.08 || uwsTrimmedVoltage > 5.12)
    failures.push(`UWS trim must produce about 5.10 V, got ${uwsTrimmedVoltage.toFixed(3)} V`);
const uwsHighLineCurrentAtRatedPower = 50 / uwsTrimmedVoltage;
if (uwsHighLineCurrentAtRatedPower < 9.7 || uwsHighLineCurrentAtRatedPower > 9.9)
    failures.push(`UWS 50 W trim derating calculation is unexpected: ${uwsHighLineCurrentAtRatedPower.toFixed(2)} A`);
requirePart("C11", "4.7uF_100V_X7R", ["VIN_PROTECTED", "GND"]);
requireInFootprint("C11", "(size 1.15 2.7)", "1210 land geometry");
requireFootprintAt("C11", 62, 126);
requirePart("C10", "22uF_100V_INPUT_BULK", ["VIN_PROTECTED", "GND"]);
requireFootprintAt("C10", 58, 138);
requirePart("C18", "1uF_50V_X7R_MODULE_OUTPUT", ["+5V", "GND"]);
requirePart("C16", "470uF_10V_OUTPUT", ["+5V", "GND"]);
requireFootprintAt("C16", 104, 144);
requireFootprintAt("C18", 106, 138);
requirePart("C19", "470uF_50V_SERVO_BULK", ["+24V_SERVO", "GND"]);
requireInFootprint("C19", 'footprint "CP_Radial_D12.5_P5"', "12.5 mm / 5 mm 50 V capacitor footprint");
requirePart("R53", "100k_SERVO_SIGNAL_FAILSAFE", ["SERVO_SIG", "GND"]);
requireFootprintAt("R53", 48, 66);
requirePart("D2", "SMBJ26A_26V_SERVO_TVS", ["+24V_SERVO", "GND"]);
requireFootprintAt("D2", 39, 145);
requirePadNet("D2", "1", "+24V_SERVO");
requirePadNet("D2", "2", "GND");
requirePart("FB2", "6A_120R_FERRITE_SERVO", ["+24V_SERVO_FUSED", "+24V_SERVO"]);
requireInFootprint("C18", "(size 1.15 2.7)", "1210 land geometry");
for (const [route, label] of [
    [{ first: [68.53, 134], second: [68.53, 126.38], layer: "F.Cu", netName: "GND", netNumber: 3, minimumWidth: 0.8 }, "negative-logic enable tie"],
    [{ first: [96.47, 130.19], second: [96.47, 126.38], layer: "F.Cu", netName: "GND", netNumber: 3, minimumWidth: 0.8 }, "negative remote-sense tie"],
    [{ first: [96.47, 137.81], second: [96.47, 141.62], layer: "F.Cu", netName: "+5V", netNumber: 2, minimumWidth: 0.8 }, "positive remote-sense tie"],
    [{ first: [58, 141.62], second: [68.53, 141.62], layer: "B.Cu", netName: "VIN_PROTECTED", netNumber: 57, minimumWidth: 1.5 }, "protected input into module"],
])
    if (!hasSegment(route)) failures.push(`missing ${label}`);

// The servo has its own active-production 24 V converter, independent of the
// Pi/RGB 5 V rail. TEN 60-4815WIN is rated 18-75 V input and 24 V / 2.5 A.
// Its positive-logic Remote pin is intentionally open (ON) and Trim is open.
requireFootprintAt("PS2", 82, 170);
if (!/\(fp_rect[\s\S]*?\(start\s+-25\.65\s+-12\.95\)[\s\S]*?\(end\s+25\.65\s+12\.95\)[\s\S]*?\(layer\s+"F\.CrtYd"\)/.test(footprint("PS2")))
    failures.push("PS2: missing 50.8 x 25.4 mm body courtyard");
for (const [pad, position] of [
    ["1", [-22.86, -10.16]],
    ["2", [-22.86, 0]],
    ["3", [-22.86, 10.16]],
    ["4", [22.86, -10.16]],
    ["5", [22.86, 0]],
    ["6", [22.86, 10.16]],
]) {
    const padText = padBlock("PS2", pad);
    if (!samePoint(pointIn(padText, "at"), position))
        failures.push(`PS2 pad ${pad}: wrong TEN 60WIN coordinate`);
    if (!padText.includes("(drill 1.3)"))
        failures.push(`PS2 pad ${pad}: expected 1.3 mm finished hole`);
}
requirePadNet("PS2", "1", "VIN_PROTECTED");
requirePadNet("PS2", "2", "GND");
requirePadUnconnected("PS2", "3");
requirePadNet("PS2", "4", "+24V");
requirePadNet("PS2", "5", "GND");
requirePadUnconnected("PS2", "6");
requirePart("C26", "22uF_100V_24V_MODULE_INPUT", ["VIN_PROTECTED", "GND"]);
requireFootprintAt("C26", 48, 160);
requirePart("C25", "1uF_50V_X7R_24V_MODULE_OUTPUT", ["+24V", "GND"]);
requireFootprintAt("C25", 112, 164);
requirePart("F3", "0PTF0015P_5x20_SERVO_3.15A", ["+24V", "+24V_SERVO_FUSED"]);
requireFootprintAt("F3", 120, 157, 270);
requirePadNet("F3", "1", "+24V");
requirePadNet("F3", "2", "+24V_SERVO_FUSED");
requirePart("J_24V_AUX", "24V_SERVO_AUX_2.5A_SHARED", ["+24V_SERVO", "GND"]);
requireFootprintAt("J_24V_AUX", 35, 174);
requirePadNet("J_SERVO", "2", "+24V_SERVO");
requireExclusivePadUsers("+24V", ["C25.1", "F3.1", "PS2.4"]);
requireExclusivePadUsers("+24V_SERVO_FUSED", ["F3.2", "FB2.1"]);
requireExclusivePadUsers("+24V_SERVO", ["C19.1", "D2.1", "FB2.2", "J_24V_AUX.1", "J_SERVO.2"]);
for (const [route, label] of [
    [{ first: [59.62, 145], second: [59.14, 159.84], layer: "B.Cu", netName: "VIN_PROTECTED", netNumber: 57, minimumWidth: 2.0 }, "24 V module input"],
    [{ first: [104.86, 159.84], second: [120, 157], layer: "F.Cu", netName: "+24V", netNumber: 79, minimumWidth: 1.5 }, "24 V module output to F3"],
    [{ first: [120, 179], second: [114, 187.5], layer: "B.Cu", netName: "+24V_SERVO_FUSED", netNumber: 80, minimumWidth: 1.5 }, "F3 output trunk"],
])
    if (!hasSegment(route)) failures.push(`missing ${label}`);

for (const ref of ["C16", "C18", "J_PI_PWR", "FB2", "C19", "J_SERVO", "PS2", "F3"])
    footprint(ref);

warnings.push(
    "GPIO12-GPIO15 are allocated to robot functions, so classic four-wire JTAG is unavailable; UART0 USB flashing/logging remains reserved on GPIO1/GPIO3",
);

const assemblyBomPath =
    "fixtures/esp32_robot_carrier/BOM_JLCPCB.csv";
if (fs.existsSync(assemblyBomPath)) {
    const assemblyBom = fs.readFileSync(assemblyBomPath, "utf8");
    for (const marker of [
        "PS1",
        "U4",
        "R40",
        "R42",
        "C20",
        "C24",
        "C27",
        "D2",
        "R43",
        "R44",
        "R52",
        "U10",
        "U_TRIG_L",
        "U_TRIG_F",
        "U_TRIG_R",
        "R2",
        "R28",
        "C4",
        "C9",
        "U6",
        "U9",
        "J_LBRK",
        "J_RREV",
        "F1",
        "F2",
    ]) {
        if (!new RegExp(`(^|[,\"]|\\s)${marker}([,\"]|\\s|$)`, "m").test(assemblyBom))
            failures.push(`BOM_JLCPCB.csv missing v3 designator ${marker}`);
    }
    if (!assemblyBom.includes("12k_1pct_HALL"))
        failures.push("BOM_JLCPCB.csv missing 12k Hall-divider value");

    // Wire pads, the normally-open etched solder jumper, and mounting holes are
    // fabricated PCB features. Every other fitted footprint must have a BOM
    // line, including all manual/THT parts.
    const fabricatedOnlyFootprints = new Set([
        "WirePad",
        "SOLDER_JUMPER_OPEN",
        "MountingHole_3.2mm",
        "MountingHole_3.2mm_M3",
    ]);
    for (const ref of references) {
        const block = footprint(ref);
        const footprintName = block.match(/^\(footprint\s+"([^"]+)"/)?.[1];
        if (
            footprintName &&
            !fabricatedOnlyFootprints.has(footprintName) &&
            !hasDesignator(assemblyBom, ref)
        )
            failures.push(`BOM_JLCPCB.csv missing fitted footprint ${ref}`);
    }
} else {
    failures.push("missing BOM_JLCPCB.csv for carrier v3");
}

const assemblyCplPath = "fixtures/esp32_robot_carrier/CPL_JLCPCB.csv";
if (fs.existsSync(assemblyCplPath)) {
    const assemblyCpl = fs.readFileSync(assemblyCplPath, "utf8");
    for (const marker of [
        "U4", "U6", "U9", "R40", "R43", "C20", "C4", "C9", "U_TRIG_L",
    ])
        if (!new RegExp(`^${marker},`, "m").test(assemblyCpl))
            failures.push(`CPL_JLCPCB.csv missing v3 designator ${marker}`);

    const expectedSmt = references
        .filter((ref) => {
            const block = footprint(ref);
            return (
                /\(pad\s+"[^"]*"\s+smd\b/.test(block) &&
                !/\(pad\s+"[^"]*"\s+(?:thru_hole|np_thru_hole)\b/.test(block) &&
                ref !== "JP_ESP_PWR"
            );
        })
        .sort();
    const actualSmt = assemblyCpl
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(",", 1)[0])
        .sort();
    if (expectedSmt.join(",") !== actualSmt.join(",")) {
        const missing = expectedSmt.filter((ref) => !actualSmt.includes(ref));
        const extra = actualSmt.filter((ref) => !expectedSmt.includes(ref));
        failures.push(
            `CPL coverage mismatch; missing ${missing.join(",") || "none"}; extra ${extra.join(",") || "none"}`,
        );
    }
} else {
    failures.push("missing CPL_JLCPCB.csv for carrier v3");
}

if (failures.length) {
    console.error("ESP32 carrier v3 system contract FAILED");
    failures.forEach((failure) => console.error(` - ${failure}`));
    warnings.forEach((warning) => console.error(` ! ${warning}`));
    process.exit(1);
}

console.log(
    `ESP32 carrier v3 system contract PASS: headers/pins valid, LTC4367 window ${uvTrip.toFixed(1)}-${ovTrip.toFixed(1)} V, UWS ${uwsTrimmedVoltage.toFixed(2)} V / 8.0 A low-line / ${uwsHighLineCurrentAtRatedPower.toFixed(2)} A high-line power limit, throttle max ${throttleMaximum.toFixed(2)} V, TEN 60 24 V / 2.5 A`,
);
warnings.forEach((warning) => console.warn(`WARNING: ${warning}`));
