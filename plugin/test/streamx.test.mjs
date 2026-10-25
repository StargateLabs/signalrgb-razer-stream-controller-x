import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../Razer_Stream_Controller_X.js',import.meta.url),'utf8');
let calls=0;
const color=(x,y)=>[x%256,y%256,(x+y)%256];
const context={Serial:{},LCD:{},device:{color(x,y){calls++;return color(x,y);}}};
vm.createContext(context);
vm.runInContext(source.replace(/^import .*;\r?$/gm,'').replace(/export function /g,'function '),context);
const frame=vm.runInContext('sampleCanvasSelective()',context);
assert.equal(frame.length,480*288*2);
assert.equal(calls,480*288,'full resolution without missing pixels');
for(let y=0;y<288;y++)for(let x=0;x<480;x++){
 const [r,g,b]=color(x,y),i=(y*480+x)*2;
 assert.equal(frame[i]|frame[i+1]<<8,((r&248)<<8)|((g&252)<<3)|(b>>3),'RGB565 pixel position and byte order');
}
context.testFrame=frame;
vm.runInContext('state.lastFrame=testFrame; refreshCommittedSignatures();',context);
calls=0;
const same=vm.runInContext('sampleCanvasSelective()',context);
assert.deepEqual(Array.from(same),Array.from(frame));
assert.ok(calls<480*288/4,'unchanged canvas keeps selective sampling');
context.device.color=()=>[255,0,0];
const changed=vm.runInContext('sampleCanvasSelective()',context);
for(let i=0;i<changed.length;i+=2){assert.equal(changed[i],0);assert.equal(changed[i+1],248);}
console.log('Stream X: all 138240 pixel positions and RGB565 bytes verified; unchanged reuse and full moving canvas verified.');

// LCD data must stay full resolution and reach the uploader without resampling.
const lcdFrame=Array.from({length:480*288*2},(_,i)=>i%256);
let nativeCalls=0;
context.LCD.getSlicedFrame=options=>{
 nativeCalls++;assert.equal(options.format,'RGB565');assert.equal(options.arrayBuffer,true);
 assert.equal(options.screens.length,15);
 return options.screens.map(rect=>{
  assert.equal(rect.width,96);assert.equal(rect.height,96);
  assert.equal(rect.outputWidth,96);assert.equal(rect.outputHeight,96);
  const tile=new Uint8Array(96*96*2);
  for(let y=0;y<96;y++)for(let x=0;x<192;x++)tile[y*192+x]=lcdFrame[((rect.y+y)*480+rect.x)*2+x];
  return tile.buffer;
 });
};
context.device.log=()=>{};
context.device.color=()=>{throw Error('LCD must not sample the lighting canvas');};
assert.deepEqual(Array.from(vm.runInContext('sampleLCDFrame()',context)),lcdFrame);
assert.equal(nativeCalls,1);
assert.equal(vm.runInContext('state.sampledKeys',context),null);
context.LCD.getSlicedFrame=()=>[new Uint8Array(72*72*2)];
assert.equal(vm.runInContext('sampleLCDFrame()',context),null,'reject downscaled frame');
context.LCD.getSlicedFrame=()=>{throw Error('compositor not ready');};
assert.equal(vm.runInContext('sampleLCDFrame()',context),null,'wait safely for compositor');
context.DisplaySource='Canvas';
assert.equal(vm.runInContext('getDisplaySource()',context),'Canvas');
context.DisplaySource='LCD';
assert.equal(vm.runInContext('getDisplaySource()',context),'LCD');
console.log('Stream X LCD: exact native frame, no per-pixel calls, wrong-size/error guard and mode selection verified.');

// Every LCD tile must reach its physical key in one serial batch, followed by DRAW.
const writes=[];
context.Serial.write=bytes=>writes.push(Array.from(bytes));
context.Serial.readAll=()=>[];
context.lcdFrame=lcdFrame;
vm.runInContext('state.lastFrame=null; state.previewCount=3; pushFrame(lcdFrame);',context);
assert.equal(writes.length,1,'one serial write for a complete update');
const wire=writes[0];
assert.equal(wire.length,276896);
for(let k=0;k<15;k++){
 const base=k*18459,px=(k%5)*96,py=Math.floor(k/5)*96;
 assert.equal(wire[base+15],0x10);
 assert.equal((wire[base+19]<<8)|wire[base+20],px);
 assert.equal((wire[base+21]<<8)|wire[base+22],py);
 for(let y=0;y<96;y++)for(let b=0;b<192;b++)
  assert.equal(wire[base+27+y*192+b],lcdFrame[((py+y)*480+px)*2+b]);
}
assert.equal(wire[15*18459+7],0x0f,'DRAW follows all fifteen full-resolution keys');
console.log('Stream X LCD wire: all fifteen 96x96 tiles exact; one batch and one final DRAW verified.');

context.lcdFrame=new Uint8Array(lcdFrame);
vm.runInContext('state.lastFrame=null; state.txID=0; pushFrame(lcdFrame);',context);
context.lcdFrame=lcdFrame;
vm.runInContext('state.lastFrame=null; state.txID=0; pushFrame(lcdFrame);',context);
assert.deepEqual(writes[1],writes[2],'native typed buffers and Canvas arrays produce identical USB bytes');
console.log('Stream X LCD: typed bulk copies preserve every USB byte of the Canvas array path.');
