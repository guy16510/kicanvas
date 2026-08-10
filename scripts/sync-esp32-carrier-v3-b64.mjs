import fs from "node:fs";
import zlib from "node:zlib";

const boardPath =
    process.argv[2] ??
    "fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb";
const encodedPath = process.argv[3] ?? `${boardPath}.gz.b64`;
const board = fs.readFileSync(boardPath);
const encoded = zlib.gzipSync(board, { level: 9 }).toString("base64") + "\n";

fs.writeFileSync(encodedPath, encoded);

const decoded = zlib.gunzipSync(
    Buffer.from(fs.readFileSync(encodedPath, "utf8").trim(), "base64"),
);
if (!decoded.equals(board)) throw new Error("compressed board round-trip mismatch");

console.log(`synced ${encodedPath} to ${boardPath} (${board.length} bytes)`);
