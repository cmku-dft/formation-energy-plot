const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('app.js','utf8');
function engine(){
  const ctx = vm.createContext({});
  // Exercise the shipped functions; omit only UI initialization/listener registration.
  vm.runInContext(src.slice(0,src.indexOf('/* ============================================================ wiring */')) +
    src.slice(src.indexOf('const FIGCOL'),src.indexOf('/* ---------- figure controls ---------- */')) +
    src.slice(src.indexOf('function pngWithDpi'),src.indexOf('async function rasterize')),ctx);
  return expr => vm.runInContext(expr,ctx,{timeout:3000});
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function host(run,formula,dhf,phases=[]){ run(`S.hostCoeff=parseFormula(${JSON.stringify(formula)}); S.elements=Object.keys(S.hostCoeff); S.hostDHf=${dhf}; S.phases=${JSON.stringify(phases)}; S.axX=S.elements[0]; S.axY=S.elements[1]; computeVertices(); S.valid=true; S.dmu={...S.verts[0]?.dmu};`); }
test('formulas: nested groups, fractional stoichiometry and invalid input',()=>{
 const r=engine(); near(r('parseFormula("Ca3(PO4)2").O'),8); near(r('parseFormula("Ba0.5Sr0.5TiO3").Ba'),.5);
 for(const f of ['', 'ZnO!', 'Zn(O', 'Zn[O)', 'Zn0O','XxO','Zn1.2.3O','Zn()O']) assert.equal(r(`parseFormula(${JSON.stringify(f)})`),null,f);
});
test('binary endpoints include formula coefficients',()=>{
 for(const [f,h,el,n] of [['ZnO',-3.5,'O',1],['ZnF2',-6,'F',2],['In2O3',-9,'O',3]]){
  const r=engine(); host(r,f,h); assert.equal(r('S.verts.length'),2);
  near(r(`Math.min(...S.verts.map(v=>v.dmu.${el}))`),h/n);
  assert.ok(r('S.verts.every(v=>Math.abs(feasibility(v.dmu).hostResid)<1e-7 && feasibility(v.dmu).viol.length===0)'));
 }
});
test('competing phase clips binary interval; unstable host has no conditions',()=>{
 const r=engine(); host(r,'ZnO',-3.5,[{name:'ZnO2',comp:{Zn:1,O:2},dHf:-4}]);
 near(r('Math.max(...S.verts.map(v=>v.dmu.O))'),-.5);
 host(r,'ZnO',-3.5,[{name:'other ZnO',comp:{Zn:1,O:1},dHf:-4}]); assert.equal(r('S.verts.length'),0);
});
test('ternary and quaternary elemental simplices',()=>{
 const r=engine(); host(r,'SrTiO3',-15); assert.equal(r('S.verts.length'),3);
 host(r,'CuZnSnS4',-12); assert.equal(r('S.verts.length'),4);
 assert.ok(r('S.verts.every(v=>feasibility(v.dmu).viol.length===0 && Math.abs(feasibility(v.dmu).hostResid)<1e-7)'));
});
test('demo phases and all calculated vertices satisfy every inequality',()=>{
 const r=engine(); r('S.hostCoeff=parseFormula(DEMO.host); S.elements=Object.keys(S.hostCoeff); S.hostDHf=DEMO.dHf; S.phases=loadPhases(DEMO.phases,S.elements).list; computeVertices();');
 assert.equal(r('S.verts.length'),6);
 assert.ok(r('S.verts.every(v=>feasibility(v.dmu).viol.length===0 && Math.abs(feasibility(v.dmu).hostResid)<1e-7)'));
});
test('formation energies: vacancy and added-atom signs, reference, charge and correction',()=>{
 const r=engine(); host(r,'ZnO',-3.5); r('S.bulk=-100; S.vbm=2; S.muRef={Zn:-1,O:-4}; S.dmu={Zn:-1,O:-2.5};');
 near(r('ef({Etot:-94,Ecorr:.2,q:2,dn:{Zn:0,O:-1}},.5)'),4.7);
 near(r('ef({Etot:-101,Ecorr:0,q:0,dn:{Zn:1,O:0}},0)'),1);
});
test('lower envelope resolves transitions, excludes metastable states and duplicate charge energies',()=>{
 const r=engine();
 const e=r('envelope([{q:2,A:0},{q:1,A:2},{q:0,A:2}],2)');
 assert.equal(e.levels.length,1); near(e.levels[0].eps,1); assert.equal(e.levels[0].q1,2); assert.equal(e.levels[0].q2,0);
 host(r,'ZnO',-3); r('S.bulk=0;S.vbm=0;S.muRef={Zn:0,O:0};S.defects=[{name:"V",q:0,Etot:2,Ecorr:0,dn:{}},{name:"V",q:0,Etot:1,Ecorr:0,dn:{}}];');
 assert.equal(r('linesFor("V").length'),1); near(r('linesFor("V")[0].A'),1);
});
test('demo charge transition levels reproduce independent expected values',()=>{
 const r=engine(); host(r,'CuInSe2',-2.37);
 r('S.bulk=DEMO.bulk; S.vbm=DEMO.vbm; S.gap=DEMO.gap; S.muRef=DEMO.muRef; S.defects=loadDefects(DEMO.defects,S.elements).list;');
 for(const [name,expected] of [['V_Cu',[.03]],['Cu_In',[.29,.58]],['In_Cu',[.25,.34]],['V_Se',[.55]],['Cu_i',[.2]]]){
  const values=r(`envelope(linesFor(${JSON.stringify(name)}),S.gap).levels.map(l=>l.eps)`);
  assert.equal(values.length,expected.length); expected.forEach((v,i)=>near(values[i],v));
 }
});
test('CSV: quoted names, BOM, TSV and bad row lengths',()=>{
 const r=engine(); assert.equal(r('parseTable(\'\\uFEFFdefect,charge,E_tot,Zn,O\\n"V,O",0,-1,0,-1\').rows[0][0]'),'V,O');
 assert.equal(r('parseTable("phase\\tdHf\\nZnO\\t-3").rows[0][1]'),'-3');
 assert.throws(()=>r('parseTable("phase,dHf\\nZnO,-3,0")'),/expected 2/);
 assert.throws(()=>r('parseTable("phase,phase\\nZnO,-3")'),/Duplicate/);
});
test('invalid numbers, missing stoichiometry and unsupported dopants are rejected',()=>{
 const r=engine();
 for(const v of ['','2junk','Infinity','0x12']) assert.ok(Number.isNaN(r(`numOr(${JSON.stringify(v)},NaN)`)));
 near(r('numOr("-1.2e3",NaN)'),-1200);
 const load=text=>r(`loadDefects(${JSON.stringify(text)},["Zn","O"]).errs.length`);
 assert.ok(load('defect,charge,E_tot,Zn\nV,0,-1,-1'));
 assert.ok(load('defect,charge,E_tot,E_corr,Zn,O\nV,0,-1,bad,0,-1'));
 assert.ok(load('defect,charge,E_tot,Zn,O,Mg\nV,0,-1,-1,0,1'));
 assert.ok(load('defect,charge,E_tot,Zn,O\nV,0.5,-1,0,-1'));
 assert.ok(load('defect,charge,E_tot,Zn,O\nV,0,-1,0,-1\nV,1,-1,-1,0'));
});
test('phase validation and intentional empty phase list',()=>{
 const r=engine(); assert.equal(r('loadPhases("",["Zn","O"]).errs.length'),0);
 for(const text of ['phase,dHf\nZn(O,-3','phase,dHf,Zn,O\nphase,-3,-1,2','phase,dHf\nTiO2,-8'])
  assert.ok(r(`loadPhases(${JSON.stringify(text)},["Zn","O"]).errs.length`));
});
test('boundary enumeration fails safely before combinatorial work',()=>{
 const r=engine(); host(r,'CuZnSnS4',-12);
 assert.throws(()=>r('S.phases=Array.from({length:100},()=>({name:"x",comp:{Cu:1},dHf:0})); computeVertices();'),/Too many/);
});
test('publication SVG is finite, with explicit physical size and safe text',()=>{
 const r=engine(); host(r,'ZnO',-3.5); r('S.gap=3;S.defects=[{name:"V_O",Etot:1,Ecorr:0,q:0,dn:{}}];S.muRef={Zn:0,O:0}; S.fig.caps[0]="<caption>";');
 const svg=r('buildFigureSVG()'); assert.match(svg,/width="3.3in"/); assert.doesNotMatch(svg,/NaN|Infinity/); assert.match(svg,/&lt;caption&gt;/);
 r('S.fig.autoTick=false; S.fig.xTick=.0001;'); assert.throws(()=>r('buildFigureSVG()'),/Too many ticks/);
 r('S.fig.autoTick=true;S.fig.yAuto=false;S.fig.yMin=4;S.fig.yMax=2;'); assert.throws(()=>r('buildFigureSVG()'),/maximum/);
});
test('PNG gets exactly one correctly checksummed pHYs chunk at requested dpi',()=>{
 const r=engine(); const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTioAAAAASUVORK5CYII=','base64');
 for(const dpi of [300,600]){
  const bytes=Buffer.from(r(`pngWithDpi(pngWithDpi(new Uint8Array(${JSON.stringify([...png])}),96),${dpi})`));
  let chunks=0;
  for(let i=8;i<bytes.length;i+=12+bytes.readUInt32BE(i)){
   if(bytes.toString('ascii',i+4,i+8)!=='pHYs') continue;
   chunks++; assert.equal(bytes.readUInt32BE(i+8),Math.round(dpi/.0254)); assert.equal(bytes[i+16],1);
   let crc=0xffffffff; for(const b of bytes.subarray(i+4,i+17)){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
   assert.equal(bytes.readUInt32BE(i+17),(crc^0xffffffff)>>>0);
  }
  assert.equal(chunks,1);
 }
});
