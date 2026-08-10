import fs from 'node:fs';
import zlib from 'node:zlib';

const SOURCE = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v2.kicad_pcb.gz.b64';
const OUT = 'fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb';
const OUT_B64 = `${OUT}.gz.b64`;

let board = zlib.gunzipSync(Buffer.from(fs.readFileSync(SOURCE, 'utf8').trim(), 'base64')).toString('utf8');

function endOfBlock(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i + 1;
  }
  throw new Error(`unterminated block at ${start}`);
}

function removeFootprint(ref) {
  for (let p = 0; ; ) {
    const start = board.indexOf('(footprint', p);
    if (start < 0) return;
    const end = endOfBlock(board, start);
    const block = board.slice(start, end);
    if (block.includes(`(property "Reference" "${ref}"`)) {
      board = board.slice(0, start) + board.slice(end);
      return;
    }
    p = end;
  }
}

function addNets(nets) {
  const firstFp = board.indexOf('(footprint');
  const prefix = board.slice(0, firstFp);
  const re = /\n\s*\(net\s+\d+\s+"[^"]+"\)/g;
  let m, at = -1;
  while ((m = re.exec(prefix))) at = m.index + m[0].length;
  if (at < 0) throw new Error('net insertion point not found');
  board = board.slice(0, at) + nets.map(([id, name]) => `\n  (net ${id} "${name}")`).join('') + board.slice(at);
}

function insertBefore(token, text) {
  const at = board.indexOf(token);
  if (at < 0) throw new Error(`missing insertion token ${token}`);
  board = board.slice(0, at) + text + '\n  ' + board.slice(at);
}

function smd2({ref, value, x, y, n1, s1, n2, s2, span = 1.1, sx = 1.2, sy = 1.2}) {
  return `(footprint "SMD2_${sx}x${sy}" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2.0 0) (layer "F.Fab") hide)
    (property "Value" "${value}" (at 0 2.0 0) (layer "F.Fab") hide)
    (pad "1" smd roundrect (at -${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n1} "${s1}"))
    (pad "2" smd roundrect (at ${span} 0) (size ${sx} ${sy}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${n2} "${s2}"))
  )`;
}

function pth2({ref, value, x, y, n1, s1, n2 = 3, s2 = 'GND', pitch = 5.08}) {
  return `(footprint "PTH2_${pitch}" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at ${pitch / 2} -3.0 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at ${pitch / 2} 3.0 0) (layer "F.Fab") hide)
    (pad "1" thru_hole rect (at 0 0) (size 3.2 3.2) (drill 1.3) (layers "*.Cu" "*.Mask") (net ${n1} "${s1}"))
    (pad "2" thru_hole circle (at ${pitch} 0) (size 3.2 3.2) (drill 1.3) (layers "*.Cu" "*.Mask") (net ${n2} "${s2}"))
  )`;
}

function radial({ref, value, x, y, n1, s1, n2 = 3, s2 = 'GND'}) {
  return `(footprint "CP_Radial_D8_P3.5" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 1.75 -4.8 0) (layer "F.SilkS"))
    (property "Value" "${value}" (at 1.75 4.8 0) (layer "F.Fab") hide)
    (fp_circle (center 1.75 0) (end 5.55 0) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0) (size 2.3 2.3) (drill 1.0) (layers "*.Cu" "*.Mask") (net ${n1} "${s1}"))
    (pad "2" thru_hole circle (at 3.5 0) (size 2.3 2.3) (drill 1.0) (layers "*.Cu" "*.Mask") (net ${n2} "${s2}"))
  )`;
}

function ltc4367() {
  return `(footprint "LTC4367_MSOP8" (layer "F.Cu") (at 37 120)
    (property "Reference" "U4" (at 0 -4.5 0) (layer "F.SilkS"))
    (property "Value" "LTC4367IMS8#PBF" (at 0 4.5 0) (layer "F.Fab") hide)
    (fp_rect (start -2.3 -3.0) (end 2.3 3.0) (stroke (width 0.2) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -2.2 -1.95) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 54 "BAT_FUSED"))
    (pad "2" smd roundrect (at -2.2 -0.65) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 59 "UV_SENSE"))
    (pad "3" smd roundrect (at -2.2 0.65) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 58 "OV_SENSE"))
    (pad "4" smd roundrect (at -2.2 1.95) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 3 "GND"))
    (pad "5" smd roundrect (at 2.2 1.95) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 65 "PROTECT_SHDN"))
    (pad "6" smd roundrect (at 2.2 0.65) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "7" smd roundrect (at 2.2 -0.65) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 57 "VIN_PROTECTED"))
    (pad "8" smd roundrect (at 2.2 -1.95) (size 1.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net 55 "PROTECT_GATE"))
  )`;
}

function to220({ref, x, y, rot, dNet, dName, sNet, sName}) {
  return `(footprint "TO-220-3" (layer "F.Cu") (at ${x} ${y} ${rot})
    (property "Reference" "${ref}" (at 2.54 -4.0 ${rot}) (layer "F.SilkS"))
    (property "Value" "STP100N10F7_100V" (at 2.54 4.0 ${rot}) (layer "F.Fab") hide)
    (fp_rect (start -1.5 -2.4) (end 6.6 2.4) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0 ${rot}) (size 2.3 2.3) (drill 1.1) (layers "*.Cu" "*.Mask") (net 55 "PROTECT_GATE"))
    (pad "2" thru_hole circle (at 2.54 0 ${rot}) (size 2.3 2.3) (drill 1.1) (layers "*.Cu" "*.Mask") (net ${dNet} "${dName}"))
    (pad "3" thru_hole circle (at 5.08 0 ${rot}) (size 2.3 2.3) (drill 1.1) (layers "*.Cu" "*.Mask") (net ${sNet} "${sName}"))
  )`;
}

function lt8645s() {
  const nets = new Map([
    [1,[2,'+5V']], [4,[57,'VIN_PROTECTED']], [5,[57,'VIN_PROTECTED']], [6,[57,'VIN_PROTECTED']],
    [8,[3,'GND']], [9,[3,'GND']], [10,[3,'GND']],
    [12,[66,'PWR_SW']], [13,[66,'PWR_SW']], [14,[66,'PWR_SW']], [15,[66,'PWR_SW']], [16,[66,'PWR_SW']],
    [17,[3,'GND']], [18,[3,'GND']], [19,[3,'GND']],
    [21,[57,'VIN_PROTECTED']], [22,[57,'VIN_PROTECTED']], [23,[57,'VIN_PROTECTED']],
    [25,[60,'PWR_EN']], [26,[61,'PWR_RT']], [28,[3,'GND']], [29,[63,'PWR_SS']], [30,[3,'GND']], [32,[62,'PWR_FB']],
    [33,[3,'GND']], [34,[3,'GND']], [35,[3,'GND']], [36,[3,'GND']], [37,[3,'GND']], [38,[3,'GND']],
  ]);
  const net = p => nets.has(p) ? ` (net ${nets.get(p)[0]} "${nets.get(p)[1]}")` : '';
  const pads = [];
  const ys = [-2.25,-1.75,-1.25,-0.75,-0.25,0.25,0.75,1.25,1.75,2.25];
  for (let i=0;i<10;i++) pads.push(`    (pad "${i+1}" smd roundrect (at -2.45 ${ys[i]}) (size 1.15 0.38) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${net(i+1)})`);
  const xb=[-1.25,-0.75,-0.25,0.25,0.75,1.25];
  for (let i=0;i<6;i++) pads.push(`    (pad "${11+i}" smd roundrect (at ${xb[i]} 3.45) (size 0.38 1.15) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${net(11+i)})`);
  for (let i=0;i<10;i++) pads.push(`    (pad "${17+i}" smd roundrect (at 2.45 ${ys[9-i]}) (size 1.15 0.38) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${net(17+i)})`);
  const xt=[1.25,0.75,0.25,-0.25,-0.75,-1.25];
  for (let i=0;i<6;i++) pads.push(`    (pad "${27+i}" smd roundrect (at ${xt[i]} -3.45) (size 0.38 1.15) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2)${net(27+i)})`);
  for (const [p,x,y] of [[33,-0.7,-1.75],[34,0.7,-1.75],[35,-0.7,0],[36,0.7,0],[37,-0.7,1.75],[38,0.7,1.75]])
    pads.push(`    (pad "${p}" smd rect (at ${x} ${y}) (size 1.15 1.25) (layers "F.Cu" "F.Paste" "F.Mask")${net(p)})`);
  return `(footprint "LT8645S_LQFN32_6x4_ADI" (layer "F.Cu") (at 78 126)
    (property "Reference" "U5" (at 0 -5.0 0) (layer "F.SilkS"))
    (property "Value" "LT8645SEV#PBF" (at 0 5.0 0) (layer "F.Fab") hide)
    (fp_rect (start -2.0 -3.0) (end 2.0 3.0) (stroke (width 0.16) (type default)) (fill none) (layer "F.SilkS"))
${pads.join('\n')}
  )`;
}

function inductor() {
  return `(footprint "XEL6060" (layer "F.Cu") (at 78 138)
    (property "Reference" "L1" (at 4.5 0 0) (layer "F.SilkS"))
    (property "Value" "2.7uH_XEL6060" (at 0 0 0) (layer "F.Fab") hide)
    (fp_rect (start -3.4 -4.5) (end 3.4 4.5) (stroke (width 0.25) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" smd roundrect (at 0 -3.0) (size 5.2 3.0) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.1) (net 66 "PWR_SW"))
    (pad "2" smd roundrect (at 0 3.0) (size 5.2 3.0) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.1) (net 2 "+5V"))
  )`;
}

function piPower() {
  return `(footprint "MiniFitJr_2x2" (layer "F.Cu") (at 111 143)
    (property "Reference" "J_PI_PWR" (at 2.1 -4.2 0) (layer "F.SilkS"))
    (property "Value" "5.1V_8A_TO_PI" (at 2.1 8.2 0) (layer "F.Fab") hide)
    (fp_rect (start -2.2 -2.2) (end 6.4 6.4) (stroke (width 0.3) (type default)) (fill none) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "2" thru_hole circle (at 4.2 0) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 2 "+5V"))
    (pad "3" thru_hole circle (at 0 4.2) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
    (pad "4" thru_hole circle (at 4.2 4.2) (size 3.0 3.0) (drill 1.4) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function servoHeader() {
  return `(footprint "Servo_1x03" (layer "F.Cu") (at 8 86)
    (property "Reference" "J_SERVO" (at 2.54 -2.7 0) (layer "F.SilkS"))
    (property "Value" "SIG_5V_GND" (at 2.54 2.7 0) (layer "F.Fab") hide)
    (pad "1" thru_hole rect (at 0 0) (size 2.0 2.0) (drill 1.0) (layers "*.Cu" "*.Mask") (net 15 "SERVO_SIG"))
    (pad "2" thru_hole circle (at 2.54 0) (size 2.0 2.0) (drill 1.0) (layers "*.Cu" "*.Mask") (net 64 "+5V_SERVO"))
    (pad "3" thru_hole circle (at 5.08 0) (size 2.0 2.0) (drill 1.0) (layers "*.Cu" "*.Mask") (net 3 "GND"))
  )`;
}

function via(x,y,net,name,size=1.0,drill=0.5) { return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net} "${name}"))`; }
function seg(x1,y1,x2,y2,w,layer,net,name) { return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${w}) (layer "${layer}") (net ${net} "${name}"))`; }

for (const ref of ['J5VIN','JGNDIN','JPIOUT5','JPIOUTG','J_SERVO']) removeFootprint(ref);
board = board.replace('(gr_rect (start 1 1) (end 129 109)', '(gr_rect (start 1 1) (end 129 154)');

addNets([
  [53,'BAT_RAW'],[54,'BAT_FUSED'],[55,'PROTECT_GATE'],[56,'FET_COMMON'],[57,'VIN_PROTECTED'],
  [58,'OV_SENSE'],[59,'UV_SENSE'],[60,'PWR_EN'],[61,'PWR_RT'],[62,'PWR_FB'],[63,'PWR_SS'],
  [64,'+5V_SERVO'],[65,'PROTECT_SHDN'],[66,'PWR_SW'],
]);

const hallCaps = [
  smd2({ref:'C4',value:'10nF_HALL_RC',x:24,y:18.6,n1:4,s1:'L_HALL_C_GPIO',n2:3,s2:'GND'}),
  smd2({ref:'C5',value:'10nF_HALL_RC',x:92,y:32.5,n1:3,s1:'GND',n2:19,s2:'L_HALL_A_GPIO'}),
  smd2({ref:'C6',value:'10nF_HALL_RC',x:92,y:38.5,n1:3,s1:'GND',n2:20,s2:'L_HALL_B_GPIO'}),
  smd2({ref:'C7',value:'10nF_HALL_RC',x:92,y:56.5,n1:3,s1:'GND',n2:23,s2:'R_HALL_A_GPIO'}),
  smd2({ref:'C8',value:'10nF_HALL_RC',x:92,y:62.5,n1:3,s1:'GND',n2:24,s2:'R_HALL_B_GPIO'}),
  smd2({ref:'C9',value:'10nF_HALL_RC',x:92,y:80.5,n1:3,s1:'GND',n2:27,s2:'R_HALL_C_GPIO'}),
];

const parts = [
  ...hallCaps,
  pth2({ref:'J_BAT',value:'36-42V_BATTERY',x:7,y:118,n1:53,s1:'BAT_RAW'}),
  smd2({ref:'F1',value:'3A_125V_FUSE',x:20,y:118,n1:53,s1:'BAT_RAW',n2:54,s2:'BAT_FUSED',span:2.0,sx:2.4,sy:3.2}),
  smd2({ref:'D1',value:'SMCJ48A_TVS',x:27,y:126,n1:54,s1:'BAT_FUSED',n2:3,s2:'GND',span:2.5,sx:2.8,sy:3.8}),
  ltc4367(),
  smd2({ref:'R35',value:'180k_1pct_OV_TOP',x:28,y:134,n1:54,s1:'BAT_FUSED',n2:58,s2:'OV_SENSE'}),
  smd2({ref:'R36',value:'120k_1pct_OV_UV',x:34,y:134,n1:58,s1:'OV_SENSE',n2:59,s2:'UV_SENSE'}),
  smd2({ref:'R37',value:'8.87M_1pct_UV_LOW_A',x:40,y:134,n1:59,s1:'UV_SENSE',n2:67,s2:'UV_LOW_MID',span:1.6,sx:1.6,sy:1.4}),
  smd2({ref:'R38',value:'8.87M_1pct_UV_LOW_B',x:46,y:134,n1:67,s1:'UV_LOW_MID',n2:3,s2:'GND',span:1.6,sx:1.6,sy:1.4}),
  smd2({ref:'R39',value:'470k_SHDN_PULLUP',x:43,y:126,n1:54,s1:'BAT_FUSED',n2:65,s2:'PROTECT_SHDN'}),
  to220({ref:'Q5',x:49,y:118,rot:0,dNet:54,dName:'BAT_FUSED',sNet:56,sName:'FET_COMMON'}),
  to220({ref:'Q6',x:62.16,y:118,rot:180,dNet:57,dName:'VIN_PROTECTED',sNet:56,sName:'FET_COMMON'}),
  radial({ref:'C10',value:'22uF_100V_INPUT_BULK',x:64,y:132,n1:57,s1:'VIN_PROTECTED'}),
  smd2({ref:'C11',value:'4.7uF_100V_X7R',x:68,y:126,n1:57,s1:'VIN_PROTECTED',n2:3,s2:'GND',span:1.5,sx:1.8,sy:1.8}),
  smd2({ref:'C12',value:'0.47uF_100V_LOCAL_L',x:72,y:126,n1:3,s1:'GND',n2:57,s2:'VIN_PROTECTED'}),
  lt8645s(),
  smd2({ref:'C13',value:'0.47uF_100V_LOCAL_R',x:84,y:126,n1:57,s1:'VIN_PROTECTED',n2:3,s2:'GND'}),
  smd2({ref:'R31',value:'100k_EN_PULLUP',x:86,y:120,n1:57,s1:'VIN_PROTECTED',n2:60,s2:'PWR_EN'}),
  smd2({ref:'R32',value:'88.7k_RT_500kHz',x:86,y:124,n1:61,s1:'PWR_RT',n2:3,s2:'GND'}),
  smd2({ref:'C14',value:'0.1uF_TRSS',x:80,y:118,n1:63,s1:'PWR_SS',n2:3,s2:'GND'}),
  smd2({ref:'R33',value:'1.06M_FB_TOP',x:70,y:118,n1:2,s1:'+5V',n2:62,s2:'PWR_FB'}),
  smd2({ref:'R34',value:'249k_FB_BOTTOM',x:70,y:122,n1:62,s1:'PWR_FB',n2:3,s2:'GND'}),
  smd2({ref:'C15',value:'4.7pF_FF',x:64,y:118,n1:2,s1:'+5V',n2:62,s2:'PWR_FB'}),
  inductor(),
  radial({ref:'C16',value:'100uF_10V_OUTPUT',x:91,y:144,n1:2,s1:'+5V'}),
  smd2({ref:'C17',value:'22uF_10V_X7R',x:99,y:143,n1:2,s1:'+5V',n2:3,s2:'GND',span:1.5,sx:1.8,sy:1.8}),
  smd2({ref:'C18',value:'22uF_10V_X7R',x:104,y:143,n1:2,s1:'+5V',n2:3,s2:'GND',span:1.5,sx:1.8,sy:1.8}),
  piPower(),
  servoHeader(),
  smd2({ref:'FB2',value:'5A_FERRITE_SERVO',x:18,y:90,n1:2,s1:'+5V',n2:64,s2:'+5V_SERVO',span:1.8,sx:2.0,sy:2.0}),
  radial({ref:'C19',value:'470uF_10V_SERVO_BULK',x:24,y:94,n1:64,s1:'+5V_SERVO'}),
];

// extra divider midpoint net must be declared after legacy IDs but before footprints are parsed
// inject it now because IDs are only labels in the source format and KiCad normalizes by name.
addNets([[67,'UV_LOW_MID']]);
insertBefore('(segment', parts.join('\n  '));

const routes = [
  // Hall filters, each capacitor is placed directly across the 20k lower divider leg.
  seg(22.9,16.2,22.9,18.6,0.25,'F.Cu',4,'L_HALL_C_GPIO'), seg(25.1,16.2,25.1,18.6,0.35,'F.Cu',3,'GND'),
  seg(93.1,30.2,93.1,32.5,0.25,'F.Cu',19,'L_HALL_A_GPIO'), seg(90.9,30.2,90.9,32.5,0.35,'F.Cu',3,'GND'),
  seg(93.1,36.2,93.1,38.5,0.25,'F.Cu',20,'L_HALL_B_GPIO'), seg(90.9,36.2,90.9,38.5,0.35,'F.Cu',3,'GND'),
  seg(93.1,54.2,93.1,56.5,0.25,'F.Cu',23,'R_HALL_A_GPIO'), seg(90.9,54.2,90.9,56.5,0.35,'F.Cu',3,'GND'),
  seg(93.1,60.2,93.1,62.5,0.25,'F.Cu',24,'R_HALL_B_GPIO'), seg(90.9,60.2,90.9,62.5,0.35,'F.Cu',3,'GND'),
  seg(93.1,78.2,93.1,80.5,0.25,'F.Cu',27,'R_HALL_C_GPIO'), seg(90.9,78.2,90.9,80.5,0.35,'F.Cu',3,'GND'),

  // 36-42V input and fuse.
  seg(7,118,18,118,1.5,'F.Cu',53,'BAT_RAW'),
  seg(22,118,51.54,118,1.5,'F.Cu',54,'BAT_FUSED'),
  seg(24.5,126,24.5,118,1.0,'F.Cu',54,'BAT_FUSED'),

  // LTC4367 sensing and control.
  seg(34.8,118.05,31,118.05,0.35,'F.Cu',54,'BAT_FUSED'), seg(31,118.05,31,132.9,0.35,'F.Cu',54,'BAT_FUSED'), seg(31,132.9,26.9,134,0.35,'F.Cu',54,'BAT_FUSED'),
  seg(29.1,134,32.9,134,0.25,'F.Cu',58,'OV_SENSE'), seg(34.8,120.65,32,120.65,0.25,'F.Cu',58,'OV_SENSE'), seg(32,120.65,32,134,0.25,'F.Cu',58,'OV_SENSE'),
  seg(35.1,134,38.4,134,0.25,'F.Cu',59,'UV_SENSE'), seg(34.8,119.35,33,119.35,0.25,'F.Cu',59,'UV_SENSE'), seg(33,119.35,33,133.2,0.25,'F.Cu',59,'UV_SENSE'), seg(33,133.2,35.1,134,0.25,'F.Cu',59,'UV_SENSE'),
  seg(41.6,134,44.4,134,0.25,'F.Cu',67,'UV_LOW_MID'),
  seg(41.2,121.95,41.9,121.95,0.25,'F.Cu',65,'PROTECT_SHDN'), seg(41.9,121.95,41.9,126,0.25,'F.Cu',65,'PROTECT_SHDN'),
  seg(39.2,118.05,49,116,0.35,'F.Cu',55,'PROTECT_GATE'), seg(49,116,62.16,116,0.35,'F.Cu',55,'PROTECT_GATE'), seg(49,116,49,118,0.35,'F.Cu',55,'PROTECT_GATE'), seg(62.16,116,62.16,118,0.35,'F.Cu',55,'PROTECT_GATE'),
  seg(39.2,119.35,59.62,119.35,0.35,'F.Cu',57,'VIN_PROTECTED'),
  seg(54.08,118,57.08,118,1.5,'F.Cu',56,'FET_COMMON'),

  // protected VIN to regulator and local input capacitors.
  seg(59.62,118,59.62,128,1.2,'F.Cu',57,'VIN_PROTECTED'), seg(59.62,128,64,132,1.2,'F.Cu',57,'VIN_PROTECTED'),
  seg(59.62,122,66.9,126,1.2,'F.Cu',57,'VIN_PROTECTED'), seg(66.9,126,70.9,126,1.0,'F.Cu',57,'VIN_PROTECTED'),
  seg(73.1,126,75.55,125.75,0.8,'F.Cu',57,'VIN_PROTECTED'), seg(75.55,125.25,75.55,126.25,0.8,'F.Cu',57,'VIN_PROTECTED'),
  seg(80.45,125.25,80.45,126.25,0.8,'F.Cu',57,'VIN_PROTECTED'), seg(80.45,125.75,82.9,126,0.8,'F.Cu',57,'VIN_PROTECTED'), seg(82.9,126,82.9,122,0.8,'F.Cu',57,'VIN_PROTECTED'), seg(82.9,122,59.62,122,0.8,'F.Cu',57,'VIN_PROTECTED'),

  // LT8645S control pins.
  seg(80.45,124.25,84.9,120,0.25,'F.Cu',60,'PWR_EN'),
  seg(80.45,123.75,84.9,124,0.25,'F.Cu',61,'PWR_RT'),
  seg(78.25,122.55,78.25,118,0.25,'F.Cu',63,'PWR_SS'), seg(78.25,118,78.9,118,0.25,'F.Cu',63,'PWR_SS'),
  seg(76.75,122.55,72,122,0.25,'F.Cu',62,'PWR_FB'), seg(72,122,71.1,122,0.25,'F.Cu',62,'PWR_FB'), seg(68.9,122,65.1,118,0.25,'F.Cu',62,'PWR_FB'),
  seg(78.75,122.55,78.75,121.5,0.35,'F.Cu',3,'GND'),
  seg(77.75,122.55,77.75,121.5,0.35,'F.Cu',3,'GND'),

  // switch node into inductor, compact and isolated from feedback.
  seg(76.75,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'), seg(77.25,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'), seg(77.75,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'), seg(78.25,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'), seg(78.75,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'), seg(79.25,129.45,78,135,0.65,'F.Cu',66,'PWR_SW'),

  // low-current +5V feed back into existing carrier bus and to BIAS/feedback network.
  seg(78,141,92,141,2.0,'B.Cu',2,'+5V'), seg(92,141,126,141,2.0,'B.Cu',2,'+5V'), seg(126,141,126,92,2.0,'B.Cu',2,'+5V'), seg(126,92,42,92,2.0,'B.Cu',2,'+5V'),
  seg(75.55,123.75,72,116,0.3,'B.Cu',2,'+5V'), seg(72,116,68.9,118,0.3,'B.Cu',2,'+5V'),
  seg(72,116,64,116,0.3,'B.Cu',2,'+5V'), seg(64,116,62.9,118,0.3,'B.Cu',2,'+5V'),

  // servo signal moved to a real 3-pin connector, filtered power branch.
  seg(8,80,8,86,0.3,'F.Cu',15,'SERVO_SIG'), seg(10.54,86,19.8,90,0.8,'F.Cu',64,'+5V_SERVO'), seg(19.8,90,24,94,0.8,'F.Cu',64,'+5V_SERVO'),
  seg(16.2,90,14,90,0.8,'F.Cu',2,'+5V'), seg(14,90,14,92,0.8,'F.Cu',2,'+5V'),
];

const vias = [
  via(31.5,126,3,'GND'), via(46,136.5,3,'GND'), via(34.2,122,3,'GND'),
  via(70.1,126,3,'GND'), via(85.9,126,3,'GND'), via(87.1,124,3,'GND'), via(81.1,118,3,'GND'), via(71.1,122,3,'GND'),
  via(74,129.75,3,'GND'), via(82,129.75,3,'GND'), via(77.3,124.25,3,'GND',0.9,0.45), via(78.7,124.25,3,'GND',0.9,0.45),
  via(77.3,126,3,'GND',0.9,0.45), via(78.7,126,3,'GND',0.9,0.45), via(77.3,127.75,3,'GND',0.9,0.45), via(78.7,127.75,3,'GND',0.9,0.45),
  via(100.1,143,3,'GND'), via(105.1,143,3,'GND'), via(27.5,94,3,'GND'),
  via(90,141,2,'+5V',1.2,0.6),
];

const localGround = [
  seg(34.8,121.95,34.2,122,0.35,'F.Cu',3,'GND'), seg(29.5,126,31.5,126,0.7,'F.Cu',3,'GND'),
  seg(69.1,126,70.1,126,0.4,'F.Cu',3,'GND'), seg(85.1,126,85.9,126,0.4,'F.Cu',3,'GND'),
  seg(87.1,124,87.1,124,0.3,'F.Cu',3,'GND'), seg(81.1,118,81.1,118,0.3,'F.Cu',3,'GND'), seg(71.1,122,71.1,122,0.3,'F.Cu',3,'GND'),
  seg(75.55,129.25,74,129.75,0.45,'F.Cu',3,'GND'), seg(75.55,129.75,74,129.75,0.45,'F.Cu',3,'GND'), seg(75.55,130.25,74,129.75,0.45,'F.Cu',3,'GND'),
  seg(80.45,129.25,82,129.75,0.45,'F.Cu',3,'GND'), seg(80.45,129.75,82,129.75,0.45,'F.Cu',3,'GND'), seg(80.45,130.25,82,129.75,0.45,'F.Cu',3,'GND'),
  seg(100.1,143,100.1,143,0.3,'F.Cu',3,'GND'), seg(105.1,143,105.1,143,0.3,'F.Cu',3,'GND'), seg(27.5,94,27.5,94,0.3,'F.Cu',3,'GND'),
];

const zones = [
  `(zone (net 3) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.35)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.4))
    (polygon (pts (xy 2 108) (xy 128 108) (xy 128 153) (xy 2 153)))
  )`,
  `(zone (net 2) (net_name "+5V") (layer "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.45)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.35) (thermal_bridge_width 0.6))
    (polygon (pts (xy 75 139.5) (xy 126 139.5) (xy 126 151) (xy 75 151)))
  )`,
];

const graphics = [
  '(gr_rect (start 3 110) (end 127 152) (stroke (width 0.35) (type dash)) (fill none) (layer "F.SilkS"))',
  '(gr_text "36-42V PROTECTED POWER | LTC4367 + LT8645S | 5.1V / 8A" (at 65 112.5) (layer "F.SilkS") (effects (font (size 1.25 1.25) (thickness 0.25))))',
  '(gr_text "KEEP SENSOR/HALL ROUTING OUT OF POWER AREA" (at 65 151.5) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.18))))',
];

insertBefore('(zone', [...routes,...localGround,...vias,...graphics,...zones].join('\n  '));

fs.writeFileSync(OUT, board);
fs.writeFileSync(OUT_B64, zlib.gzipSync(Buffer.from(board), {level:9}).toString('base64') + '\n');
console.log(`generated ${OUT}, ${Buffer.byteLength(board)} bytes`);
