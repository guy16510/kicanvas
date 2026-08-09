import fs from 'node:fs';
import process from 'node:process';

const path = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v2.kicad_pcb';
const text = fs.readFileSync(path, 'utf8');

const failures = [];
const requireText = (needle, label) => {
  if (!text.includes(needle)) failures.push(`missing ${label}: ${needle}`);
};

if (!text.startsWith('(kicad_pcb')) failures.push('fixture is not a KiCad PCB S-expression');

// Critical power contract for the 30-pin DOIT-style ESP32 DevKit carrier.
requireText('VIN_5V', 'ESP32 VIN/5V net');
requireText('+3V3', 'ESP32 3.3V rail');
requireText('GND', 'ground rail');
requireText('ESP32_LEFT_HEADER', 'left ESP32 socket');
requireText('ESP32_RIGHT_HEADER', 'right ESP32 socket');

// Motor control and safety outputs.
for (const name of [
  'LEFT_THROTTLE_OUT','RIGHT_THROTTLE_OUT',
  'LEFT_REVERSE_OD','RIGHT_REVERSE_OD',
  'LEFT_BRAKE_OD','RIGHT_BRAKE_OD'
]) requireText(name, name);

// Sensor inputs.
for (const name of [
  'R_HALL_A_RAW','R_HALL_B_RAW','R_HALL_C_RAW',
  'L_HALL_A_RAW','L_HALL_B_RAW','L_HALL_C_RAW',
  'FRONT_ECHO_RAW','LEFT_ECHO_RAW','RIGHT_ECHO_RAW'
]) requireText(name, name);

// Future expansion.
for (const name of ['SERVO_SIG','AUX_GPIO12','AUX_GPIO2','UART_RX','UART_TX']) {
  requireText(name, name);
}

// Explicit divider values and reverse/brake stage parts.
const count = (re) => (text.match(re) || []).length;
if (count(/\(property "Value" "10k"/g) < 9) failures.push('expected at least nine 10k divider resistors');
if (count(/\(property "Value" "20k"/g) < 9) failures.push('expected at least nine 20k divider resistors');
if (count(/\(property "Value" "2N7002"/g) < 4) failures.push('expected four 2N7002 brake/reverse MOSFETs');

if (failures.length) {
  console.error('ESP32 carrier validation FAILED');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log('ESP32 carrier validation PASS');
