import fs from 'node:fs';
import crypto from 'node:crypto';

const path = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v2.kicad_pcb';
const text = fs.readFileSync(path, 'utf8');
const failures = [];
const requireText = (needle, label = needle) => {
  if (!text.includes(needle)) failures.push(`missing ${label}: ${needle}`);
};
const count = (re) => (text.match(re) || []).length;

const expectedSha = 'd76be0c4625d4a34c3e5a09d863da20c15aa4491002270aa1ff017080ce78dda';
const actualSha = crypto.createHash('sha256').update(text).digest('hex');
if (actualSha !== expectedSha) failures.push(`fixture SHA mismatch: ${actualSha}`);
if (!text.startsWith('(kicad_pcb')) failures.push('not a KiCad PCB S-expression');

// Exact power pins for the common 30-pin DOIT ESP32 DevKit carrier.
// Left header pin 15 = VIN/5V, left pin 14 = GND.
// Right header pin 1 = 3V3, right pin 2 = GND.
const footprintBlock = (ref) => {
  const marker = `(property "Reference" "${ref}"`;
  const i = text.indexOf(marker);
  if (i < 0) return '';
  const start = text.lastIndexOf('(footprint', i);
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === '(') depth++;
    else if (text[j] === ')') {
      depth--;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  return '';
};
const left = footprintBlock('J_ESP_L');
const right = footprintBlock('J_ESP_R');
for (const [block, pin, net, label] of [
  [left, '15', '+5V', 'left ESP32 VIN/5V'],
  [left, '14', 'GND', 'left ESP32 GND'],
  [right, '1', '+3V3', 'right ESP32 3V3'],
  [right, '2', 'GND', 'right ESP32 GND'],
]) {
  const re = new RegExp(`\\(pad "${pin}"[^\\n]*\\(net \\d+ "${net.replace('+', '\\+')}"\\)`);
  if (!re.test(block)) failures.push(`wrong or missing ${label} mapping`);
}

// Four dedicated 3V3/GND rail pairs plus the original AUX point.
for (let i = 1; i <= 4; i++) {
  requireText(`"J3V3_${i}"`, `3V3 rail ${i}`);
  requireText(`"JGND3_${i}"`, `GND rail ${i}`);
}
requireText('"J3V3"', '3V3 AUX pad');

// Drive/safety contract.
for (const name of [
  'L_THROTTLE_GPIO','R_THROTTLE_GPIO','L_REVERSE_GPIO','R_REVERSE_GPIO',
  'L_BRAKE_GPIO','R_BRAKE_GPIO','L_REVERSE_CONN','R_REVERSE_CONN',
  'L_BRAKE_CONN','R_BRAKE_CONN'
]) requireText(name);
for (const jp of ['JP_RBRK','JP_LBRK','JP_LREV','JP_RREV']) requireText(`"${jp}"`, jp);
if (count(/\(property "Value" "2N7002"/g) !== 4) failures.push('expected exactly four 2N7002 output MOSFETs');

// Sensor protection must be exactly 10k over 20k on all six Hall and three ECHO inputs.
if (count(/\(property "Value" "10k"/g) < 9) failures.push('expected at least nine 10k divider resistors');
if (count(/\(property "Value" "20k"/g) !== 9) failures.push('expected exactly nine 20k divider resistors');
if (count(/\(property "Value" "18k"/g) !== 0) failures.push('18k divider value must not remain');
for (const name of [
  'L_HALL_A_RAW','L_HALL_B_RAW','L_HALL_C_RAW','R_HALL_A_RAW','R_HALL_B_RAW','R_HALL_C_RAW',
  'FRONT_ECHO_RAW','LEFT_ECHO_RAW','RIGHT_ECHO_RAW'
]) requireText(name);

// Robot arm and future I/O.
for (const name of ['SERVO_SIG','AUX_GPIO12','AUX_GPIO2','UART_RX0_GPIO3','UART_TX0_GPIO1']) requireText(name);

// 5V RGB section. GPIO2 is buffered to a 5V output rather than driving the strip directly.
requireText('"U_RGB"', 'RGB level shifter');
requireText('"74AHCT1G125"', 'RGB AHCT buffer');
requireText('"C3"', 'RGB buffer decoupling capacitor');
requireText('RGB_DATA_5V');
for (const ref of ['J_RGB_5V','J_RGB_DATA','J_RGB_GND']) requireText(`"${ref}"`, ref);

// Human-facing PCB labels must survive regeneration.
for (const label of [
  'RGB LIGHTS','5V INPUT ONLY','SERVO / GPIO13','ARM AUX / GPIO12','ARM AUX / GPIO2',
  'RIGHT BRAKE / GPIO32','LEFT BRAKE / GPIO33','LEFT THROTTLE / GPIO25','RIGHT THROTTLE / GPIO26',
  'LEFT REVERSE / GPIO27','RIGHT REVERSE / GPIO14','3V3 RAIL 1','3V3 RAIL 4',
  'JUMPERS MUST BE CLOSED TO ENABLE BRAKE/REVERSE'
]) requireText(label, `silkscreen ${label}`);

if (failures.length) {
  console.error('ESP32 carrier contract FAILED');
  failures.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}
console.log(`ESP32 carrier contract PASS, sha256=${actualSha}`);
