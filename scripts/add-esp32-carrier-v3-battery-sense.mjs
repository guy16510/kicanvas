import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const boardPath =
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const encodedPath = `${boardPath}.gz.b64`;

execFileSync(process.execPath, ["scripts/route-esp32-carrier-v3-drc6.mjs"], {
    stdio: "inherit",
});
let board = fs.readFileSync(boardPath, "utf8");

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

function footprintBounds(ref) {
    const marker = `(property "Reference" "${ref}"`;
    const markerIndex = board.indexOf(marker);
    if (markerIndex < 0) throw new Error(`footprint ${ref} not found`);
    const start = board.lastIndexOf("(footprint", markerIndex);
    return { start, end: endOfBlock(board, start) };
}

function editFootprint(ref, edit) {
    const { start, end } = footprintBounds(ref);
    const block = board.slice(start, end);
    board = board.slice(0, start) + edit(block) + board.slice(end);
}

function replaceOnce(from, to) {
    const start = board.indexOf(from);
    if (start < 0) throw new Error(`required text not found: ${from}`);
    if (board.indexOf(from, start + from.length) >= 0)
        throw new Error(`required text is not unique: ${from}`);
    board = board.slice(0, start) + to + board.slice(start + from.length);
}

function insertBefore(token, text) {
    const index = board.indexOf(token);
    if (index < 0) throw new Error(`insertion token not found: ${token}`);
    board = board.slice(0, index) + text + "\n  " + board.slice(index);
}

function removeRoutedNet(net) {
    const removals = [];
    for (const token of ["(segment", "(via"]) {
        let start = 0;
        while ((start = board.indexOf(token, start)) >= 0) {
            const end = endOfBlock(board, start);
            const block = board.slice(start, end);
            if (block.includes(`(net ${net})`)) removals.push({ start, end });
            start = end;
        }
    }
    for (const { start, end } of removals.sort((a, b) => b.start - a.start))
        board = board.slice(0, start) + board.slice(end);
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

function removeCopperMatching(predicate) {
    const removals = [];
    for (const token of ["(segment", "(via"]) {
        let start = 0;
        while ((start = board.indexOf(token, start)) >= 0) {
            const end = endOfBlock(board, start);
            const block = board.slice(start, end);
            if (predicate(block)) removals.push({ start, end });
            start = end;
        }
    }
    for (const { start, end } of removals.sort((a, b) => b.start - a.start))
        board = board.slice(0, start) + board.slice(end);
}

function hideProperty(block, propertyName) {
    const marker = `(property "${propertyName}"`;
    const start = block.indexOf(marker);
    if (start < 0) return block;
    const end = endOfBlock(block, start);
    const property = block.slice(start, end);
    if (/\s+hide\s*\)$/.test(property)) return block;
    const hidden = `${property.slice(0, -1)} hide)`;
    return block.slice(0, start) + hidden + block.slice(end);
}

function stripFootprintSilkscreen() {
    const footprints = [];
    let start = 0;
    while ((start = board.indexOf("(footprint", start)) >= 0) {
        const end = endOfBlock(board, start);
        footprints.push({ start, end });
        start = end;
    }
    for (const bounds of footprints.reverse()) {
        let block = board.slice(bounds.start, bounds.end);
        block = hideProperty(block, "Reference");
        block = hideProperty(block, "Value");
        const removals = [];
        for (const token of [
            "(fp_line",
            "(fp_rect",
            "(fp_circle",
            "(fp_arc",
            "(fp_poly",
            "(fp_curve",
            "(fp_text",
        ]) {
            let primitiveStart = 0;
            while ((primitiveStart = block.indexOf(token, primitiveStart)) >= 0) {
                const primitiveEnd = endOfBlock(block, primitiveStart);
                const primitive = block.slice(primitiveStart, primitiveEnd);
                if (primitive.includes('(layer "F.SilkS")'))
                    removals.push({ start: primitiveStart, end: primitiveEnd });
                primitiveStart = primitiveEnd;
            }
        }
        for (const removal of removals.sort((a, b) => b.start - a.start))
            block = block.slice(0, removal.start) + block.slice(removal.end);
        board = board.slice(0, bounds.start) + block + board.slice(bounds.end);
    }
}

function editGraphicText(text, edit) {
    const marker = `(gr_text "${text}"`;
    const start = board.indexOf(marker);
    if (start < 0) throw new Error(`graphic text not found: ${text}`);
    const end = endOfBlock(board, start);
    board = board.slice(0, start) + edit(board.slice(start, end)) + board.slice(end);
}

function normalizeBoardSilkscreen() {
    const blocks = [];
    let start = 0;
    while ((start = board.indexOf("(gr_text", start)) >= 0) {
        const end = endOfBlock(board, start);
        blocks.push({ start, end });
        start = end;
    }
    for (const bounds of blocks.reverse()) {
        const original = board.slice(bounds.start, bounds.end);
        if (!original.includes('(layer "F.SilkS")')) continue;
        const normalized = original
            .replace(
                /\(size\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\)/,
                (match, width, height) =>
                    Math.min(Number(width), Number(height)) < 0.8
                        ? "(size 0.8 0.8)"
                        : match,
            )
            .replace(
                /\(thickness\s+(\d+(?:\.\d+)?)\)/,
                (match, thickness) =>
                    Number(thickness) < 0.15 ? "(thickness 0.15)" : match,
            );
        board =
            board.slice(0, bounds.start) + normalized + board.slice(bounds.end);
    }
}

function removeBoardSilkscreenRectangles() {
    const removals = [];
    let start = 0;
    while ((start = board.indexOf("(gr_rect", start)) >= 0) {
        const end = endOfBlock(board, start);
        const block = board.slice(start, end);
        if (block.includes('(layer "F.SilkS")')) removals.push({ start, end });
        start = end;
    }
    for (const removal of removals.reverse())
        board = board.slice(0, removal.start) + board.slice(removal.end);
}

// This carrier has a 5 V accessory rail intended for multi-amp loads. Make
// 2 oz outer copper part of the PCB itself instead of relying on an order-form
// note that can be lost or default back to 1 oz.
replaceOnce(
    "  (setup (pad_to_mask_clearance 0))",
    `  (setup
    (stackup
      (layer "F.SilkS" (type "Top Silk Screen"))
      (layer "F.Paste" (type "Top Solder Paste"))
      (layer "F.Mask" (type "Top Solder Mask") (thickness 0.01))
      (layer "F.Cu" (type "copper") (thickness 0.07))
      (layer "dielectric 1" (type "core") (thickness 1.44) (material "FR4") (epsilon_r 4.5) (loss_tangent 0.02))
      (layer "B.Cu" (type "copper") (thickness 0.07))
      (layer "B.Mask" (type "Bottom Solder Mask") (thickness 0.01))
      (layer "B.Paste" (type "Bottom Solder Paste"))
      (layer "B.SilkS" (type "Bottom Silk Screen"))
      (copper_finish "None")
      (dielectric_constraints no)
    )
    (pad_to_mask_clearance 0)
  )`,
);

function smd2({
    ref,
    value,
    x,
    y,
    rotation = 0,
    net1,
    name1,
    net2,
    name2,
}) {
    return `(footprint "R_0805_2012Metric" (layer "F.Cu") (at ${x} ${y} ${rotation})
    (property "Reference" "${ref}" (at 0 -1.8 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 1.8 0) (layer "F.Fab") hide)
    (fp_rect (start -1.5 -0.9) (end 1.5 0.9) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -1.1 0) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net1} "${name1}"))
    (pad "2" smd roundrect (at 1.1 0) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net2} "${name2}"))
  )`;
}

function capacitor() {
    return `(footprint "C_0805_2012Metric" (layer "F.Cu") (at 107 112)
    (property "Reference" "C20" (at 0 -1.8 0) (layer "F.SilkS"))
    (property "Value" "100nF_BAT_ADC_FILTER" (at 0 1.8 0) (layer "F.Fab") hide)
    (fp_rect (start -1.5 -0.9) (end 1.5 0.9) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -1.1 0) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 6 "BATTERY_ADC_GPIO34"))
    (pad "2" smd roundrect (at 1.1 0) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 3 "GND"))
  )`;
}

function rgbBulkCapacitor() {
    return `(footprint "CP_Radial_D10_P5_RGB" (layer "F.Cu") (at 80 102.5)
    (property "Reference" "C24" (at 0 -5.8 0) (layer "F.SilkS"))
    (property "Value" "1000uF_10V_RGB_BULK" (at 0 5.8 0) (layer "F.Fab") hide)
    (fp_circle (center 0 0) (end 5 0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "+" (at 3 -2.4 0) (layer "F.SilkS") (effects (font (size 1.0 1.0) (thickness 0.18))))
    (pad "1" thru_hole rect (at 2.5 0) (size 2.6 2.6) (drill 1.0) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "2" thru_hole circle (at -2.5 0) (size 2.6 2.6) (drill 1.0) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function esp32PowerJumper() {
    return `(footprint "SOLDER_JUMPER_OPEN" (layer "F.Cu") (at 55.5 60.56)
    (property "Reference" "JP_ESP_PWR" (at 0 -1.7 0) (layer "F.SilkS"))
    (property "Value" "OPEN_WHEN_USB_CONNECTED" (at 0 1.7 0) (layer "F.Fab") hide)
    (fp_rect (start -1.55 -0.9) (end 1.55 0.9) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -0.7 0) (size 1.2 1.4) (layers "F.Cu" "F.Mask") (roundrect_rratio 0.2) (net 69 "ESP32_VIN_USB_ISOLATED"))
    (pad "2" smd roundrect (at 0.7 0) (size 1.2 1.4) (layers "F.Cu" "F.Mask") (roundrect_rratio 0.2) (net 2 "+5V"))
  )`;
}

function fuseHolder({ ref, value, x, y, rotation, net1, name1, net2, name2 }) {
    return `(footprint "Littelfuse_0PTF0015P_5x20" (layer "F.Cu") (at ${x} ${y} ${rotation})
    (property "Reference" "${ref}" (at 11 -5.8 ${rotation}) (layer "F.SilkS"))
    (property "Value" "${value}" (at 11 5.8 ${rotation}) (layer "F.Fab") hide)
    (fp_rect (start -0.3 -4.5) (end 22.6 4.5) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_line (start 1.5 0) (end 20.5 0) (stroke (width 0.2) (type default)) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0 ${rotation}) (size 3.4 3.4) (drill 1.6) (layers "*.Cu" "*.Mask") (net ${net1} "${name1}"))
    (pad "2" thru_hole circle (at 22 0 ${rotation}) (size 3.4 3.4) (drill 1.6) (layers "*.Cu" "*.Mask") (net ${net2} "${name2}"))
  )`;
}

// Murata UWS-5/10-Q48N-C, through-hole option, viewed from the top of the
// carrier. The pin coordinates and finished-hole ranges come from the Murata
// UWS-Q48 mechanical drawing. Pins 1-3 and 5-7 use 1.40 mm finished holes;
// the 1.52 mm power pins 4 and 8 use 1.90 mm finished holes. The module body is
// 33.0 x 22.9 mm. Nothing else is placed beneath that body outline.
function murataUwsModule() {
    return `(footprint "Murata_UWS_Q48_THT" (layer "F.Cu") (at 82.5 134)
    (property "Reference" "PS1" (at 0 -13.2 0) (layer "F.SilkS"))
    (property "Value" "UWS-5/10-Q48N-C_18-75VIN_5V_10A" (at 0 13.2 0) (layer "F.Fab") hide)
    (fp_rect (start -16.5 -11.45) (end 16.5 11.45) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (fp_rect (start -16.75 -11.7) (end 16.75 11.7) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
    (fp_text user "MURATA UWS-5/10-Q48N-C" (at 0 0 90) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.18))))
    (fp_text user "+VIN" (at -13.97 10.1 0) (layer "F.SilkS") (effects (font (size 0.75 0.75) (thickness 0.14))))
    (fp_text user "+5V" (at 13.97 10.1 0) (layer "F.SilkS") (effects (font (size 0.75 0.75) (thickness 0.14))))
    (pad "1" thru_hole rect (at -13.97 7.62) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 57 "VIN_PROTECTED"))
    (pad "2" thru_hole circle (at -13.97 0) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "3" thru_hole circle (at -13.97 -7.62) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "4" thru_hole circle (at 13.97 -7.62) (size 3.4 3.4) (drill 1.9) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "5" thru_hole circle (at 13.97 -3.81) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "6" thru_hole circle (at 13.97 0) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask"))
    (pad "7" thru_hole circle (at 13.97 3.81) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "8" thru_hole rect (at 13.97 7.62) (size 3.4 3.4) (drill 1.9) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
  )`;
}

// Traco Power TEN 60-4815WIN: active 60 W, 18-75 V input, 24 V / 2.5 A
// through-hole module. Coordinates follow the manufacturer's 2 x 1 inch
// bottom-view drawing, rotated 180 degrees here to keep the input pins beside
// the protected battery trunk. Pin 3 (positive-logic remote) is left open for
// ON and pin 6 (trim) is left open for nominal 24 V.
function tracoTen60Module() {
    return `(footprint "Traco_TEN60WIN_THT" (layer "F.Cu") (at 82 170)
    (property "Reference" "PS2" (at 0 -14.7 0) (layer "F.SilkS"))
    (property "Value" "TEN_60-4815WIN_18-75VIN_24V_2.5A" (at 0 14.7 0) (layer "F.Fab") hide)
    (fp_rect (start -25.4 -12.7) (end 25.4 12.7) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (fp_rect (start -25.65 -12.95) (end 25.65 12.95) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
    (fp_text user "TRACO TEN 60-4815WIN" (at 0 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.18))))
    (fp_text user "+VIN" (at -22.86 -8 90) (layer "F.SilkS") (effects (font (size 0.75 0.75) (thickness 0.14))))
    (fp_text user "+24V" (at 22.86 -8 90) (layer "F.SilkS") (effects (font (size 0.75 0.75) (thickness 0.14))))
    (pad "1" thru_hole rect (at -22.86 -10.16) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask") (net 57 "VIN_PROTECTED"))
    (pad "2" thru_hole circle (at -22.86 0) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "3" thru_hole circle (at -22.86 10.16) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask"))
    (pad "4" thru_hole rect (at 22.86 -10.16) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask") (net 79 "+24V"))
    (pad "5" thru_hole circle (at 22.86 0) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "6" thru_hole circle (at 22.86 10.16) (size 2.6 2.6) (drill 1.3) (layers "*.Cu" "*.Mask"))
  )`;
}

function servoBulkCapacitor() {
    return `(footprint "CP_Radial_D12.5_P5" (layer "F.Cu") (at 25 145)
    (property "Reference" "C19" (at 2.5 -5.8 0) (layer "F.SilkS"))
    (property "Value" "470uF_50V_SERVO_BULK" (at 2.5 7 0) (layer "F.Fab") hide)
    (fp_circle (center 2.5 0) (end 8.75 0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "+" (at -0.5 -2.8 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.18))))
    (pad "1" thru_hole rect (at 0 0) (size 2.6 2.6) (drill 1.0) (layers "*.Cu" "*.Mask") (net 64 "+24V_SERVO"))
    (pad "2" thru_hole circle (at 5 0) (size 2.6 2.6) (drill 1.0) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function localInputCapacitor24V() {
    return `(footprint "CP_Radial_D8_P3.5" (layer "F.Cu") (at 48 160)
    (property "Reference" "C26" (at 1.75 -4.8 0) (layer "F.SilkS"))
    (property "Value" "22uF_100V_24V_MODULE_INPUT" (at 1.75 4.8 0) (layer "F.Fab") hide)
    (pad "1" thru_hole rect (at 0 0) (size 2.3 2.3) (drill 1.0) (layers "*.Cu" "*.Mask") (net 57 "VIN_PROTECTED"))
    (pad "2" thru_hole circle (at 3.5 0) (size 2.3 2.3) (drill 1.0) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function localOutputCapacitor24V() {
    return `(footprint "C_1210_3225Metric" (layer "F.Cu") (at 112 164)
    (property "Reference" "C25" (at 0 -2.2 0) (layer "F.SilkS"))
    (property "Value" "1uF_50V_X7R_24V_MODULE_OUTPUT" (at 0 2.2 0) (layer "F.Fab") hide)
    (pad "1" smd roundrect (at -1.475 0) (size 1.15 2.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 79 "+24V"))
    (pad "2" smd roundrect (at 1.475 0) (size 1.15 2.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 3 "GND"))
  )`;
}

function servoRailTvs() {
    return `(footprint "D_SMB_CUSTOM" (layer "F.Cu") (at 39 145)
    (property "Reference" "D2" (at 0 -3.2 0) (layer "F.SilkS"))
    (property "Value" "SMBJ26A_26V_SERVO_TVS" (at 0 3.2 0) (layer "F.Fab") hide)
    (fp_rect (start -3.5 -2.2) (end 3.5 2.2) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (fp_text user "K" (at -2.7 -1.25 0) (layer "F.SilkS") (effects (font (size 0.7 0.7) (thickness 0.14))))
    (pad "1" smd rect (at -2.5 0) (size 2.2 2.4) (layers "F.Cu" "F.Paste" "F.Mask") (net 64 "+24V_SERVO"))
    (pad "2" smd rect (at 2.5 0) (size 2.2 2.4) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND"))
  )`;
}

function mountingHole(ref, x, y) {
    return `(footprint "MountingHole_3.2mm_M3" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -4 0) (layer "F.SilkS"))
    (property "Value" "M3" (at 0 4 0) (layer "F.Fab") hide)
    (fp_circle (center 0 0) (end 3 0) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask"))
  )`;
}

function controllerGroundPad(ref, x, y) {
    return `(footprint "WirePad" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.5 0) (layer "F.SilkS"))
    (property "Value" "CONTROLLER_SIGNAL_GND" (at 0 2.5 0) (layer "F.Fab") hide)
    (pad "1" thru_hole circle (at 0 0) (size 3.2 3.2) (drill 1.3) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function mountingKeepout(ref, x, y, layer) {
    const suffix = layer === "F.Cu" ? "F" : "B";
    return `(zone (net 0) (net_name "") (layer "${layer}") (name "MOUNT_KEEP_${ref}_${suffix}") (hatch full 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy ${x - 3.5} ${y - 3.5}) (xy ${x + 3.5} ${y - 3.5}) (xy ${x + 3.5} ${y + 3.5}) (xy ${x - 3.5} ${y + 3.5})))
  )`;
}

// The radio antenna on a 30-pin ESP32 DevKit sits beyond the pad-1 end of
// the two socket rows. Copper or signal routing below that end materially
// reduces Wi-Fi/Bluetooth range, so reserve the whole module-width rectangle
// on both copper layers. Pads remain allowed at the y=25 socket boundary.
function esp32AntennaKeepout(layer) {
    const suffix = layer === "F.Cu" ? "F" : "B";
    return `(zone (net 0) (net_name "") (layer "${layer}") (name "ESP32_ANT_KEEP_${suffix}") (hatch full 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 48 13) (xy 77.4 13) (xy 77.4 24) (xy 48 24)))
  )`;
}

// TLV9001IDBVR in the standard DBV SOT-23-5 pinout: OUT, V-, IN+, IN-, V+.
// Each 5 V rail-to-rail stage raises the ESP32 DAC range to the 4.2 V range
// accepted by the WinXu controller while preserving a passive zero-demand
// state whenever the ESP32 is absent or resetting.
function throttleOpAmp({ ref, x, y, inputNet, inputName, outputNet, outputName, feedbackNet, feedbackName }) {
    return `(footprint "SOT-23-5_TLV9001_DBV" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.5 0) (layer "F.SilkS"))
    (property "Value" "TLV9001IDBVR_THROTTLE_RRIO" (at 0 2.5 0) (layer "F.Fab") hide)
    (fp_rect (start -1.8 -1.7) (end 1.8 1.7) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd rect (at -1.1 -1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net ${outputNet} "${outputName}"))
    (pad "2" smd rect (at -1.1 0.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND"))
    (pad "3" smd rect (at -1.1 1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net ${inputNet} "${inputName}"))
    (pad "4" smd rect (at 1.1 1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net ${feedbackNet} "${feedbackName}"))
    (pad "5" smd rect (at 1.1 -1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "+5V"))
  )`;
}

function dualThrottleOpAmp() {
    return `(footprint "SOIC-8_3.9x4.9mm_P1.27mm_TLV9002" (layer "F.Cu") (at 62.7 75)
    (property "Reference" "U10" (at 0 -4.2 0) (layer "F.SilkS"))
    (property "Value" "TLV9002IDR_DUAL_THROTTLE_RRIO" (at 0 4.2 0) (layer "F.Fab") hide)
    (fp_rect (start -2.5 -3.1) (end 2.5 3.1) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (fp_circle (center -1.5 -2.25) (end -1.25 -2.25) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -2.7 -1.905) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 84 "L_THROTTLE_AMP"))
    (pad "2" smd roundrect (at -2.7 -0.635) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 86 "L_THROTTLE_FEEDBACK"))
    (pad "3" smd roundrect (at -2.7 0.635) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 82 "L_THROTTLE_FILTERED"))
    (pad "4" smd roundrect (at -2.7 1.905) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 3 "GND"))
    (pad "5" smd roundrect (at 2.7 1.905) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 83 "R_THROTTLE_FILTERED"))
    (pad "6" smd roundrect (at 2.7 0.635) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 87 "R_THROTTLE_FEEDBACK"))
    (pad "7" smd roundrect (at 2.7 -0.635) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 85 "R_THROTTLE_AMP"))
    (pad "8" smd roundrect (at 2.7 -1.905) (size 1.5 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 2 "+5V"))
  )`;
}

function isolatedOutputConnector({ ref, value, x, y, net1, name1, net2, name2 }) {
    return `(footprint "TerminalBlock_1x02_P3.50" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -4.2 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 4.2 0) (layer "F.Fab") hide)
    (fp_rect (start -2 -3.3) (end 2 3.3) (stroke (width 0.22) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 1.75) (size 2.4 2.4) (drill 1.2) (layers "*.Cu" "*.Mask") (net ${net1} "${name1}"))
    (pad "2" thru_hole circle (at 0 -1.75) (size 2.4 2.4) (drill 1.2) (layers "*.Cu" "*.Mask") (net ${net2} "${name2}"))
  )`;
}

function enableJumper({ ref, value, x, y, net1, name1, net2, name2 }) {
    return `(footprint "ENABLE_JUMPER_1x02" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.2 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 0 2.2 0) (layer "F.Fab") hide)
    (pad "1" thru_hole circle (at -1.27 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net ${net1} "${name1}"))
    (pad "2" thru_hole circle (at 1.27 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net ${net2} "${name2}"))
  )`;
}

function photoMos({ ref, x, y, gateNet, gateName, switchedNet, switchedName, contactNet, contactName }) {
    return `(footprint "Panasonic_AQY212S_SOP4" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -3.4 0) (layer "F.SilkS"))
    (property "Value" "AQY212SX_60V_0.5A_PHOTOMOS" (at 0 3.4 0) (layer "F.Fab") hide)
    (fp_rect (start -2.2 -2.15) (end 2.2 2.15) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (fp_circle (center 1.35 -1.25) (end 1.58 -1.25) (stroke (width 0.18) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at 2.65 -1.27) (size 1.3 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${gateNet} "${gateName}"))
    (pad "2" smd roundrect (at 2.65 1.27) (size 1.3 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 3 "GND"))
    (pad "3" smd roundrect (at -2.65 1.27) (size 1.3 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${switchedNet} "${switchedName}"))
    (pad "4" smd roundrect (at -2.65 -1.27) (size 1.3 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${contactNet} "${contactName}"))
  )`;
}

function isolationMoat(ref, x, y, layer) {
    const suffix = layer === "F.Cu" ? "F" : "B";
    return `(zone (net 0) (net_name "") (layer "${layer}") (name "ISO_MOAT_${ref}_${suffix}") (hatch full 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias not_allowed) (pads not_allowed) (copperpour not_allowed) (footprints allowed))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy ${x - 0.9} ${y - 2.25}) (xy ${x + 0.9} ${y - 2.25}) (xy ${x + 0.9} ${y + 2.25}) (xy ${x - 0.9} ${y + 2.25})))
  )`;
}

function triggerBuffer({ ref, x, y, inputNet, inputName, outputNet, outputName }) {
    return `(footprint "SOT-23-5" (layer "F.Cu") (at ${x} ${y} 0)
    (property "Reference" "${ref}" (at 0 -2.5 0) (layer "F.SilkS"))
    (property "Value" "74AHCT1G125_TRIGGER_3V3_TO_5V" (at 0 2.5 0) (layer "F.Fab") hide)
    (fp_rect (start -1.8 -1.7) (end 1.8 1.7) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd rect (at -1.1 -1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND"))
    (pad "2" smd rect (at -1.1 0.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net ${inputNet} "${inputName}"))
    (pad "3" smd rect (at -1.1 1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND"))
    (pad "4" smd rect (at 1.1 1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net ${outputNet} "${outputName}"))
    (pad "5" smd rect (at 1.1 -1.0) (size 1.1 0.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "+5V"))
  )`;
}

function segment(x1, y1, x2, y2, width, layer, net) {
    return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) (layer "${layer}") (net ${net}))`;
}

function via(x, y, net, size = 0.9, drill = 0.45) {
    return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;
}

// The legacy fixture declared only the layers containing drawn primitives.
// KiCad accepts pads that mention undeclared mask/paste layers, but fabrication
// export then silently omits those Gerbers. Install the complete standard
// two-layer technical-layer table before any production edits.
{
    const start = board.indexOf("(layers");
    if (start < 0) throw new Error("board layer table not found");
    const end = endOfBlock(board, start);
    const layers = `(layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (9 "F.Adhes" user "F.Adhesive")
    (11 "B.Adhes" user "B.Adhesive")
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (17 "Dwgs.User" user "User.Drawings")
    (19 "Cmts.User" user "User.Comments")
    (21 "Eco1.User" user "User.Eco1")
    (23 "Eco2.User" user "User.Eco2")
    (25 "Edge.Cuts" user)
    (27 "Margin" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
    (35 "F.Fab" user)
    (33 "B.Fab" user)
  )`;
    board = board.slice(0, start) + layers + board.slice(end);
}

// The dedicated 24 V / 60 W servo converter needs a clear 2 x 1 inch module
// area. Extend only the lower power bay, then extend its back-layer ground
// plane with the outline. The board remains 128 mm wide.
replaceOnce(
    '(gr_rect (start 1 1) (end 129 154)',
    '(gr_rect (start 1 1) (end 129 190)',
);
replaceOnce(
    '(polygon (pts (xy 2 108) (xy 128 108) (xy 128 153) (xy 2 153)))',
    '(polygon (pts (xy 2 108) (xy 128 108) (xy 128 189) (xy 2 189)))',
);

// GPIO34 is an ADC1 input, so battery measurements remain available while Wi-Fi
// is active. The front echo moves to non-strapping GPIO33; left brake moves to
// GPIO12, where the PhotoMOS input pull-down passively holds the flash-voltage
// strap low. GPIO1/GPIO3 remain a complete UART0 pair for Pi commands and diagnostics.
board = board.replaceAll(
    '(net 6 "FRONT_ECHO_GPIO")',
    '(net 6 "BATTERY_ADC_GPIO34")',
);
board = board.replaceAll(
    '(net 14 "AUX_GPIO12")',
    '(net 14 "FRONT_ECHO_GPIO")',
);
editFootprint("R5", (block) =>
    block.replaceAll(
        '(net 6 "BATTERY_ADC_GPIO34")',
        '(net 14 "FRONT_ECHO_GPIO")',
    ),
);
editFootprint("R6", (block) =>
    block.replaceAll(
        '(net 6 "BATTERY_ADC_GPIO34")',
        '(net 14 "FRONT_ECHO_GPIO")',
    ).replace('(property "Value" "20k"', '(property "Value" "15k_1pct_ULTRASONIC"'),
);
for (const ref of ["R4", "R8"])
    editFootprint(ref, (block) =>
        block.replace(
            '(property "Value" "20k"',
            '(property "Value" "15k_1pct_ULTRASONIC"',
        ),
    );
// Each Hall input keeps its existing 10 nF shunt capacitor and uses a 12 kΩ
// lower divider leg. With the 10 kΩ series leg this limits a 5.5 V Hall high
// to 3.05 V at worst-case 1% tolerances while retaining a strong ESP32 high.
for (const ref of ["R2", "R20", "R22", "R24", "R26", "R28"])
    editFootprint(ref, (block) =>
        block.replace(
            '(property "Value" "20k"',
            '(property "Value" "12k_1pct_HALL"',
        ),
    );
// The former GPIO12 auxiliary pad is removed because that strap now has a
// single, controlled purpose as the pulled-down left-brake output.
editFootprint("J_AUX12", () => "");
// GPIO2 is also a boot strap. Keep only the high-impedance RGB buffer input on
// it; an exposed auxiliary pad could let an attached peripheral break boot.
editFootprint("J_AUX2", () => "");
board = board.replaceAll('"+5V_SERVO"', '"+24V_SERVO"');
editFootprint("J_SERVO", (block) =>
    block.replace(
        '(property "Value" "SIG_5V_GND"',
        '(property "Value" "SIG_24V_GND"',
    ),
);
editFootprint("FB2", (block) =>
    block.replace(
        '(net 2 "+5V")',
        '(net 80 "+24V_SERVO_FUSED")',
    ),
);
editFootprint("C19", () => servoBulkCapacitor());

// Replace the grounded one-wire controller switches with floating two-wire
// names before installing the PhotoMOS contacts. The original net numbers are
// retained for the jumper/contact-A side so the earlier deterministic routing
// stages remain easy to audit.
for (const [from, to] of [
    ["R_BRAKE_SW", "R_BRAKE_CONTACT_A_SW"],
    ["R_BRAKE_CONN", "R_BRAKE_CONTACT_A"],
    ["L_BRAKE_SW", "L_BRAKE_CONTACT_A_SW"],
    ["L_BRAKE_CONN", "L_BRAKE_CONTACT_A"],
    ["L_REVERSE_SW", "L_REVERSE_CONTACT_A_SW"],
    ["L_REVERSE_CONN", "L_REVERSE_CONTACT_A"],
    ["R_REVERSE_SW", "R_REVERSE_CONTACT_A_SW"],
    ["R_REVERSE_CONN", "R_REVERSE_CONTACT_A"],
])
    board = board.replaceAll(`"${from}"`, `"${to}"`);

// Swap the front echo and left-brake destinations. GPIO33 is safe for an
// externally driven echo; GPIO12 sees only the local 330R PhotoMOS LED path and
// its 100k pull-down, so an ultrasonic module can no longer select 1.8 V flash.
editFootprint("J_ESP_L", (block) =>
    block
        .replace(
            '(pad "7" thru_hole circle (at 0 15.24) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 9 "L_BRAKE_GPIO"))',
            '(pad "7" thru_hole circle (at 0 15.24) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 14 "FRONT_ECHO_GPIO"))',
        )
        .replace(
            '(pad "12" thru_hole circle (at 0 27.94) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 14 "FRONT_ECHO_GPIO"))',
            '(pad "12" thru_hole circle (at 0 27.94) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 9 "L_BRAKE_GPIO"))',
        ),
);

replaceOnce(
    '  (net 67 "UV_LOW_MID")',
    '  (net 67 "UV_LOW_MID")\n  (net 68 "BATTERY_DIVIDER_MID")\n  (net 69 "ESP32_VIN_USB_ISOLATED")\n  (net 70 "+5V_PI_FUSED")\n  (net 71 "LEFT_TRIG_5V")\n  (net 72 "FRONT_TRIG_5V")\n  (net 73 "RIGHT_TRIG_5V")\n  (net 74 "R_BRAKE_CONTACT_B")\n  (net 75 "L_BRAKE_CONTACT_B")\n  (net 76 "L_REVERSE_CONTACT_B")\n  (net 77 "R_REVERSE_CONTACT_B")\n  (net 78 "RGB_DATA_OUT")\n  (net 79 "+24V")\n  (net 80 "+24V_SERVO_FUSED")\n  (net 81 "UWS_TRIM")\n  (net 82 "L_THROTTLE_FILTERED")\n  (net 83 "R_THROTTLE_FILTERED")\n  (net 84 "L_THROTTLE_AMP")\n  (net 85 "R_THROTTLE_AMP")\n  (net 86 "L_THROTTLE_FEEDBACK")\n  (net 87 "R_THROTTLE_FEEDBACK")',
);

// The original direct-DAC throttle stages become the input filters for two
// rail-to-rail amplifiers. Keep L_THROTTLE_OUT/R_THROTTLE_OUT as the final
// controller-facing nets so the connector contract remains unambiguous.
for (const [ref, oldNet, oldName, filteredNet, filteredName] of [
    ["R13", 39, "L_THROTTLE_OUT", 82, "L_THROTTLE_FILTERED"],
    ["C1", 39, "L_THROTTLE_OUT", 82, "L_THROTTLE_FILTERED"],
    ["R14", 40, "R_THROTTLE_OUT", 83, "R_THROTTLE_FILTERED"],
    ["C2", 40, "R_THROTTLE_OUT", 83, "R_THROTTLE_FILTERED"],
])
    editFootprint(ref, (block) =>
        block.replaceAll(
            `(net ${oldNet} "${oldName}")`,
            `(net ${filteredNet} "${filteredName}")`,
        ),
    );

// F1 is a serviceable 5x20 mm cartridge fuse holder. The selected Littelfuse
// 0PTF0015P footprint is rated 250 V / 6.3 A and has 22 mm THT lead spacing.
// Populate it with the specified 5 A / 400 VDC Eaton S505H cartridge; a common
// 32 V automotive fuse is not acceptable on a 42 V pack. Both converters draw
// roughly 3.4 A together at 36 V and full rated output after conversion loss.
editFootprint("F1", () =>
    fuseHolder({
        ref: "F1",
        value: "0PTF0015P_5x20_INPUT_5A",
        x: 16,
        y: 108,
        rotation: 0,
        net1: 53,
        name1: "BAT_RAW",
        net2: 54,
        name2: "BAT_FUSED",
    }),
);

// A Pi connected over USB powers the DevKit through USB VBUS. Espressif warns
// that USB and 5 V-header power are mutually exclusive, so the carrier's 5 V
// rail reaches ESP32 VIN only through this normally-open solder jumper. Close
// it for standalone operation only, with USB physically disconnected.
editFootprint("J_ESP_L", (block) =>
    block.replace(
        '(net 2 "+5V"))\n)',
        '(net 69 "ESP32_VIN_USB_ISOLATED"))\n)',
    ),
);
editFootprint("J_PI_PWR", (block) =>
    block
        .replaceAll('(net 2 "+5V")', '(net 70 "+5V_PI_FUSED")')
        .replace(
            '(property "Value" "5.1V_8A_TO_PI"',
            '(property "Value" "5V_5A_FUSED_TO_PI"',
        ),
);
for (const [ref, gpioNet, gpioName, outputNet, outputName] of [
    ["J_LTRIG", 16, "LEFT_TRIG", 71, "LEFT_TRIG_5V"],
    ["J_FTRIG", 21, "FRONT_TRIG", 72, "FRONT_TRIG_5V"],
    ["J_RTRIG", 22, "RIGHT_TRIG", 73, "RIGHT_TRIG_5V"],
])
    editFootprint(ref, (block) =>
        block.replace(
            `(net ${gpioNet} "${gpioName}")`,
            `(net ${outputNet} "${outputName}")`,
        ),
    );

editFootprint("J_RGB_DATA", (block) =>
    block.replace(
        '(net 52 "RGB_DATA_5V")',
        '(net 78 "RGB_DATA_OUT")',
    ),
);
editFootprint("C3", (block) =>
    block
        .replace(
            /\(at\s+75(?:\.0+)?\s+102\.5(?:0+)?\s+90\)/,
            "(at 72.5 100.5 0)",
        )
        .replaceAll("(at 0 -1.8 90)", "(at 0 -1.8 0)")
        .replaceAll("(at 0 1.8 90)", "(at 0 1.8 0)"),
);
// JP4G is a through-hole ground tie beside the RGB connector. A solid zone
// connection avoids leaving its back-layer thermal spokes on an isolated
// copper island; the explicit front-layer track remains its primary return.
editFootprint("JP4G", (block) =>
    block.replace(
        '(net 3 "GND")',
        '(net 3 "GND")\n    (zone_connect 2)',
    ),
);
editFootprint("H2", (block) =>
    block.replace(
        /\(at\s+115(?:\.0+)?\s+5(?:\.0+)?\)/,
        "(at 125 5)",
    ),
);

// Replace the fine-pitch LT8645S converter with a prequalified through-hole
// 18-75 V input module. This removes the QFN, switch node, inductor, feedback,
// timing, and soft-start parts from the carrier. Retain one local high-voltage
// ceramic plus the input/output bulk capacitors recommended for a noisy robot.
editFootprint("U5", () => murataUwsModule());
// Murata's trim-up equation gives 798 kOhm for +2%. 806 kOhm is the nearest
// readily available 1% E96 value and produces about 5.099 V nominal. The trim
// resistor returns to -Sense/GND as required by the UWS data sheet.
editFootprint("PS1", (block) =>
    block.replace(
        '(pad "6" thru_hole circle (at 13.97 0) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask"))',
        '(pad "6" thru_hole circle (at 13.97 0) (size 2.6 2.6) (drill 1.4) (layers "*.Cu" "*.Mask") (net 81 "UWS_TRIM"))',
    ),
);
for (const ref of ["L1", "C12", "C13", "C14", "C15", "C17", "R31", "R32", "R33", "R34"])
    editFootprint(ref, () => "");
editFootprint("C10", (block) =>
    block.replace(/\(at\s+64(?:\.0+)?\s+132(?:\.0+)?(?:\s+0)?\)/, "(at 58 138)"),
);
editFootprint("C11", (block) =>
    block.replace(/\(at\s+68(?:\.0+)?\s+126(?:\.0+)?(?:\s+0)?\)/, "(at 62 126)"),
);
editFootprint("C16", (block) =>
    block.replace(/\(at\s+91(?:\.0+)?\s+144(?:\.0+)?(?:\s+0)?\)/, "(at 104 144)"),
);
editFootprint("C18", (block) =>
    block
        .replace(/\(at\s+104(?:\.0+)?\s+143(?:\.0+)?(?:\s+0)?\)/, "(at 106 138)")
        .replace(
            '(property "Value" "47uF_10V_X7R"',
            '(property "Value" "1uF_50V_X7R_MODULE_OUTPUT"',
        ),
);

// Four PhotoMOS relays turn the ESP32 commands into floating two-wire switch
// contacts. The existing normally-open shunt headers stay on the isolated
// contact side, so removing a shunt physically opens the controller command.
const isolatedOutputs = [
    {
        oldSwitch: "Q1", relay: "U6", resistor: "R10", jumper: "JP_RBRK",
        connector: "J_RBRK", y: 38, connectorY: 37,
        gateNet: 33, gateName: "R_BRAKE_GATE",
        switchedNet: 34, switchedName: "R_BRAKE_CONTACT_A_SW",
        contactANet: 35, contactAName: "R_BRAKE_CONTACT_A",
        contactBNet: 74, contactBName: "R_BRAKE_CONTACT_B",
        value: "R_BRAKE_FLOATING_CONTACT",
    },
    {
        oldSwitch: "Q2", relay: "U7", resistor: "R12", jumper: "JP_LBRK",
        connector: "J_LBRK", y: 44, connectorY: 45,
        gateNet: 36, gateName: "L_BRAKE_GATE",
        switchedNet: 37, switchedName: "L_BRAKE_CONTACT_A_SW",
        contactANet: 38, contactAName: "L_BRAKE_CONTACT_A",
        contactBNet: 75, contactBName: "L_BRAKE_CONTACT_B",
        value: "L_BRAKE_FLOATING_CONTACT",
    },
    {
        oldSwitch: "Q3", relay: "U8", resistor: "R16", jumper: "JP_LREV",
        connector: "J_LREV", y: 62, connectorY: 61,
        gateNet: 41, gateName: "L_REVERSE_GATE",
        switchedNet: 42, switchedName: "L_REVERSE_CONTACT_A_SW",
        contactANet: 43, contactAName: "L_REVERSE_CONTACT_A",
        contactBNet: 76, contactBName: "L_REVERSE_CONTACT_B",
        value: "L_REVERSE_FLOATING_CONTACT",
    },
    {
        oldSwitch: "Q4", relay: "U9", resistor: "R18", jumper: "JP_RREV",
        connector: "J_RREV", y: 68, connectorY: 69,
        gateNet: 44, gateName: "R_REVERSE_GATE",
        switchedNet: 45, switchedName: "R_REVERSE_CONTACT_A_SW",
        contactANet: 46, contactAName: "R_REVERSE_CONTACT_A",
        contactBNet: 77, contactBName: "R_REVERSE_CONTACT_B",
        value: "R_REVERSE_FLOATING_CONTACT",
    },
];
for (const output of isolatedOutputs) {
    editFootprint(output.resistor, (block) =>
        block.replace(
            '(property "Value" "100R"',
            '(property "Value" "330R_PHOTOMOS_LED"',
        ),
    );
    editFootprint(output.oldSwitch, () =>
        photoMos({
            ref: output.relay,
            x: 19.4,
            y: output.y,
            gateNet: output.gateNet,
            gateName: output.gateName,
            switchedNet: output.switchedNet,
            switchedName: output.switchedName,
            contactNet: output.contactBNet,
            contactName: output.contactBName,
        }),
    );
    editFootprint(output.connector, () =>
        isolatedOutputConnector({
            ref: output.connector,
            value: output.value,
            x: 5,
            y: output.connectorY,
            net1: output.contactANet,
            name1: output.contactAName,
            net2: output.contactBNet,
            name2: output.contactBName,
        }),
    );
    editFootprint(output.jumper, () =>
        enableJumper({
            ref: output.jumper,
            value: `${output.relay}_OUTPUT_ENABLE`,
            x: 12,
            y: output.y + 1.27,
            net1: output.contactANet,
            name1: output.contactAName,
            net2: output.switchedNet,
            name2: output.switchedName,
        }),
    );
}

const dividerParts = [
    controllerGroundPad("J_LCTRL_GND", 12, 52),
    controllerGroundPad("J_RCTRL_GND", 12, 58),
    // Prevent a powered 24 V servo from seeing a floating control lead while
    // the ESP32 is unpowered or held in reset.
    smd2({
        ref: "R53",
        value: "100k_SERVO_SIGNAL_FAILSAFE",
        x: 48,
        y: 66,
        net1: 15,
        name1: "SERVO_SIG",
        net2: 3,
        name2: "GND",
    }),
    // Input pull-downs hold the amplifier commands at zero while the ESP32 is
    // unpowered/resetting. The separate controller-side pull-downs below make
    // the external leads fail to zero even if an output resistor is open.
    smd2({
        ref: "R29",
        value: "100k_THROTTLE_INPUT_FAILSAFE",
        x: 55,
        y: 89,
        net1: 82,
        name1: "L_THROTTLE_FILTERED",
        net2: 3,
        name2: "GND",
    }),
    smd2({
        ref: "R30",
        value: "100k_THROTTLE_INPUT_FAILSAFE",
        x: 70.5,
        y: 89,
        net1: 3,
        name1: "GND",
        net2: 83,
        name2: "R_THROTTLE_FILTERED",
    }),
    dualThrottleOpAmp(),
    smd2({ ref: "R45", value: "330R_L_THROTTLE_OUTPUT", x: 55, y: 73.095, net1: 39, name1: "L_THROTTLE_OUT", net2: 84, name2: "L_THROTTLE_AMP" }),
    smd2({ ref: "R46", value: "6.04k_1pct_L_THROTTLE_GAIN", x: 50, y: 74.365, net1: 39, name1: "L_THROTTLE_OUT", net2: 86, name2: "L_THROTTLE_FEEDBACK" }),
    smd2({ ref: "R47", value: "22k_1pct_L_THROTTLE_GAIN", x: 50, y: 78, net1: 3, name1: "GND", net2: 86, name2: "L_THROTTLE_FEEDBACK" }),
    smd2({ ref: "R48", value: "330R_R_THROTTLE_OUTPUT", x: 70.5, y: 74.365, net1: 85, name1: "R_THROTTLE_AMP", net2: 40, name2: "R_THROTTLE_OUT" }),
    smd2({ ref: "R49", value: "6.04k_1pct_R_THROTTLE_GAIN", x: 70.5, y: 77, net1: 87, name1: "R_THROTTLE_FEEDBACK", net2: 40, name2: "R_THROTTLE_OUT" }),
    smd2({ ref: "R50", value: "22k_1pct_R_THROTTLE_GAIN", x: 69.4, y: 81, rotation: 90, net1: 3, name1: "GND", net2: 87, name2: "R_THROTTLE_FEEDBACK" }),
    smd2({ ref: "R51", value: "10k_L_THROTTLE_OUTPUT_FAILSAFE", x: 55, y: 69, net1: 39, name1: "L_THROTTLE_OUT", net2: 3, name2: "GND" }),
    smd2({ ref: "R52", value: "10k_R_THROTTLE_OUTPUT_FAILSAFE", x: 70.5, y: 71, net1: 3, name1: "GND", net2: 40, name2: "R_THROTTLE_OUT" }),
    smd2({ ref: "C27", value: "100nF_THROTTLE_BYPASS", x: 62.7, y: 69.5, net1: 2, name1: "+5V", net2: 3, name2: "GND" }).replace('footprint "R_0805_2012Metric"', 'footprint "C_0805_2012Metric"'),
    smd2({
        ref: "R44",
        value: "806k_1pct_UWS_TRIM_5V1",
        x: 102,
        y: 134,
        net1: 81,
        name1: "UWS_TRIM",
        net2: 3,
        name2: "GND",
    }),
    smd2({
        ref: "R40",
        value: "240k_1pct_BAT_ADC_TOP_A",
        x: 97,
        y: 116,
        net1: 57,
        name1: "VIN_PROTECTED",
        net2: 68,
        name2: "BATTERY_DIVIDER_MID",
    }),
    smd2({
        ref: "R41",
        value: "240k_1pct_BAT_ADC_TOP_B",
        x: 102,
        y: 116,
        net1: 68,
        name1: "BATTERY_DIVIDER_MID",
        net2: 6,
        name2: "BATTERY_ADC_GPIO34",
    }),
    smd2({
        ref: "R42",
        value: "20k_1pct_BAT_ADC_BOTTOM",
        x: 107,
        y: 116,
        net1: 6,
        name1: "BATTERY_ADC_GPIO34",
        net2: 3,
        name2: "GND",
    }),
    capacitor(),
    esp32PowerJumper(),
    fuseHolder({
        ref: "F2",
        value: "0PTF0015P_5x20_PI_5A",
        x: 120,
        y: 112,
        rotation: 270,
        net1: 2,
        name1: "+5V",
        net2: 70,
        name2: "+5V_PI_FUSED",
    }),
    smd2({
        ref: "R43",
        value: "330R_RGB_DATA",
        x: 90,
        y: 105.5,
        net1: 52,
        name1: "RGB_DATA_5V",
        net2: 78,
        name2: "RGB_DATA_OUT",
    }),
    rgbBulkCapacitor(),
    tracoTen60Module(),
    localInputCapacitor24V(),
    localOutputCapacitor24V(),
    servoRailTvs(),
    fuseHolder({
        ref: "F3",
        value: "0PTF0015P_5x20_SERVO_3.15A",
        x: 120,
        y: 157,
        rotation: 270,
        net1: 79,
        name1: "+24V",
        net2: 80,
        name2: "+24V_SERVO_FUSED",
    }),
    isolatedOutputConnector({
        ref: "J_24V_AUX",
        value: "24V_SERVO_AUX_2.5A_SHARED",
        x: 35,
        y: 174,
        net1: 64,
        name1: "+24V_SERVO",
        net2: 3,
        name2: "GND",
    }),
    ...[
        ["U_TRIG_L", 10, 16, "LEFT_TRIG", 71, "LEFT_TRIG_5V", "C21"],
        ["U_TRIG_F", 40, 21, "FRONT_TRIG", 72, "FRONT_TRIG_5V", "C22"],
        ["U_TRIG_R", 46, 22, "RIGHT_TRIG", 73, "RIGHT_TRIG_5V", "C23"],
    ].flatMap(([ref, y, inputNet, inputName, outputNet, outputName, capacitorRef]) => [
        triggerBuffer({
            ref,
            x: 104,
            y,
            inputNet,
            inputName,
            outputNet,
            outputName,
        }),
        smd2({
            ref: capacitorRef,
            value: "100nF_TRIGGER_BYPASS",
            x: 108,
            y: y - 1,
            net1: 2,
            name1: "+5V",
            net2: 3,
            name2: "GND",
        }),
    ]),
];
insertBefore("(segment", dividerParts.join("\n  "));

// The old GPIO34/front-echo route must not remain connected to the ADC net.
// Rebuild both low-current routes explicitly after changing the pin assignment.
removeRoutedNet(6);
removeRoutedNet(14);
removeRoutedNet(9);
for (const net of [34, 35, 37, 38, 42, 43, 45, 46]) removeRoutedNet(net);
removeRoutedNet(17);
removeRoutedNet(52);
removeRoutedNet(39);
removeRoutedNet(40);
for (const net of [60, 61, 62, 63, 66]) removeRoutedNet(net);
replaceOnce(
    '  (segment (start 50.00 60.56) (end 62.00 60.56) (width 1.20) (layer "B.Cu") (net 2))',
    '  (segment (start 50.00 60.56) (end 54.00 60.56) (width 1.00) (layer "B.Cu") (net 69))\n  (via (at 54.00 60.56) (size 1.0) (drill 0.5) (layers "F.Cu" "B.Cu") (net 69))\n  (segment (start 54.00 60.56) (end 54.80 60.56) (width 1.00) (layer "F.Cu") (net 69))\n  (segment (start 56.20 60.56) (end 62.00 60.56) (width 1.00) (layer "F.Cu") (net 2))',
);
replaceOnce(
    '  (segment (start 7 118) (end 7 113.5) (width 1.5) (layer "F.Cu") (net 53))',
    '  (segment (start 7 118) (end 7 108) (width 1.5) (layer "F.Cu") (net 53))\n  (segment (start 7 108) (end 16 108) (width 1.5) (layer "F.Cu") (net 53))',
);
replaceOnce(
    '  (segment (start 7 113.5) (end 18 113.5) (width 1.5) (layer "F.Cu") (net 53))',
    '',
);
replaceOnce(
    '  (segment (start 18 113.5) (end 18 118) (width 1.5) (layer "F.Cu") (net 53))',
    '',
);
replaceOnce(
    '  (segment (start 22 118) (end 22 113.5) (width 1.5) (layer "F.Cu") (net 54))',
    '  (segment (start 38 108) (end 51.54 108) (width 1.5) (layer "B.Cu") (net 54))\n  (segment (start 51.54 108) (end 51.54 113.5) (width 1.5) (layer "B.Cu") (net 54))\n  (via (at 51.54 113.5) (size 2.0) (drill 1.0) (layers "F.Cu" "B.Cu") (net 54))',
);
replaceOnce(
    '  (segment (start 22 113.5) (end 51.54 113.5) (width 1.5) (layer "F.Cu") (net 54))',
    '  (segment (start 24.5 113.5) (end 51.54 113.5) (width 1.5) (layer "F.Cu") (net 54))',
);
replaceOnce(
    '  (segment (start 111 138) (end 111 143) (width 1.5) (layer "F.Cu") (net 2))',
    '',
);
replaceOnce(
    '  (segment (start 115.2 138) (end 115.2 143) (width 1.5) (layer "F.Cu") (net 2))',
    '',
);
for (const [gpioNet, y] of [
    [16, 10],
    [21, 40],
    [22, 46],
])
    replaceOnce(
        `  (segment (start 83.00 ${y.toFixed(2)}) (end 112.00 ${y.toFixed(2)}) (width 0.32) (layer "F.Cu") (net ${gpioNet}))`,
        `  (segment (start 83.00 ${y.toFixed(2)}) (end 102.90 ${y.toFixed(2)}) (width 0.32) (layer "F.Cu") (net ${gpioNet}))`,
    );

// Remove obsolete copper from the earlier routing stages before installing the
// final, DRC-proven routes below. Matching geometry instead of line formatting
// keeps this cleanup stable when KiCad or an earlier generator reformats data.
removeCopperMatching((block) => {
    const isGround = block.includes("(net 3)");
    if (isGround && block.startsWith("(via"))
        if (
            [
                [91.1, 129],
                [100.5, 146],
            ].some((point) => samePoint(pointIn(block, "at"), point))
        )
            return true;
    if (
        isGround &&
        block.startsWith("(segment") &&
        [
            [[91.1, 126], [91.1, 129]],
            [[100.5, 143], [100.5, 146]],
        ].some(([first, second]) => connects(block, first, second))
    )
        return true;
    if (
        block.startsWith("(via") &&
        block.includes("(net 57)") &&
        samePoint(pointIn(block, "at"), [59.62, 118])
    )
        return true;
    if (block.startsWith("(segment") && block.includes("(net 64)")) return true;
    const isFiveVolts = block.includes("(net 2)");
    if (!isFiveVolts) return false;
    if (block.startsWith("(via"))
        return [
            [16.2, 149],
            [90, 149],
            [90, 150],
        ].some((point) => samePoint(pointIn(block, "at"), point));
    if (!block.startsWith("(segment")) return false;

    const start = pointIn(block, "start");
    const end = pointIn(block, "end");
    if (
        block.includes('(layer "B.Cu")') &&
        start?.[1] === 92 &&
        end?.[1] === 92
    )
        return true;

    return [
        [[69.1, 101.5], [73.6, 101.5]],
        [[73.6, 101.5], [88, 101.5]],
        [[69.1, 101.5], [88, 101.5]],
        [[88, 101.5], [88, 103]],
        [[74, 92], [74, 101.1]],
        [[74, 101.1], [75, 101.1]],
        [[74, 123.75], [74, 150]],
        [[74, 150], [90, 150]],
        [[78, 141], [78, 138]],
        [[78, 138], [115.2, 138]],
        [[97.5, 138], [97.5, 143]],
        [[94, 138], [124, 137]],
        [[124, 137], [124, 92]],
        [[16.2, 149], [90, 149]],
        [[16.2, 149], [16.2, 145]],
    ].some(([first, second]) => connects(block, first, second));
});

// Strip every piece of legacy LT8645S power copper before adding the module
// routes. Keep the LTC4367 OUT monitor path and the rest of the carrier's 5 V
// distribution; only geometry entering the former converter area is removed.
removeCopperMatching((block) => {
    const at = pointIn(block, "at");
    const start = pointIn(block, "start");
    const end = pointIn(block, "end");
    const points = [at, start, end].filter(Boolean);

    if (block.includes("(net 57)")) {
        if (block.startsWith("(via") && samePoint(at, [88.9, 124])) return true;
        if (!block.startsWith("(segment")) return false;
        if (
            connects(block, [59.62, 118], [59.62, 124]) ||
            connects(block, [88.9, 115], [88.9, 124])
        )
            return true;
        if (block.includes('(layer "F.Cu")'))
            return points.some(
                ([x, y]) => (x >= 59 && y >= 124) || (x >= 66 && y >= 120),
            );
        return points.some(([x, y]) => x >= 66 && y >= 120);
    }

    if (block.includes("(net 2)"))
        return points.some(([x, y]) => x >= 60 && y >= 108);

    if (block.includes("(net 3)")) {
        if (points.some((point) => samePoint(point, [105.5, 146]))) return true;
        return points.some(([x, y]) => x >= 64 && x <= 90 && y >= 116 && y <= 130);
    }
    return false;
});

const routes = [
    // GPIO2 is dedicated to the RGB level shifter. Its edge route changes
    // layers above the 5 V bus, then stays on the front beside U_RGB. R43 and
    // its two short traces sit above this route with verified clearance.
    segment(75.4, 32.62, 79.4, 32.62, 0.28, "B.Cu", 17),
    segment(79.4, 32.62, 83, 16, 0.28, "B.Cu", 17),
    via(83, 16, 17),
    segment(83, 16, 118, 16, 0.32, "F.Cu", 17),
    via(118, 16, 17),
    segment(118, 16, 118, 90, 0.35, "B.Cu", 17),
    via(118, 90, 17),
    segment(118, 90, 118, 107.2, 0.35, "F.Cu", 17),
    segment(118, 107.2, 64, 107.2, 0.35, "F.Cu", 17),
    segment(64, 107.2, 64, 102.5, 0.35, "F.Cu", 17),
    segment(64, 102.5, 66.9, 102.5, 0.35, "F.Cu", 17),

    // Floating brake/reverse contact pairs. Contact A passes through the
    // removable enable shunt; contact B runs directly to the other PhotoMOS
    // output terminal. No controller contact is tied to carrier ground.
    ...isolatedOutputs.flatMap((output) => [
        segment(
            5,
            output.connectorY + 1.75,
            10.73,
            output.y + 1.27,
            0.35,
            "F.Cu",
            output.contactANet,
        ),
        segment(
            13.27,
            output.y + 1.27,
            16.75,
            output.y + 1.27,
            0.35,
            "F.Cu",
            output.switchedNet,
        ),
        segment(
            5,
            output.connectorY - 1.75,
            5,
            output.y - 1.27,
            0.35,
            "F.Cu",
            output.contactBNet,
        ),
        segment(
            5,
            output.y - 1.27,
            16.75,
            output.y - 1.27,
            0.35,
            "F.Cu",
            output.contactBNet,
        ),
    ]),

    // Full-range fail-safe WinXu throttle interfaces. GPIO25/GPIO26 retain
    // their 1k/1uF DAC filters. One TLV9002 has gain 1 + 6.04k/22k = 1.2745
    // on both channels, with input and controller-side fail-safe pull-downs.
    segment(18.6, 50, 21.5, 52.3, 0.28, "F.Cu", 82),
    segment(21.5, 52.3, 24.6, 52.3, 0.28, "F.Cu", 82),
    segment(24.6, 52.3, 23.5, 54.5, 0.28, "F.Cu", 82),
    via(23.5, 54.5, 82),
    segment(23.5, 54.5, 23.5, 85.5, 0.28, "B.Cu", 82),
    via(23.5, 85.5, 82),
    segment(23.5, 85.5, 58, 85.5, 0.28, "F.Cu", 82),
    segment(51, 85.5, 51, 89, 0.28, "B.Cu", 82),
    via(51, 85.5, 82),
    via(51, 89, 82),
    segment(51, 89, 53.9, 89, 0.28, "F.Cu", 82),
    via(58, 85.5, 82),
    segment(58, 85.5, 57, 75.635, 0.28, "B.Cu", 82),
    via(57, 75.635, 82),
    segment(57, 75.635, 60, 75.635, 0.28, "F.Cu", 82),
    segment(56.1, 89, 58, 88.5, 0.28, "F.Cu", 3),
    via(58, 88.5, 3, 1.0, 0.5),

    segment(18.6, 56, 21.5, 58.3, 0.28, "F.Cu", 83),
    segment(21.5, 58.3, 24.6, 58.3, 0.28, "F.Cu", 83),
    segment(24.6, 58.3, 24.6, 56.8, 0.28, "F.Cu", 83),
    segment(24.6, 56.8, 29, 56.8, 0.28, "F.Cu", 83),
    segment(29, 56.8, 29, 58.3, 0.28, "F.Cu", 83),
    via(29, 58.3, 83),
    segment(29, 58.3, 29, 87, 0.28, "B.Cu", 83),
    via(29, 87, 83),
    segment(29, 87, 71.6, 87, 0.28, "F.Cu", 83),
    segment(71.6, 87, 71.6, 89, 0.28, "F.Cu", 83),
    via(65.4, 87, 83),
    segment(65.4, 87, 65.4, 79, 0.28, "B.Cu", 83),
    via(65.4, 79, 83),
    segment(65.4, 79, 65.4, 76.905, 0.28, "F.Cu", 83),
    segment(69.4, 89, 68.3, 88.5, 0.28, "F.Cu", 3),
    via(68.3, 88.5, 3, 1.0, 0.5),

    // Left amplifier, post-resistor feedback, and final controller lead.
    segment(60, 73.095, 56.1, 73.095, 0.28, "F.Cu", 84),
    segment(53.9, 69, 48.9, 69, 0.28, "F.Cu", 39),
    segment(48.9, 69, 48.9, 74.365, 0.28, "F.Cu", 39),
    segment(53.9, 73.095, 48.9, 73.095, 0.28, "F.Cu", 39),
    segment(48.9, 74, 2.5, 74, 0.32, "F.Cu", 39),
    segment(2.5, 74, 2.5, 50, 0.32, "F.Cu", 39),
    segment(2.5, 50, 8, 50, 0.32, "F.Cu", 39),
    segment(60, 74.365, 51.1, 74.365, 0.28, "F.Cu", 86),
    segment(51.1, 74.365, 51.1, 78, 0.28, "F.Cu", 86),
    via(56.1, 69, 3, 1.0, 0.5),
    via(48.9, 78, 3, 1.0, 0.5),

    // Right amplifier, post-resistor feedback, and final controller lead.
    segment(65.4, 74.365, 69.4, 74.365, 0.28, "F.Cu", 85),
    segment(71.6, 71, 71.6, 84, 0.28, "F.Cu", 40),
    segment(71.6, 84, 2.5, 84, 0.32, "F.Cu", 40),
    via(2.5, 84, 40),
    segment(2.5, 84, 2.5, 56, 0.32, "B.Cu", 40),
    segment(2.5, 56, 8, 56, 0.32, "B.Cu", 40),
    segment(65.4, 75.635, 69.4, 77, 0.28, "F.Cu", 87),
    segment(69.4, 77, 69.4, 79.9, 0.28, "F.Cu", 87),
    segment(69.4, 82.1, 69.4, 83, 0.28, "F.Cu", 3),
    via(69.4, 83, 3, 1.0, 0.5),
    via(69.4, 71, 3, 1.0, 0.5),

    // Local bypass and a low-current 5 V feed from the y=92 distribution bus.
    segment(61.6, 69.5, 59.5, 69.5, 0.35, "F.Cu", 2),
    segment(59.5, 69.5, 59.5, 67, 0.35, "F.Cu", 2),
    segment(59.5, 67, 78, 67, 0.35, "F.Cu", 2),
    segment(65.4, 67, 65.4, 73.095, 0.35, "F.Cu", 2),
    via(78, 67, 2),
    segment(78, 67, 78, 92, 0.4, "B.Cu", 2),
    segment(63.8, 69.5, 63.8, 70.8, 0.28, "F.Cu", 3),
    via(63.8, 70.8, 3, 1.0, 0.5),
    via(60, 76.905, 3, 1.0, 0.5),

    // UWS trim-up resistor: 806k from Trim to -Sense/GND sets approximately
    // 5.10 V nominal, preserving Raspberry Pi cable/dropout margin.
    segment(96.47, 134, 100.9, 134, 0.25, "F.Cu", 81),
    segment(103.1, 134, 104.5, 134, 0.25, "F.Cu", 3),
    via(104.5, 134, 3, 1.0, 0.5),

    // Front echo divider to non-strapping GPIO33.
    segment(18.4, 26, 20.5, 28.2, 0.28, "F.Cu", 14),
    segment(20.5, 28.2, 22.9, 28.2, 0.28, "F.Cu", 14),
    segment(18.4, 26, 37, 26, 0.32, "F.Cu", 14),
    via(37, 26, 14),
    segment(37, 26, 37, 40.24, 0.28, "B.Cu", 14),
    via(37, 40.24, 14),
    segment(37, 40.24, 50, 40.24, 0.28, "F.Cu", 14),

    // Left brake moved to GPIO12. This net cannot be driven externally: R12
    // feeds the isolated PhotoMOS input which R11 holds low during reset.
    segment(32.4, 44, 43, 44, 0.28, "F.Cu", 9),
    segment(43, 44, 44.5, 45.5, 0.28, "F.Cu", 9),
    segment(44.5, 45.5, 44.5, 52.94, 0.28, "F.Cu", 9),
    segment(44.5, 52.94, 50, 52.94, 0.28, "F.Cu", 9),

    // Replaceable Pi-branch fuse: main 5 V enters F2 pad 1 on the back; the
    // isolated output from pad 2 feeds both Mini-Fit Jr. positive contacts.
    segment(124, 112, 120, 112, 2.5, "B.Cu", 2),
    segment(120, 134, 120, 143, 2.5, "F.Cu", 70),
    segment(120, 143, 115.2, 143, 2.5, "F.Cu", 70),
    segment(115.2, 143, 111, 143, 2.5, "F.Cu", 70),

    // Three guaranteed 5 V trigger outputs for JSN-SR04T / AJ-SR04M. The
    // AHCT inputs accept ESP32 3.3 V logic; OE is tied low and each device has
    // local bypassing. A shared back-layer 5 V spine feeds the three stages.
    ...[
        [10, 16, 71],
        [40, 21, 72],
        [46, 22, 73],
    ].flatMap(([y, gpioNet, outputNet]) => [
        segment(105.1, y + 1, 108, y + 1, 0.32, "F.Cu", outputNet),
        segment(108, y + 1, 112, y, 0.32, "F.Cu", outputNet),
        segment(105.1, y - 1, 106.9, y - 1, 0.4, "F.Cu", 2),
        via(106, y - 1, 2),
        segment(102.9, y - 1, 101.7, y - 1, 0.35, "F.Cu", 3),
        via(101.7, y - 1, 3),
        segment(102.9, y + 1, 101.7, y + 1, 0.35, "F.Cu", 3),
        via(101.7, y + 1, 3),
        segment(109.1, y - 1, 110, y - 1, 0.35, "F.Cu", 3),
        via(110, y - 1, 3, 0.8, 0.4),
    ]),
    segment(106, 9, 106, 39, 0.6, "B.Cu", 2),
    segment(106, 39, 106, 45, 0.6, "B.Cu", 2),
    segment(106, 45, 106, 92, 0.35, "B.Cu", 2),

    // Final 5 V distribution. One back-layer bus feeds the USB-safe ESP
    // jumper, RGB logic, trigger buffers, Pi fuse, and accessory branches.
    segment(12, 92, 124, 92, 2.0, "B.Cu", 2),
    via(62, 60.56, 2),
    segment(69.1, 101.5, 71.1, 100.5, 0.5, "F.Cu", 2),
    segment(69.1, 101.5, 69.1, 99, 1.0, "F.Cu", 2),
    via(69.1, 99, 2),
    segment(69.1, 99, 69.1, 92, 1.0, "B.Cu", 2),
    segment(88, 92, 88, 103, 1.0, "B.Cu", 2),
    segment(82.5, 102.5, 88, 103, 1.0, "F.Cu", 2),
    segment(69.1, 103.5, 72, 105.5, 0.35, "F.Cu", 52),
    segment(72, 105.5, 88.9, 105.5, 0.35, "F.Cu", 52),
    segment(91.1, 105.5, 94, 105.5, 0.35, "F.Cu", 78),
    segment(94, 105.5, 94, 103, 0.35, "F.Cu", 78),
    // UWS output and remote-sense connections. Pin 7 is tied directly to pin
    // 8 because remote sensing is not used. C18 is the local 1 uF ceramic and
    // C16 is the 470 uF load-step reservoir.
    segment(96.47, 137.81, 96.47, 141.62, 0.8, "F.Cu", 2),
    segment(96.47, 137.81, 104.525, 138, 1.0, "F.Cu", 2),
    segment(96.47, 141.62, 104, 144, 2.0, "F.Cu", 2),
    segment(96.47, 141.62, 96.47, 152, 2.5, "B.Cu", 2),
    segment(96.47, 152, 124, 152, 2.5, "B.Cu", 2),
    segment(124, 152, 124, 92, 2.5, "B.Cu", 2),

    // Dedicated 24 V servo rail. PS2 is a 60 W / 2.5 A module. Its +24 V
    // output passes through serviceable F3 before the existing 6 A ferrite,
    // 50 V bulk capacitor, servo header, and auxiliary 24 V terminal.
    segment(59.62, 145, 59.14, 159.84, 2.0, "B.Cu", 57),
    segment(48, 160, 48, 155, 1.0, "B.Cu", 57),
    segment(48, 155, 59.14, 159.84, 1.0, "B.Cu", 57),
    segment(104.86, 159.84, 120, 157, 1.5, "F.Cu", 79),
    segment(104.86, 159.84, 110.525, 164, 1.0, "F.Cu", 79),
    segment(113.475, 164, 113.5, 166, 0.8, "F.Cu", 3),
    via(113.5, 166, 3, 1.1, 0.55),
    segment(120, 179, 114, 187.5, 1.5, "B.Cu", 80),
    segment(114, 187.5, 45, 187.5, 1.5, "B.Cu", 80),
    segment(45, 187.5, 18, 179, 1.5, "B.Cu", 80),
    segment(18, 179, 18, 151, 1.5, "B.Cu", 80),
    via(18, 151, 80, 1.2, 0.6),
    segment(18, 151, 16.2, 145, 1.5, "F.Cu", 80),
    segment(19.8, 141.5, 8.54, 141.5, 1.2, "F.Cu", 64),
    segment(8.54, 141.5, 8.54, 145, 1.2, "F.Cu", 64),
    segment(19.8, 141.5, 19.8, 145, 1.2, "F.Cu", 64),
    segment(19.8, 145, 25, 145, 1.2, "F.Cu", 64),
    segment(25, 145, 25, 137.5, 1.0, "F.Cu", 64),
    segment(25, 137.5, 36.5, 137.5, 1.0, "F.Cu", 64),
    segment(36.5, 137.5, 36.5, 145, 1.0, "F.Cu", 64),
    segment(41.5, 145, 45, 150, 1.0, "F.Cu", 3),
    via(45, 150, 3, 1.2, 0.6),
    segment(25, 145, 25, 169, 1.2, "F.Cu", 64),
    segment(25, 169, 35, 175.75, 1.2, "F.Cu", 64),

    // Complete the servo signal and local RGB/module ground returns. These
    // paths are deliberately separate from the high-current motor wiring.
    segment(43, 80, 8, 80, 0.28, "F.Cu", 15),
    segment(52, 63, 46.9, 66, 0.28, "F.Cu", 15),
    segment(66.9, 101.5, 65.5, 101.5, 0.35, "F.Cu", 3),
    via(65.5, 101.5, 3),
    segment(66.9, 103.5, 65.5, 103.5, 0.35, "F.Cu", 3),
    via(65.5, 103.5, 3),
    segment(65.5, 101.5, 65.5, 103.5, 0.35, "B.Cu", 3),
    segment(65.5, 103.5, 76.5, 103.5, 0.35, "B.Cu", 3),
    segment(76.5, 103.5, 76.5, 101.1, 0.35, "B.Cu", 3),
    segment(73.9, 100.5, 76.5, 101.1, 0.35, "F.Cu", 3),
    segment(77.5, 102.5, 76.5, 101.1, 1.0, "F.Cu", 3),
    via(76.5, 101.1, 3),
    segment(83, 96, 76.5, 96, 0.35, "F.Cu", 3),
    segment(76.5, 96, 76.5, 101.1, 0.35, "F.Cu", 3),
    segment(83, 96, 95, 96, 0.35, "F.Cu", 3),
    segment(95, 96, 100, 103, 0.35, "F.Cu", 3),
    segment(100, 103, 101.7, 103, 0.35, "F.Cu", 3),
    via(101.7, 103, 3),
    segment(101.7, 103, 108.1, 103, 0.35, "B.Cu", 3),
    segment(108.1, 103, 108.1, 110, 0.35, "B.Cu", 3),
    // Negative-logic enable pin 2 is hard-tied to -VIN (pin 3), so the module
    // always starts when protected battery power is present. Input and output
    // returns are intentionally bonded to carrier GND for controller signals.
    segment(68.53, 134, 68.53, 126.38, 0.8, "F.Cu", 3),
    segment(96.47, 130.19, 96.47, 126.38, 0.8, "F.Cu", 3),
    segment(63.475, 126, 68.53, 126.38, 0.8, "F.Cu", 3),
    segment(61.5, 138, 63, 138, 0.8, "F.Cu", 3),
    via(63, 138, 3, 1.1, 0.55),
    segment(107.475, 138, 109, 138, 0.8, "F.Cu", 3),
    via(109, 138, 3, 1.1, 0.55),
    segment(107.5, 144, 108, 147, 1.2, "F.Cu", 3),
    via(108, 147, 3, 1.2, 0.6),
    segment(51.5, 160, 51.5, 163, 0.8, "F.Cu", 3),
    via(51.5, 163, 3, 1.1, 0.55),

    // Protected battery rail through a fault-tolerant 25:1 divider and RC filter.
    // Sensing after the protection FETs prevents an unpowered ESP32 from being
    // back-fed through GPIO34 when the LTC4367 disconnects the battery.
    segment(59.62, 118, 59.62, 126, 1.5, "B.Cu", 57),
    segment(59.62, 126, 58, 138, 1.5, "B.Cu", 57),
    segment(58, 138, 58, 141.62, 1.5, "B.Cu", 57),
    segment(58, 141.62, 68.53, 141.62, 1.5, "B.Cu", 57),
    via(59.62, 126, 57, 1.1, 0.55),
    segment(59.62, 126, 60.525, 126, 0.8, "F.Cu", 57),
    segment(88.9, 115, 92, 115, 0.25, "B.Cu", 57),
    via(92, 115, 57),
    segment(92, 115, 92, 116, 0.25, "F.Cu", 57),
    segment(92, 116, 95.9, 116, 0.25, "F.Cu", 57),
    segment(98.1, 116, 100.9, 116, 0.25, "F.Cu", 68),
    segment(103.1, 116, 105.9, 116, 0.25, "F.Cu", 6),
    segment(105.9, 116, 105.9, 109, 0.25, "F.Cu", 6),
    segment(105.9, 109, 43, 109, 0.25, "F.Cu", 6),
    segment(43, 109, 43, 100, 0.25, "F.Cu", 6),
    segment(43, 100, 39, 100, 0.25, "F.Cu", 6),
    segment(39, 100, 39, 88, 0.25, "F.Cu", 6),
    via(39, 88, 6),
    segment(39, 88, 39, 8, 0.25, "B.Cu", 6),
    segment(39, 8, 45, 8, 0.25, "B.Cu", 6),
    via(45, 8, 6),
    segment(45, 8, 45, 32.62, 0.25, "F.Cu", 6),
    segment(45, 32.62, 50, 32.62, 0.28, "F.Cu", 6),
    segment(108.1, 116, 108.1, 110, 0.35, "F.Cu", 3),
    via(108.1, 110, 3, 1.0, 0.5),
];

replaceOnce(
    '(gr_text "FRONT ULTRA ECHO / GPIO34"',
    '(gr_text "FRONT ULTRA ECHO / GPIO33"',
);
replaceOnce(
    '(gr_text "LEFT BRAKE / GPIO33"',
    '(gr_text "LEFT BRAKE / GPIO12"',
);
replaceOnce(
    '(gr_text "ARM AUX / GPIO2"',
    '(gr_text "GPIO2 RGB ONLY - NO AUX PAD"',
);
replaceOnce(
    '(gr_text "ESP32 ROBOT CARRIER v2"',
    '(gr_text "ESP32 ROBOT CARRIER v3"',
);
replaceOnce(
    '(gr_text "ESP32 ROBOT CARRIER v3"',
    '(gr_text "Trashbot v1"',
);
replaceOnce(
    '(gr_text "5V INPUT ONLY"',
    '(gr_text "ONBOARD 5V + 24V POWER"',
);
replaceOnce(
    '(gr_text "5V ONLY - NO 36/42V BATTERY"',
    '(gr_text "36-42V INPUT AT J_BAT ONLY"',
);
replaceOnce(
    '(gr_text "ARM AUX / GPIO12"',
    '(gr_text "LEFT BRAKE SAFE STRAP / GPIO12"',
);
replaceOnce(
    '(gr_text "ARM/SERVO EXPANSION: GPIO13, GPIO12, GPIO2, UART GPIO1/3"',
    '(gr_text "SERVO GPIO13 | UART/USB GPIO1/3"',
);
replaceOnce(
    '(gr_text "GPIO12/GPIO2 ARE BOOT STRAPS - AUX WITH CARE"',
    '(gr_text "GPIO12 BRAKE PULLDOWN | GPIO2 RGB BUFFER ONLY"',
);
for (const [oldLabel, newLabel] of [
    ["LEFT ULTRA TRIG / GPIO15", "LEFT ULTRA TRIG / GPIO15 / 5V BUF"],
    ["FRONT ULTRA TRIG / GPIO5", "FRONT ULTRA TRIG / GPIO5 / 5V BUF"],
    ["RIGHT ULTRA TRIG / GPIO18", "RIGHT ULTRA TRIG / GPIO18 / 5V BUF"],
])
    replaceOnce(`(gr_text "${oldLabel}"`, `(gr_text "${newLabel}"`);

const label =
    '(gr_text "BATTERY ADC / GPIO34: 2x240k / 20k / 100nF" (at 106 120) (layer "F.SilkS") (effects (font (size 0.65 0.65) (thickness 0.13))))';
const usbPowerLabel =
    '(gr_text "ESP PWR JP: OPEN FOR USB" (at 62.7 64) (layer "F.SilkS") (effects (font (size 0.62 0.62) (thickness 0.13))))';
const inputFuseLabel =
    '(gr_text "F1 BATTERY: S505H 5A / 400VDC" (at 27 101.8) (layer "F.SilkS") (effects (font (size 0.68 0.68) (thickness 0.14))))';
const piFuseLabel =
    '(gr_text "F2 PI 5V: 6.3A MAX" (at 114.2 123 90) (layer "F.SilkS") (effects (font (size 0.68 0.68) (thickness 0.14))))';
const servoFuseLabel =
    '(gr_text "F3 SERVO 24V: 3.15A" (at 116 168 90) (layer "F.SilkS") (effects (font (size 0.68 0.68) (thickness 0.14))))';
const powerModuleLabel =
    '(gr_text "5V 8-9.8A | 24V 2.5A" (at 82 187.5) (layer "F.SilkS") (effects (font (size 0.82 0.82) (thickness 0.16))))';
const batteryPolarityLabel =
    '(gr_text "BAT+ | GND" (at 9.5 113.5) (layer "F.SilkS") (effects (font (size 0.72 0.72) (thickness 0.14))))';
const fiveVoltModuleLabel =
    '(gr_text "PS1 MURATA 5.10V" (at 82.5 134) (layer "F.SilkS") (effects (font (size 0.82 0.82) (thickness 0.16))))';
const servoModuleLabel =
    '(gr_text "PS2 TRACO 24V / 2.5A" (at 82 170) (layer "F.SilkS") (effects (font (size 0.82 0.82) (thickness 0.16))))';
const servoPinLabel =
    '(gr_text "SERVO: SIG | 24V | GND" (at 13 141) (layer "F.SilkS") (effects (font (size 0.68 0.68) (thickness 0.14))))';
const servoAuxLabel =
    '(gr_text "24V AUX: + | GND" (at 36.75 170) (layer "F.SilkS") (effects (font (size 0.68 0.68) (thickness 0.14))))';
const piPowerPinLabel =
    '(gr_text "PI: +5.1V +5.1V / GND GND" (at 111 154) (layer "F.SilkS") (effects (font (size 0.62 0.62) (thickness 0.13))))';
const brandLabel =
    '(gr_text "Burns Industries | CARRIER rev3" (at 60 8) (layer "F.SilkS") (effects (font (size 0.78 0.78) (thickness 0.15))))';
const leftControllerGroundLabel =
    '(gr_text "L GND" (at 12 54.5) (layer "F.SilkS") (effects (font (size 0.62 0.62) (thickness 0.13))))';
const rightControllerGroundLabel =
    '(gr_text "R GND" (at 12 60.5) (layer "F.SilkS") (effects (font (size 0.62 0.62) (thickness 0.13))))';
const isolationMoats = isolatedOutputs.flatMap((output) => [
    isolationMoat(output.relay, 19.4, output.y, "F.Cu"),
    isolationMoat(output.relay, 19.4, output.y, "B.Cu"),
]);
const cornerMounts = [
    ["H1", 5, 5],
    ["H2", 125, 5],
    ["H5", 5, 186],
    ["H6", 125, 186],
];
const mountingKeepouts = cornerMounts.flatMap(([ref, x, y]) => [
    mountingKeepout(ref, x, y, "F.Cu"),
    mountingKeepout(ref, x, y, "B.Cu"),
]);
const antennaKeepouts = [
    esp32AntennaKeepout("F.Cu"),
    esp32AntennaKeepout("B.Cu"),
];
insertBefore(
    '  (zone (net 3) (net_name "GND")',
    [
        ...routes,
        ...isolationMoats,
        ...antennaKeepouts,
        ...mountingKeepouts,
        mountingHole("H5", 5, 186),
        mountingHole("H6", 125, 186),
        label,
        usbPowerLabel,
        inputFuseLabel,
        piFuseLabel,
        servoFuseLabel,
        powerModuleLabel,
        batteryPolarityLabel,
        fiveVoltModuleLabel,
        servoModuleLabel,
        servoPinLabel,
        servoAuxLabel,
        piPowerPinLabel,
        brandLabel,
        leftControllerGroundLabel,
        rightControllerGroundLabel,
    ].join("\n  "),
);

for (const [oldText, newText] of [
    ["LEFT HALL C / GPIO36", "L HALL C / GPIO36"],
    ["RIGHT ULTRA ECHO / GPIO39", "R ECHO / GPIO39"],
    ["FRONT ULTRA ECHO / GPIO33", "F ECHO / GPIO33"],
    ["LEFT ULTRA ECHO / GPIO35", "L ECHO / GPIO35"],
    ["RIGHT BRAKE / GPIO32", "R BRK ISO / GPIO32"],
    ["LEFT BRAKE / GPIO12", "L BRK ISO / GPIO12"],
    ["LEFT THROTTLE / GPIO25", "L THROT / GPIO25"],
    ["RIGHT THROTTLE / GPIO26", "R THROT / GPIO26"],
    ["LEFT REVERSE / GPIO27", "L REV ISO / GPIO27"],
    ["RIGHT REVERSE / GPIO14", "R REV ISO / GPIO14"],
    ["LEFT ULTRA TRIG / GPIO15 / 5V BUF", "L TRIG / GPIO15 / 5V"],
    ["GPIO2 RGB ONLY - NO AUX PAD", "GPIO2 / RGB ONLY"],
    ["MPU6050 SDA / GPIO4", "I2C SDA / GPIO4"],
    ["LEFT HALL A / GPIO16", "L HALL A / GPIO16"],
    ["LEFT HALL B / GPIO17", "L HALL B / GPIO17"],
    ["FRONT ULTRA TRIG / GPIO5 / 5V BUF", "F TRIG / GPIO5 / 5V"],
    ["RIGHT ULTRA TRIG / GPIO18 / 5V BUF", "R TRIG / GPIO18 / 5V"],
    ["RIGHT HALL A / GPIO19", "R HALL A / GPIO19"],
    ["RIGHT HALL B / GPIO21", "R HALL B / GPIO21"],
    ["UART RX / GPIO3", "UART RX0 / GPIO3"],
    ["UART TX / GPIO1", "UART TX0 / GPIO1"],
    ["RIGHT HALL C / GPIO22", "R HALL C / GPIO22"],
    ["MPU6050 SCL / GPIO23", "I2C SCL / GPIO23"],
    ["R BRAKE ENABLE", "R BRK EN"],
    ["L BRAKE ENABLE", "L BRK EN"],
    ["L REVERSE ENABLE", "L REV EN"],
    ["R REVERSE ENABLE", "R REV EN"],
    ["RGB DATA = GPIO2 -> 5V AHCT BUFFER", "RGB: ONE DATA / GPIO2 > 5V BUF"],
    ["JUMPERS MUST BE CLOSED TO ENABLE BRAKE/REVERSE", "CLOSE JP_* TO ENABLE OUTPUTS"],
    ["ESP32 VIN <- 5V   |   ESP32 3V3 -> 3V3 RAILS   |   COMMON GND", "ESP USB: KEEP JP_ESP_PWR OPEN"],
    ["BATTERY ADC / GPIO34: 2x240k / 20k / 100nF", "BAT ADC GPIO34 / 25:1 / 100nF"],
    ["F1 BATTERY: S505H 5A / 400VDC", "F1: S505H 5A / 400VDC"],
    ["F2 PI 5V: 6.3A MAX", "F2: PI 5V / 5A"],
    ["HALL/ECHO DIVIDERS 10k/20k = 3.33V @ 5V", "HALL 10k/12k + 10nF | ECHO 10k/15k"],
    ["BRAKE/REVERSE JUMPERS: OPEN = DISABLED", "BRAKE/REV: ISOLATED 2-WIRE | JP OPEN=OFF"],
])
    replaceOnce(`(gr_text "${oldText}"`, `(gr_text "${newText}"`);

for (const redundantText of [
    "LEFT BRAKE SAFE STRAP / GPIO12",
    "SERVO GPIO13 | UART/USB GPIO1/3",
    "L REV EN",
    "36-42V PROTECTED POWER | LTC4367 + LT8645S | 5.1V / 8A",
])
    editGraphicText(redundantText, () => "");
editGraphicText("PI GND", (block) => block.replace("(at 66 101.5)", "(at 59 101.5)"));
editGraphicText("L THROT / GPIO25", (block) =>
    block
        .replace('(gr_text "L THROT / GPIO25"', '(gr_text "L THR25"')
        .replace("(at 10.8 52.55)", "(at 15 47.5)"),
);
editGraphicText("R THROT / GPIO26", (block) =>
    block.replace("(at 10.8 58.55)", "(at 36 58.55)"),
);
editGraphicText("L ECHO / GPIO35", (block) =>
    block.replace("(at 10.8 34.55)", "(at 33 34.55)"),
);
for (const [longText, shortText, y] of [
    ["R BRK ISO / GPIO32", "RBRK", 37],
    ["L BRK ISO / GPIO12", "LBRK", 45],
    ["L REV ISO / GPIO27", "LREV", 61],
    ["R REV ISO / GPIO14", "RREV", 69],
])
    editGraphicText(longText, (block) =>
        block
            .replace(`(gr_text "${longText}"`, `(gr_text "${shortText}"`)
            .replace(/\(at\s+[-\d.]+\s+[-\d.]+(?:\s+[-\d.]+)?\)/, `(at 8 ${y} 90)`),
    );
editGraphicText("BAT ADC GPIO34 / 25:1 / 100nF", (block) =>
    block.replace("(at 106 120)", "(at 95 120)"),
);
editGraphicText("5V", (block) =>
    block.replace(/\(at\s+88(?:\.0+)?\s+106(?:\.0+)?(?:\s+0)?\)/, "(at 88 99.3 0)"),
);
insertBefore(
    "(segment",
    `(gr_text "+" (at 84.8 102.5 0) (layer "F.SilkS")
    (effects (font (size 0.9 0.9) (thickness 0.18)) (justify bottom)))`,
);
removeBoardSilkscreenRectangles();
normalizeBoardSilkscreen();

// Assembly references remain in the fabrication data, but dense autogenerated
// footprint outlines and visible property fields make the production silk
// unreadable and violate solder-mask clearances. Keep only the deliberate board
// labels and branding on F.SilkS.
stripFootprintSilkscreen();

fs.writeFileSync(boardPath, board);
fs.writeFileSync(
    encodedPath,
    zlib.gzipSync(Buffer.from(board), { level: 9 }).toString("base64") + "\n",
);
execFileSync(process.execPath, ["scripts/export-esp32-carrier-v3-cpl.mjs", boardPath], {
    stdio: "inherit",
});
console.log(`added GPIO34 battery sensing and throttle fail-safes to ${boardPath}`);
