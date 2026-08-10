import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const boardPath =
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const encodedPath = `${boardPath}.gz.b64`;

execFileSync(
    process.execPath,
    ["scripts/generate-esp32-carrier-v3-production.mjs"],
    {
        stdio: "inherit",
    },
);

const normalized = fs
    .readFileSync(boardPath, "utf8")
    .split("\n")
    .map((line) => {
        if (!line.includes("(segment ") && !line.includes("(via ")) return line;
        return line.replace(/\(net\s+(\d+)\s+"[^"]+"\)/g, "(net $1)");
    })
    .join("\n");

fs.writeFileSync(boardPath, normalized);
fs.writeFileSync(
    encodedPath,
    zlib.gzipSync(Buffer.from(normalized), { level: 9 }).toString("base64") +
        "\n",
);
console.log(`normalized routed net syntax in ${boardPath}`);
