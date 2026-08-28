import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const pcb = fs.readFileSync(path.join(dir, 'pest_management_power_board_rev_c.kicad_pcb'), 'utf8');
const pro = JSON.parse(fs.readFileSync(path.join(dir, 'pest_management_power_board_rev_c.kicad_pro'), 'utf8'));
const bom = fs.readFileSync(path.join(dir, 'BOM_REV_C.csv'), 'utf8');
const arch = fs.readFileSync(path.join(dir, 'REV_C_ARCHITECTURE.md'), 'utf8');
const failures = [];
const assert = (ok, msg) => { if (!ok) failures.push(msg); };

function balanced(text) {
  let d = 0, s = false, esc = false;
  for (const ch of text) {
    if (s) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') s = false; continue; }
    if (ch === '"') s = true;
    else if (ch === '(') d++;
    else if (ch === ')') { d--; if (d < 0) return false; }
  }
  return d === 0 && !s;
}

assert(balanced(pcb), 'Rev C PCB S-expression is unbalanced');
const classes = Object.fromEntries((pro.net_settings?.classes ?? []).map(c => [c.name, c]));
assert(classes.LV_Power?.track_width >= 3, 'Rev C LV_Power track width below 3mm');
assert(classes.HV_Grid?.clearance >= 10, 'Rev C HV clearance below 10mm');
const a = pro.net_settings?.netclass_assignments ?? {};
for (const n of ['BAT_P','BAT_FUSED','BAT_SW','+12V_HV','GND']) assert(a[n] === 'LV_Power', `${n} not LV_Power`);
for (const n of ['HV_POS','HV_NEG']) assert(a[n] === 'HV_Grid', `${n} not HV_Grid`);
for (const ref of ['CHG1','BT1','F1','SW1','C1','C2','U1','HV1','J3','J4']) assert(pcb.includes(`"${ref}"`), `Missing ${ref}`);
assert(pcb.includes('USB-C_5V_TO_2S_8V4_1A'), 'USB-C 2S charger footprint missing');
assert(pcb.includes('POLOLU_U3V70F12_12V_BOOST'), '12V boost interface missing');
assert(pcb.includes('ANALOG_TECH_AHV12V5KV2MAW_OFFBOARD'), 'Selected 5kV converter interface missing');
assert(/\(gr_rect \(start 142 25\) \(end 145 95\).*Edge\.Cuts/s.test(pcb), 'Rev C isolation slot missing');
assert(/\(segment \(start 133 38\) \(end 133 85\).*\(net 6\)/.test(pcb), 'HV_POS corridor missing');
assert(/\(segment \(start 157 38\) \(end 157 85\).*\(net 7\)/.test(pcb), 'HV_NEG corridor missing');
const hvEdge = (157 - 133) - 1.2;
assert(hvEdge >= 10, `HV edge spacing only ${hvEdge}mm`);
assert(bom.includes('AHV12V5KV2MAW'), 'Rev C BOM missing selected HV converter');
assert(bom.includes('U3V70F12'), 'Rev C BOM missing selected boost regulator');
assert(/USB-C/.test(bom) && /8\.4V/.test(bom), 'Rev C BOM missing USB-C 2S charger');
assert(/charge with the HV system switched off/i.test(arch), 'Charging interlock/use rule missing from architecture');

if (failures.length) {
  console.error('REV C VALIDATION FAILED');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('REV C STRUCTURAL VALIDATION PASSED');
console.log(` - HV copper-edge spacing: ${hvEdge.toFixed(1)}mm`);
console.log(` - HV net-class clearance: ${classes.HV_Grid.clearance}mm`);
console.log(' - USB-C 2S charger, 12V boost, and AHV12V5KV2MAW interfaces present');
console.log('NOTE: Structural validation only. Run actual KiCad DRC/ERC and verify final module/connector footprints before fabrication.');
