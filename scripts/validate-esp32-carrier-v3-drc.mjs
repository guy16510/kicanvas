import fs from "node:fs";

const path = process.argv[2];
if (!path)
    throw new Error("usage: node validate-esp32-carrier-v3-drc.mjs <drc.json>");
const report = JSON.parse(fs.readFileSync(path, "utf8"));

const critical = new Set([
    "shorting_items",
    "tracks_crossing",
    "clearance",
    "hole_clearance",
    "holes_co_located",
    "solder_mask_bridge",
    "track_dangling",
    "via_dangling",
    "silk_edge_clearance",
    "silk_over_copper",
    "silk_overlap",
    "text_height",
]);
const markers = [
    "BAT_RAW",
    "BAT_FUSED",
    "PROTECT_GATE",
    "FET_COMMON",
    "VIN_PROTECTED",
    "OV_SENSE",
    "UV_SENSE",
    "PWR_EN",
    "PWR_RT",
    "PWR_FB",
    "PWR_SS",
    "+5V_SERVO",
    "PROTECT_SHDN",
    "PWR_SW",
    "UV_LOW_MID",
    "U4",
    "U5",
    "Q5",
    "Q6",
    "R31",
    "R32",
    "R33",
    "R34",
    "R35",
    "R36",
    "R37",
    "R38",
    "R39",
    "C4",
    "C5",
    "C6",
    "C7",
    "C8",
    "C9",
    "C10",
    "C11",
    "C12",
    "C13",
    "C14",
    "C15",
    "C16",
    "C17",
    "C18",
    "C19",
    "L1",
    "J_BAT",
    "J_PI_PWR",
    "FB2",
    "J_SERVO",
    "F1",
    "F2",
    "JP_ESP_PWR",
    "BATTERY_ADC_GPIO34",
    "BATTERY_DIVIDER_MID",
    "FRONT_ECHO_GPIO",
    "R40",
    "R41",
    "R42",
    "C20",
    "U_TRIG_L",
    "U_TRIG_F",
    "U_TRIG_R",
    "C21",
    "C22",
    "C23",
];
const text = (entry) =>
    (entry.items ?? []).map((item) => item.description ?? "").join(" ");
const isNew = (entry) => markers.some((marker) => text(entry).includes(marker));
// A production carrier cannot inherit electrical shorts, crossings, dangling
// copper, or open connections from the v2 fixture. Keep marker matching above
// for diagnostics, but fail the gate on the complete generated board.
const electrical = report.violations.filter(
    (entry) => entry.severity !== "exclusion",
);
const unconnected = report.unconnected_items;

if (electrical.length || unconnected.length) {
    console.error(
        `carrier v3 has ${electrical.length} critical DRC violation(s) and ${unconnected.length} unconnected item(s)`,
    );
    for (const entry of [...electrical, ...unconnected]) {
        console.error(`${entry.type}: ${text(entry)}`);
    }
    process.exit(1);
}
console.log(
    "carrier v3 electrical DRC gate: 0 critical violations, 0 unconnected items",
);
