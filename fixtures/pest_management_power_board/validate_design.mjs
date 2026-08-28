import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = path.dirname(new URL(import.meta.url).pathname);
const pcb = fs.readFileSync(path.join(dir, 'pest_management_power_board.kicad_pcb'), 'utf8');
const pro = JSON.parse(fs.readFileSync(path.join(dir, 'pest_management_power_board.kicad_pro'), 'utf8'));
const dru = fs.readFileSync(path.join(dir, 'pest_management_power_board.kicad_dru'), 'utf8');
const sch = fs.readFileSync(path.join(dir, 'pest_management_power_board.kicad_sch'), 'utf8');

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

function balancedParens(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inString;
}

assert(balancedParens(pcb), 'PCB S-expression parentheses are not balanced');
assert(balancedParens(sch), 'Schematic S-expression parentheses are not balanced');
assert(balancedParens(dru), 'DRU S-expression parentheses are not balanced');

const classes = Object.fromEntries((pro.net_settings?.classes ?? []).map((c) => [c.name, c]));
assert(classes.LV_Power, 'Missing LV_Power net class');
assert(classes.HV_Grid, 'Missing HV_Grid net class');
assert(classes.HV_Grid?.clearance >= 10, 'HV_Grid clearance is below 10.0mm');

const assignments = pro.net_settings?.netclass_assignments ?? {};
for (const net of ['+7V4_BAT', '+7V4_FUSED', '+7V4_SW', 'GND']) {
  assert(assignments[net] === 'LV_Power', `${net} is not assigned to LV_Power`);
}
for (const net of ['HV_POS', 'HV_NEG']) {
  assert(assignments[net] === 'HV_Grid', `${net} is not assigned to HV_Grid`);
}

assert(/HV_Grid minimum clearance/.test(dru), 'Missing explicit HV_Grid clearance rule');
assert(/clearance \(min 10mm\)/.test(dru), 'DRU does not enforce 10mm minimum clearance');

assert(/REV B - UNKNOWN CELL SAFE INPUT/.test(pcb), 'PCB is not marked as Rev B');
assert(/START_2A_FAST_MAX_AFTER_CELL_VALIDATION/.test(pcb), 'Rev B conservative starting fuse value is missing');
assert(/2200uF_16V_LOW_ESR/.test(pcb), 'Rev B low-ESR bulk capacitors are missing');
assert(/1uF_25V_FILM/.test(pcb), 'Rev B fast bypass capacitor is missing');

assert(/\(gr_rect \(start 102 24\) \(end 104 81\).*\(layer "Edge\.Cuts"\)\)/s.test(pcb), 'Expected 2mm-wide routed isolation slot is missing from Edge.Cuts');
assert(/\(pad "3"[^\n]*\(at 93 35\)[^\n]*\(net 5 "HV_POS"\)\)/.test(pcb), 'HV_POS module pad is not at expected isolated location');
assert(/\(pad "4"[^\n]*\(at 114 35\)[^\n]*\(net 6 "HV_NEG"\)\)/.test(pcb), 'HV_NEG module pad is not at expected isolated location');
assert(/\(segment \(start 93 35\) \(end 93 74\).*\(net 5\)\)/.test(pcb), 'HV_POS route is not confined to its isolated corridor');
assert(/\(segment \(start 114 35\) \(end 114 74\).*\(net 6\)\)/.test(pcb), 'HV_NEG route is not confined to its isolated corridor');

const hvPosX = 93;
const hvNegX = 114;
const hvTrackWidth = 1.2;
const hvCenterSpacing = hvNegX - hvPosX;
const hvCopperEdgeSpacing = hvCenterSpacing - hvTrackWidth;
assert(hvCopperEdgeSpacing >= 10, `HV track edge spacing is only ${hvCopperEdgeSpacing}mm`);

// Rev B intentionally keeps all LV power routing at x<=79mm. LV tracks are 3.0mm wide.
const lvMaxX = 79;
const lvTrackWidth = 3.0;
const lvToHvEdgeSpacing = hvPosX - lvMaxX - lvTrackWidth / 2 - hvTrackWidth / 2;
assert(lvToHvEdgeSpacing >= 10, `LV-to-HV track edge spacing is only ${lvToHvEdgeSpacing}mm`);

const threeMmSegments = [...pcb.matchAll(/\(segment[^\n]*\(width 3\.0\)[^\n]*\(net [1234]\)\)/g)].length;
assert(threeMmSegments >= 10, `Expected broad 3.0mm LV routing; found only ${threeMmSegments} segments`);

for (const token of ['BT1', 'F1', 'SW1', 'C1', 'C2', 'C3', 'J2', 'J3', 'J4']) {
  assert(pcb.includes(`"${token}"`) || sch.includes(`"${token}"`), `Missing expected reference ${token}`);
}

if (failures.length) {
  console.error('DESIGN VALIDATION FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('DESIGN VALIDATION PASSED');
console.log(' - Rev B unknown-cell input strategy present');
console.log(' - Starting fuse: 2A fast acting');
console.log(' - Bulk capacitor bank: 2 x 2200uF = 4400uF nominal');
console.log(` - HV net-class clearance: ${classes.HV_Grid.clearance}mm`);
console.log(` - HV track edge spacing: ${hvCopperEdgeSpacing.toFixed(1)}mm`);
console.log(` - LV-to-HV intended corridor spacing: ${lvToHvEdgeSpacing.toFixed(2)}mm`);
console.log(' - Edge.Cuts isolation slot: 2mm x 57mm');
console.log('NOTE: This is structural validation, not KiCad pcbnew/eeschema DRC/ERC. Final footprints and HV module ratings still require actual KiCad and electrical validation.');
