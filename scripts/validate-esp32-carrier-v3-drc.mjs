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
    "solder_mask_bridge",
    "track_dangling",
    "via_dangling",
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
];
const text = (entry) =>
    (entry.items ?? []).map((item) => item.description ?? "").join(" ");
const isNew = (entry) => markers.some((marker) => text(entry).includes(marker));
const electrical = report.violations.filter(
    (entry) => critical.has(entry.type) && isNew(entry),
);
const unconnected = report.unconnected_items.filter(isNew);

if (electrical.length || unconnected.length) {
    console.error(
        `carrier v3 has ${electrical.length} new critical DRC violation(s) and ${unconnected.length} new unconnected item(s)`,
    );
    for (const entry of [...electrical, ...unconnected]) {
        console.error(`${entry.type}: ${text(entry)}`);
    }
    process.exit(1);
}
console.log(
    "carrier v3 electrical DRC gate: 0 new critical violations, 0 new unconnected items",
);
