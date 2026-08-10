import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const BOARD='fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb';
const ENCODED=`${BOARD}.gz.b64`;
execFileSync(process.execPath,['scripts/route-esp32-carrier-v3-drc5.mjs'],{stdio:'inherit'});
let board=fs.readFileSync(BOARD,'utf8');

function endOfBlock(source,start){let d=0;for(let i=start;i<source.length;i++){if(source[i]==='(')d++;else if(source[i]===')'&&--d===0)return i+1;}throw new Error('unterminated block');}
function blocks(token){const out=[];let p=0;while((p=board.indexOf(token,p))>=0){const end=endOfBlock(board,p);out.push({start:p,end,text:board.slice(p,end)});p=end;}return out;}
function seg(x1,y1,x2,y2,w,layer,net){return `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${w}) (layer "${layer}") (net ${net}))`;}
function via(x,y,net,size=0.9,drill=0.45){return `(via (at ${x} ${y}) (size ${size}) (drill ${drill}) (layers "F.Cu" "B.Cu") (net ${net}))`;}

const del=[];
for(const token of ['(segment','(via']){
  for(const e of blocks(token)){
    if(!e.text.includes('(net 55)')) continue;
    if(
      e.text.includes('(start 40 136) (end 70 136)') ||
      e.text.includes('(at 70 136)') ||
      e.text.includes('(start 70 136) (end 70 116)') ||
      e.text.includes('(start 70 116) (end 62.16 116)')
    ) del.push(e);
  }
}
for(const e of del.sort((a,b)=>b.start-a.start)) board=board.slice(0,e.start)+board.slice(e.end);

const route=[
  seg(40,136,72,136,0.25,'F.Cu',55),
  via(72,136,55),
  seg(72,136,72,116,0.25,'B.Cu',55),
  seg(72,116,62.16,116,0.25,'B.Cu',55),
].join('\n  ');
const insert=board.indexOf('(zone');
board=board.slice(0,insert)+route+'\n  '+board.slice(insert);
fs.writeFileSync(BOARD,board);
fs.writeFileSync(ENCODED,zlib.gzipSync(Buffer.from(board),{level:9}).toString('base64')+'\n');
console.log(`DRC6 routed ${BOARD}`);
