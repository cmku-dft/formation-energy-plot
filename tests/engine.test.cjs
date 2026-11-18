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
test('Chemical Potential Lab conversion: total energies, units, disabled phases and references',()=>{
 const r=engine();
 r(`var session={schemaVersion:1,model:{mode:'total',target:{formula:'ZnO',energy:-20,basis:'cell',units:2},refs:{Zn:-1,O:-4},phases:[{formula:'ZnO2',energy:-5,basis:'atom'},{formula:'invalid',enabled:false}]}};`);
 near(r('fromChemicalSession(session).enthalpy'),-5);
 near(r('fromChemicalSession(session).phases[0].dHf'),-6);
 assert.equal(r('fromChemicalSession(session).phases.length'),1);
 r('session.model.refs.O=""');
 assert.throws(()=>r('fromChemicalSession(session)'),/Missing reference/);
 r('session.model.mode="formation"');
 near(r('fromChemicalSession(session).enthalpy'),-10);
 assert.ok(r('Number.isNaN(fromChemicalSession(session).refs.O)'));
 r('session.model.target.units=0');
 assert.throws(()=>r('fromChemicalSession(session)'),/formula units/);
});
test('Chemical Potential Lab normalized session roundtrip preserves stability constraints',()=>{
 const r=engine(); host(r,'Ba3V2O8',-37.345,[{name:'BaO',comp:{Ba:1,O:1},dHf:-4.97},{name:'V2O5',comp:{V:2,O:5},dHf:-15.857},{name:'VO2',comp:{V:1,O:2},dHf:-7.118}]);
 r('S.hostFormula="Ba3V2O8"; S.muRef={Ba:-1.908,V:-8.962,O:-4.9296}; var converted=fromChemicalSession(toChemicalSession());');
 near(r('converted.enthalpy'),-37.345);
 assert.equal(r('converted.phases.length'),3);
 near(r('converted.refs.O'),-4.9296);
 assert.ok(r('S.elements.every(e=>Math.abs(converted.dmu[e]-S.dmu[e])<1e-8)'));
});
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
test('Grace project keeps editable panels, XY envelopes, transitions and manual ticks',()=>{
 const r=engine(); host(r,'ZnO',-3.5);
 r('S.gap=2; S.bulk=0; S.vbm=0; S.muRef={Zn:0,O:0}; S.fig.n=2; S.fig.width=7; S.fig.autoTick=false; S.fig.xTick=.5; S.fig.yTick=1; S.fig.yAuto=false; S.fig.yMin=-4; S.fig.yMax=4; S.defects=[{name:"V_O",Etot:0,Ecorr:0,q:1,dn:{O:-1}},{name:"V_O",Etot:1,Ecorr:0,q:0,dn:{O:-1}}];');
 const agr=r('buildFigureAGR()');
 for(let p=0;p<2;p++){
  const mu=r(`condDmu(${p}).O`);
  assert.ok(agr.includes(`@target G${p}.S0\n@type xy\n0 ${mu}\n1 ${mu+1}\n2 ${mu+1}\n&`));
  assert.ok(agr.includes(`@target G${p}.S1\n@type xy\n1 ${mu+1}\n&`));
 }
 assert.match(agr,/@xaxis tick major 0.5/); assert.match(agr,/@world 0, -4, 2, 4/);
 assert.ok(agr.includes('V\\sO\\N')); assert.doesNotMatch(agr,/NaN|Infinity/);
 r('S.fig.mk=false'); assert.doesNotMatch(r('buildFigureAGR()'),/@target G0.S1/);
 if(process.env.GRACE_TEST_OUTPUT) fs.writeFileSync(process.env.GRACE_TEST_OUTPUT,agr);
});
test('dopant solubility limit follows the most stable dopant phase and moves with host Δμ',()=>{
 // Illustrative numbers: ZnO host with Mn oxides as solubility-limiting phases.
 const r=engine(); host(r,'ZnO',-3.5);
 r('S.dopants=["Mn"]; S.dopSet={}; var pr=loadPhases("phase,dHf\\nMnO,-3.9\\nMnO2,-5.5\\nMn2O3,-9.9",["Zn","O"],["Mn"]); S.dopPhases=pr.dopList; S.phases=pr.list;');
 assert.equal(r('pr.errs.length'),0); assert.equal(r('S.phases.length'),0); assert.equal(r('S.dopPhases.length'),3);
 // O-rich: Δμ_O = 0 → MnO2 limits, Δμ_Mn = ΔHf(MnO2) − 2Δμ_O
 near(r('dopantState("Mn",{Zn:-3.5,O:0}).v'),-5.5); assert.equal(r('dopantState("Mn",{Zn:-3.5,O:0}).src'),'MnO2');
 // O-poor: Δμ_O = −3.5 → MnO limits: −3.9 + 3.5
 near(r('dopantState("Mn",{Zn:0,O:-3.5}).v'),-.4); assert.equal(r('dopantState("Mn",{Zn:0,O:-3.5}).src'),'MnO');
 // Linear in Δμ_O along MnO2: forcing MnO2 at O-poor exceeds the MnO and Mn-metal limits
 r('S.dopSet={Mn:{mode:"phase",phase:"MnO2"}}');
 near(r('dopantState("Mn",{Zn:0,O:-3.5}).v'),1.5);
 assert.deepEqual([...r('dopantState("Mn",{Zn:0,O:-3.5}).viol.map(l=>l.name).sort()')],['Mn elemental limit','Mn2O3','MnO']);
 r('S.dopSet={Mn:{mode:"fixed",value:-2}}'); near(r('dopantState("Mn",{Zn:0,O:-3.5}).v'),-2); assert.equal(r('dopantState("Mn",{Zn:0,O:-3.5}).viol.length'),0);
 // No compounds given: only the elemental limit
 r('S.dopSet={}; S.dopPhases=[]'); near(r('dopantState("Mn",{Zn:0,O:-3.5}).v'),0);
});
test('ternary dopant phases include every host element they contain',()=>{
 const r=engine(); host(r,'ZnO',-3.5);
 r('S.dopants=["Mn"]; S.dopSet={}; S.dopPhases=loadPhases("phase,dHf\\nZnMn2O4,-12",["Zn","O"],["Mn"]).dopList;');
 // Δμ_Mn ≤ (−12 − Δμ_Zn − 4Δμ_O)/2
 near(r('dopantState("Mn",{Zn:-1,O:-2.5}).v'),(-12+1+10)/2);
});
test('substitutional dopant formation energy uses dopant reference and Δμ',()=>{
 const r=engine(); host(r,'ZnO',-3.5);
 r('S.bulk=-100; S.vbm=1; S.muRef={Zn:-1,O:-4,Mn:-9}; S.dopants=["Mn"]; S.dopSet={}; S.dopPhases=[{name:"MnO",comp:{Mn:1,O:1},dHf:-3.9,dop:"Mn"}]; S.dmu={Zn:-1.5,O:-2};');
 // Δμ_Mn = −3.9 + 2 = −1.9; Ef = −107 + 100 + 0.1 + 1·(1 + 0.5) + (−1 − 1.5) − (−9 − 1.9)
 near(r('ef({Etot:-107,Ecorr:.1,q:1,dn:{Zn:-1,O:0,Mn:1}},.5)'),-107+100+.1+1.5+(-2.5)-(-10.9));
 // condition-dependent: at another host Δμ the dopant limit is recomputed
 near(r('ef({Etot:-107,Ecorr:0,q:0,dn:{Zn:-1,O:0,Mn:1}},0,{Zn:-3.5,O:0})'),-7+(-4.5)-(-9-3.9));
});
test('dopant columns: declared dopants optional, undeclared rejected, multi-dopant phases rejected',()=>{
 const r=engine();
 const d=r('loadDefects("defect,charge,E_tot,Zn,O,Mn\\nMn_Zn,0,-1,-1,0,1\\nV_O,0,-2,0,-1,0",["Zn","O"],["Mn"])');
 assert.equal(d.errs.length,0); assert.equal(d.list[0].dn.Mn,1); assert.equal(d.list[1].dn.Mn,0);
 const d2=r('loadDefects("defect,charge,E_tot,Zn,O\\nV_O,0,-2,0,-1",["Zn","O"],["Mn"])');
 assert.equal(d2.errs.length,0); assert.equal(d2.list[0].dn.Mn,0);
 assert.match(r('loadDefects("defect,charge,E_tot,Zn,O,Cr\\nX,0,-1,-1,0,1",["Zn","O"],["Mn"]).errs[0]'),/Extrinsic dopants/);
 assert.match(r('loadPhases("phase,dHf\\nMnCr2O4,-15",["Zn","O"],["Mn","Cr"]).errs[0]'),/more than one dopant/);
 assert.match(r('loadPhases("phase,dHf\\nMnO,-3.9",["Zn","O"]).errs[0]'),/outside the host/);
 assert.throws(()=>r('parseDopants("Zn",["Zn","O"])'),/host element/);
 assert.throws(()=>r('parseDopants("Xx",["Zn","O"])'),/not an element/);
 assert.deepEqual([...r('parseDopants(" Mn, Cr;Co ",["Zn","O"])')],['Mn','Cr','Co']);
});
test('publication labels: line-end labels sit outside the frame, charge labels do not overlap',()=>{
 const r=engine(); host(r,'CuInSe2',-2.37);
 r('S.bulk=DEMO.bulk; S.vbm=DEMO.vbm; S.gap=DEMO.gap; S.muRef=DEMO.muRef; S.dopants=[]; S.defects=loadDefects(DEMO.defects,S.elements).list; S.fig.n=2; S.fig.width=7; S.fig.labelMode="end"; S.fig.cl=true;');
 const m=r('var M=publicationModel(); M');
 for(const P of m.panels){
  assert.ok(P.ends.length>0);
  for(const q of P.ends){ assert.ok(q.x>=P.X0+m.pw); assert.ok(q.x+r(`richWidth(${JSON.stringify(q.t)},M.endFs)`)<=P.X0+m.pw+m.labW+1e-6); }
  for(let i=0;i<P.charges.length;i++) for(let j=i+1;j<P.charges.length;j++){
   const a=P.charges[i],b=P.charges[j];
   assert.ok(Math.abs(a.x-b.x)>=m.fs*1.9 || Math.abs(a.y-b.y)>=m.fs*1.05);
  }
 }
 assert.ok(m.panels[1].X0>=m.panels[0].X0+m.pw+m.labW);
 assert.doesNotMatch(r('buildFigureAGR()'),/NaN|Infinity/);
 assert.doesNotMatch(r('buildFigureSVG()'),/NaN|Infinity/);
});
test('bundled ZnO examples load and give the documented limits and levels',()=>{
 const r=engine();
 for(const [file,dop] of [['examples/ZnO_native_defects.json',[]],['examples/ZnO_Al_doped.json',['Al']]]){
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(data.format,'defect-formation-explorer'); assert.equal(data.dopants,dop.join(''));
  host(r,data.inputs['f-host'],Number(data.inputs['f-dhf']));
  r(`var D=${JSON.stringify(data)}; S.dopants=${JSON.stringify(dop)}; S.dopSet={}; S.bulk=+D.inputs["f-bulk"]; S.vbm=+D.inputs["f-vbm"]; S.gap=+D.inputs["f-gap"];
     S.muRef=Object.fromEntries(Object.entries(D.references).map(([k,v])=>[k,+v]));
     var P=loadPhases(D.inputs["ta-ph"],S.elements,S.dopants), L=loadDefects(D.inputs["ta-def"],S.elements,S.dopants);
     S.dopPhases=P.dopList; S.defects=L.list;`);
  assert.equal(r('P.errs.length+L.errs.length'),0);
  const at=(name,vtx,EF)=>r(`(()=>{const v=S.verts.find(v=>v.act.includes(${JSON.stringify(vtx)})).dmu; const e=envelope(linesFor(${JSON.stringify(name)},v),S.gap); const s=e.segs.find(s=>s.x0<=${EF}+1e-9&&s.x1>=${EF}-1e-9); return s.A+s.q*${EF};})()`);
  near(at('V_O','Zn elemental limit',3.4),.9); near(at('V_O','O elemental limit',3.4),4.5);
  near(at('V_Zn','O elemental limit',3.4),1.4); near(at('Zn_i','Zn elemental limit',0),-1.4);
  assert.deepEqual([...r('envelope(linesFor("V_O"),S.gap).levels.map(l=>+l.eps.toFixed(6))')],[2.4]);
  assert.deepEqual([...r('envelope(linesFor("V_Zn"),S.gap).levels.map(l=>+l.eps.toFixed(6))')],[.9,1.6]);
  if(dop.length){
   near(r('dopantState("Al",S.verts.find(v=>v.act.includes("Zn elemental limit")).dmu).v'),-3.3);
   near(r('dopantState("Al",S.verts.find(v=>v.act.includes("O elemental limit")).dmu).v'),-8.7);
   near(at('Al_Zn','Zn elemental limit',3.4),.8);
   // Uncommenting the spinel makes it the limit, 0.2 eV below Al2O3 at both ends
   r('S.dopPhases=loadPhases(D.inputs["ta-ph"].replace("# ZnAl2O4","ZnAl2O4"),S.elements,S.dopants).dopList;');
   near(r('dopantState("Al",S.verts.find(v=>v.act.includes("Zn elemental limit")).dmu).v'),-3.5);
   assert.equal(r('dopantState("Al",S.verts.find(v=>v.act.includes("O elemental limit")).dmu).src'),'ZnAl2O4');
  }
 }
});
test('defect names give Δn: vacancies, interstitials, antisites, dopants, complexes and labels',()=>{
 const r=engine(), dn=(n,sp=['Zn','O','Al'])=>{const p=r(`parseDefectName(${JSON.stringify(n)},${JSON.stringify(sp)})`); return p&&JSON.parse(JSON.stringify(p));};
 assert.deepEqual(dn('V_O').dn,{O:-1}); assert.deepEqual(dn('Vac_Zn').dn,{Zn:-1}); assert.deepEqual(dn('Zn_i').dn,{Zn:1});
 assert.deepEqual(dn('Zn_O').dn,{Zn:1,O:-1}); assert.deepEqual(dn('Al_Zn').dn,{Al:1,Zn:-1}); assert.deepEqual(dn('Al_int').dn,{Al:1});
 assert.deepEqual(dn('Al_Zn+V_Zn').dn,{Al:1,Zn:-2}); assert.deepEqual(dn('V_O-V_Zn').dn,{O:-1,Zn:-1});
 assert.deepEqual(dn('V_O(split)').dn,{O:-1}); assert.deepEqual(dn('O_i[oct]').dn,{O:1}); assert.deepEqual(dn('V_O^{2+}').dn,{O:-1});
 assert.deepEqual(dn('Zn_i+V_Zn').dn,{Zn:0});
 for(const bad of ['DX','V_i','Zn_Zn','Xx_O','V_O_split','VO','']) assert.equal(dn(bad),null,bad);
 assert.deepEqual(dn('Mn_Zn').unknown,['Mn']);
 assert.equal(dn('V_O',['Bi','V','O']).ambiguous,true); assert.equal(dn('Vac_O',['Bi','V','O']).ambiguous,false);
 assert.deepEqual(dn('V_Bi',['Bi','V','O']).dn,{Bi:-1});
});
test('name mode: Δn from names without element columns, clear errors otherwise',()=>{
 const r=engine(), L=t=>JSON.parse(JSON.stringify(r(`loadDefects(${JSON.stringify(t)},["Zn","O"],["Al"])`)));
 const ok=L('defect,charge,E_tot,E_corr\nV_O,2,-95,0.3\nV_O(split),0,-90,0\nAl_Zn,1,-106,0.1\nAl_Zn+V_Zn,0,-100,0');
 assert.equal(ok.errs.length,0);
 assert.deepEqual(ok.list.map(d=>d.dn),[{Zn:0,O:-1,Al:0},{Zn:0,O:-1,Al:0},{Zn:-1,O:0,Al:1},{Zn:-2,O:0,Al:1}]);
 assert.ok(ok.list.every(d=>d.dnSource==='name'));
 assert.match(L('defect,charge,E_tot\nDX,0,-1').errs[0],/cannot read Δn/);
 assert.match(L('defect,charge,E_tot\nMn_Zn,0,-1').errs[0],/Extrinsic dopants/);
 assert.match(JSON.parse(JSON.stringify(r('loadDefects("defect,charge,E_tot\\nV_O,0,-1",["Bi","V","O"])'))).errs[0],/vanadium/);
 assert.equal(JSON.parse(JSON.stringify(r('loadDefects("defect,charge,E_tot\\nVac_O,0,-1",["Bi","V","O"])'))).errs.length,0);
});
test('column mode: columns are cross-checked against standard names',()=>{
 const r=engine(), L=t=>JSON.parse(JSON.stringify(r(`loadDefects(${JSON.stringify(t)},["Zn","O"],["Al"])`)));
 const ok=L('defect,charge,E_tot,Zn,O,Al\nV_O,0,-90,0,-1,0\nDX,0,-90,-1,0,1');
 assert.equal(ok.errs.length,0); assert.equal(ok.list[0].dnSource,'columns, match name'); assert.equal(ok.list[1].dnSource,'columns');
 assert.match(L('defect,charge,E_tot,Zn,O\nV_O,0,-90,-1,0').errs[0],/V_O means O −1, but the element columns give Zn −1/);
 assert.match(L('defect,charge,E_tot,Zn,O,Al\nAl_Zn,0,-90,0,0,1').errs[0],/Al \+1, Zn −1/);   // sign/column slip
 assert.match(L('defect,charge,E_tot,Zn,O\nAl_Zn,0,-90,-1,0').errs[0],/Al_Zn means/);          // forgotten dopant column
});
