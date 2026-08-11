import fs from "node:fs";

const path = "scripts/apply-esp32-carrier-v3-hand-solder.mjs";
let source = fs.readFileSync(path, "utf8");

const oldImplementation = `function insertBefore(token, text) {
    const at = board.indexOf(token);
    if (at < 0) throw new Error(\`insertion token not found: \${token}\`);
    board = board.slice(0, at) + text + "\\n  " + board.slice(at);
}`;

const newImplementation = `function topLevelIndex(token) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < board.length; i += 1) {
        const character = board[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === "\\\\") escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === "(") {
            if (depth === 1 && board.startsWith(token, i)) return i;
            depth += 1;
            continue;
        }
        if (character === ")") depth -= 1;
    }
    return -1;
}

function insertBefore(token, text) {
    const at = topLevelIndex(token);
    if (at < 0) throw new Error(\`top-level insertion token not found: \${token}\`);
    board = board.slice(0, at) + text + "\\n  " + board.slice(at);
}`;

if (source.includes(newImplementation)) {
    console.log("hand-solder transform already uses top-level insertion");
    process.exit(0);
}
if (!source.includes(oldImplementation)) {
    throw new Error("expected insertBefore implementation not found");
}
source = source.replace(oldImplementation, newImplementation);
fs.writeFileSync(path, source);
console.log("fixed hand-solder transform to insert only top-level KiCad nodes");
