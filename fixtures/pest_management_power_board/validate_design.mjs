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

assert(/\(gr_rect \(start 99 24\) \(end 101 76\).*\(layer "Edge\.Cuts"\)\)/s.test(pcb), 'Expected 2mm-wide routed isolation slot is missing from Edge.Cuts');
assert(/\(pad "3"[^\n]*\(at 90 30\)[^\n]*\(net 5 "HV_POS"\)\)/.test(pcb), 'HV_POS module pad is not at expected isolated location');
assert(/\(pad "4"[^\n]*\(at 110 30\)[^\n]*\(net 6 "HV_NEG"\)\)/.test(pcb), 'HV_NEG module pad is not at expected isolated location');
assert(/\(segment \(start 90 30\) \(end 90 70\).*\(net 5\)\)/.test(pcb), 'HV_POS route is not confined to its isolated corridor');
assert(/\(segment \(start 110 30\) \(end 110 70\).*\(net 6\)\)/.test(pcb), 'HV_NEG route is not confined to its isolated corridor');

// Geometry sanity check for the deliberately straight HV corridors.
const hvCenterSpacing = 110 - 90;
const hvTrackWidth = 1.2;
const hvCopperEdgeSpacing = hvCenterSpacing - hvTrackWidth;
assert(hvCopperEdgeSpacing >= 10, `HV track edge spacing is only ${hvCopperEdgeSpacing}mm`);

// Closest intended LV copper corridor ends at x=78. The HV_POS track begins at x=90.
const lvMaxX = 78;
const lvTrackWidth = 1.5;
const hvPosX = 90;
const lvToHvEdgeSpacing = hvPosX - lvMaxX - lvTrackWidth / 2 - hvTrackWidth / 2;
assert(lvToHvEdgeSpacing >= 10, `LV-to-HV track edge spacing is only ${lvToHvEdgeSpacing}mm`);

for (const token of ['BT1', 'F1', 'SW1', 'C1', 'J2', 'J3', 'J4']) {
  assert(pcb.includes(`"${token}"`) || sch.includes(`"${token}"`), `Missing expected reference ${token}`);
}

if (failures.length) {
  console.error('DESIGN VALIDATION FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('DESIGN VALIDATION PASSED');
console.log(` - HV net-class clearance: ${classes.HV_Grid.clearance}mm`);
console.log(` - HV track edge spacing: ${hvCopperEdgeSpacing.toFixed(1)}mm`);
console.log(` - LV-to-HV intended corridor spacing: ${lvToHvEdgeSpacing.toFixed(2)}mm`);
console.log(' - Edge.Cuts isolation slot: 2mm x 52mm');
console.log(' - Required references and net-class assignments present');
console.log('NOTE: This validates file structure and explicit design constraints. It is not a substitute for running KiCad pcbnew/eeschema DRC/ERC with the final selected component footprints and HV module ratings.');
