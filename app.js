"use strict";

/* ============================================================ constants */
const SERIES = ["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8"];
const DASH   = ["", "6 3", "2 3", "9 3 2 3"];   // composite encoding past 8 defects
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ============================================================ demo data */
const DEMO = {
  host:"CuInSe2", dHf:-2.37, bulk:-1123.4567, vbm:2.1543, gap:1.04,
  muRef:{Cu:-3.72, In:-2.55, Se:-3.48},
  defects:
`defect,charge,E_tot,E_corr,Cu,In,Se
V_Cu,0,-1119.0167,0.00,-1,0,0
V_Cu,-1,-1116.9424,0.11,-1,0,0
Cu_In,0,-1121.8867,0.00,1,-1,0
Cu_In,-1,-1119.5524,0.11,1,-1,0
Cu_In,-2,-1117.1481,0.44,1,-1,0
In_Cu,2,-1126.4253,0.44,-1,1,0
In_Cu,1,-1123.6910,0.11,-1,1,0
In_Cu,0,-1121.0867,0.00,-1,1,0
V_Se,2,-1121.8853,0.44,0,0,-1
V_Se,1,-1118.6510,0.11,0,0,-1
V_Se,0,-1116.0367,0.00,0,0,-1
Cu_i,1,-1127.6410,0.11,1,0,0
Cu_i,0,-1125.1767,0.00,1,0,0`,
  phases:
`phase,dHf
Cu2Se,-0.54
CuSe,-0.41
In2Se3,-2.99
CuIn5Se8,-8.98`
};

/* ============================================================ state */
const S = {
  elements:[], hostCoeff:{}, hostDHf:0, bulk:0, vbm:0, gap:1,
  muRef:{}, defects:[], phases:[], dmu:{}, verts:[], pivot:0,
  dopants:[], dopPhases:[], dopSet:{},
  axX:null, axY:null, selVtx:0, hidden:new Set(),
  showAll:false, showLbl:true, errors:[]
};

/* ============================================================ parsing */
const ELEMENTS = new Set("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "));
function parseFormula(str){
  const s = String(str).trim();
  let i = 0;
  function count(){
    const m = s.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if(!m) return 1;
    i += m[0].length;
    const n = Number(m[0]);
    if(!Number.isFinite(n) || n <= 0) throw Error("Invalid count");
    return n;
  }
  function group(close = ""){
    const out = Object.create(null);
    while(i < s.length && s[i] !== close){
      let inner;
      if(s[i] === "(" || s[i] === "["){
        const end = s[i++] === "(" ? ")" : "]";
        inner = group(end);
        if(s[i++] !== end) throw Error("Unmatched bracket");
      } else {
        const m = s.slice(i).match(/^[A-Z][a-z]?/);
        if(!m || !ELEMENTS.has(m[0])) throw Error("Invalid element");
        i += m[0].length;
        inner = {[m[0]]:1};
      }
      const n = count();
      for(const [el,v] of Object.entries(inner)) out[el] = (out[el] || 0) + n*v;
    }
    if(!Object.keys(out).length) throw Error("Empty formula");
    return out;
  }
  try {
    if(s.length > 200) return null;
    const out = group();
    return i === s.length && Object.values(out).every(Number.isFinite) ? out : null;
  } catch { return null; }
}

function parseTable(text){
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if(!lines.length) return {head:[], rows:[], rawHead:[]};
  if(lines.length > 1001) throw Error("Please use at most 1,000 data rows per table.");
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const cut = line => {
    const out = []; let value = "", quoted = false;
    for(let i = 0; i < line.length; i++){
      const c = line[i];
      if(c === '"'){
        if(quoted && line[i+1] === '"'){ value += '"'; i++; }
        else quoted = !quoted;
      } else if(c === sep && !quoted){ out.push(value.trim()); value = ""; }
      else value += c;
    }
    if(quoted) throw Error("Unclosed CSV quote. Keep each entry on one line.");
    out.push(value.trim()); return out;
  };
  const rawHead = cut(lines[0]), head = rawHead.map(h => h.toLowerCase());
  if(new Set(head).size !== head.length) throw Error("Duplicate table column names.");
  const rows = lines.slice(1).map((line, i) => {
    const row = cut(line);
    if(row.length !== head.length) throw Error(`Table row ${i+2}: expected ${head.length} columns, found ${row.length}.`);
    return row;
  });
  return {head, rows, rawHead};
}
const numOr = (v, d) => {
  const t = String(v ?? "").trim();
  if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return d;
  const x = Number(t); return Number.isFinite(x) ? x : d;
};

/* Δn from standard defect notation. Each part is X_Y: X is the added atom
   (or V / Vac for a vacancy) and Y the site (an element, or i / int for an
   interstitial). Complexes join parts with + or -. Text in (), [] or {} and
   charge marks such as ^2+ are ignored, so V_O(split) and V_O^{2+} work.
   Returns {dn, unknown, ambiguous} or null when the name is not in this
   notation. "V_X" is ambiguous when vanadium is part of the system. */
function parseDefectName(name, species = []){
  const core = String(name).replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, "")
    .replace(/\^[0-9+\-−]*/g, "").replace(/\s+/g, "");
  if(!core) return null;
  const dn = {};
  let ambiguous = false;
  for(const part of core.split(/[+\-–]/)){
    const m = part.match(/^(Vac|[A-Z][a-z]?|v)_([A-Z][a-z]?|int|i)$/);
    if(!m) return null;
    const [, a, b] = m;
    const vac = a === "V" || a === "Vac" || a === "v";
    const inter = b === "i" || b === "int";
    if(a === "V" && species.includes("V")) ambiguous = true;
    if(vac && inter) return null;
    if(!vac && !ELEMENTS.has(a)) return null;
    if(!inter && !ELEMENTS.has(b)) return null;
    if(a === b) return null;
    if(!vac) dn[a] = (dn[a] || 0) + 1;
    if(!inter) dn[b] = (dn[b] || 0) - 1;
  }
  const unknown = Object.keys(dn).filter(el => dn[el] && !species.includes(el));
  return {dn, unknown, ambiguous};
}
function fmtDn(dn){
  const parts = Object.entries(dn).filter(([, n]) => n).map(([el, n]) => `${el} ${n > 0 ? "+" : "−"}${Math.abs(n)}`);
  return parts.length ? parts.join(", ") : "no change";
}

function loadDefects(text, elements, dopants = []){
  const {head, rows, rawHead} = parseTable(text);
  const iName = head.findIndex(h => ["defect","name","label"].includes(h));
  const iQ    = head.findIndex(h => ["charge","q"].includes(h));
  const iE    = head.findIndex(h => ["e_tot","etot","energy","e"].includes(h));
  const iC    = head.findIndex(h => ["e_corr","ecorr","correction","corr"].includes(h));
  const errs = [];
  if(iName < 0) errs.push("no 'defect' column");
  if(iQ < 0) errs.push("no 'charge' column");
  if(iE < 0) errs.push("no 'E_tot' column");
  // Column mode: element columns given; they are used and cross-checked against
  // the names. Name mode: no element columns; Δn comes from the names.
  const species = [...elements, ...dopants];
  const colMode = rawHead.some(h => ELEMENTS.has(h));
  const elCol = {};
  if(colMode){
    for(const el of elements){
      const j = rawHead.findIndex(h => h === el);
      if(j >= 0) elCol[el] = j;
      else errs.push(`missing '${el}' atom-count column (use 0 if unchanged, or remove all element columns to read Δn from the defect names)`);
    }
    // Dopant columns are optional (a missing column means no dopant atoms in that defect).
    for(const el of dopants){
      const j = rawHead.findIndex(h => h === el);
      if(j >= 0) elCol[el] = j;
    }
    for(const col of rawHead) if(ELEMENTS.has(col) && !species.includes(col))
      errs.push(`Column '${col}' is not a host element. Declare it under Extrinsic dopants to use it.`);
  }
  if(errs.length) return {list:[], errs};
  const list = [];
  rows.forEach((r, n) => {
    const nm = r[iName];
    if(!nm){ errs.push(`row ${n+2}: missing defect name`); return; }
    const q = numOr(r[iQ], NaN);
    const E = numOr(r[iE], NaN);
    if(!Number.isInteger(q) || !Number.isFinite(E)){
      errs.push(`row ${n+2}: charge must be an integer and E_tot must be a finite number`); return;
    }
    const parsed = parseDefectName(nm, species);
    if(parsed && parsed.unknown.length){
      errs.push(`row ${n+2}: ${nm} contains ${parsed.unknown.join(", ")}, which is not a host element. Add it under Extrinsic dopants.`); return;
    }
    const dn = {};
    let dnSource;
    if(colMode){
      for(const el of species) dn[el] = elCol[el] === undefined ? 0 : numOr(r[elCol[el]], NaN);
      dnSource = "columns";
      if(parsed && !parsed.ambiguous && Object.values(dn).every(Number.isInteger)){
        if(species.some(el => (parsed.dn[el] || 0) !== dn[el])){
          errs.push(`row ${n+2}: ${nm} means ${fmtDn(parsed.dn)}, but the element columns give ${fmtDn(dn)}. Fix the columns or rename the defect (text in parentheses is ignored).`); return;
        }
        dnSource = "columns, match name";
      }
    } else {
      if(!parsed){
        errs.push(`row ${n+2}: cannot read Δn from the name '${nm}'. Use notation such as V_O, Zn_i, Al_Zn or Al_Zn+V_Zn, or add element columns.`); return;
      }
      if(parsed.ambiguous){
        errs.push(`row ${n+2}: in '${nm}', V could mean a vacancy or vanadium. Write the vacancy as Vac_X, or add element columns.`); return;
      }
      for(const el of species) dn[el] = parsed.dn[el] || 0;
      dnSource = "name";
    }
    const Ecorr = iC >= 0 ? numOr(r[iC], NaN) : 0;
    if(!Number.isFinite(Ecorr) || !Object.values(dn).every(Number.isInteger)){
      errs.push(`row ${n+2}: E_corr must be numeric and atom counts must be integers`); return;
    }
    const previous = list.find(d => d.name === nm);
    if(previous && species.some(el => previous.dn[el] !== dn[el])){
      errs.push(`row ${n+2}: all charge states of ${nm} must have the same atom counts`); return;
    }
    if(list.filter(d => d.name === nm).length >= 100){ errs.push(`${nm}: limit 100 entries per defect`); return; }
    list.push({name:nm, q, Etot:E, Ecorr, dn, dnSource});
  });
  return {list, errs};
}

// Phases made only of host elements bound the host stability region (list).
// Phases containing one declared dopant (plus any host elements) bound that
// dopant's chemical potential (dopList); they do not change the host region.
function loadPhases(text, elements, dopants = []){
  if(!String(text).trim()) return {list:[], dopList:[], errs:[]};
  const {head, rows, rawHead} = parseTable(text);
  const iName = head.findIndex(h => ["phase","formula","name","compound"].includes(h));
  const iH    = head.findIndex(h => ["dhf","d_hf","hf","enthalpy","e_f","dh"].includes(h));
  const errs = [];
  if(iName < 0 || iH < 0) return {list:[], dopList:[], errs:["need 'phase' and 'dHf' columns"]};
  const species = [...elements, ...dopants];
  const elCol = {};
  for(const el of species){
    const j = rawHead.findIndex(h => h === el);
    if(j >= 0) elCol[el] = j;
  }
  for(const col of rawHead) if(ELEMENTS.has(col) && !species.includes(col))
    errs.push(`Phase column '${col}' is neither a host element nor a declared dopant.`);
  if(errs.length) return {list:[], dopList:[], errs};
  const hasCols = Object.keys(elCol).length > 0;
  const list = [], dopList = [];
  rows.forEach((r, n) => {
    const nm = r[iName];
    if(!nm){ errs.push(`row ${n+2}: missing phase name`); return; }
    let dHf = numOr(r[iH], NaN);
    if(!Number.isFinite(dHf)){ errs.push(`row ${n+2}: bad dHf`); return; }
    let comp = {};
    if(hasCols){
      for(const el of species) comp[el] = elCol[el] !== undefined ? numOr(r[elCol[el]], NaN) : 0;
    } else {
      comp = parseFormula(nm) || {};
    }
    const foreign = Object.keys(comp).filter(k => !species.includes(k));
    if(foreign.length){ errs.push(`${nm}: contains elements outside the host (${foreign.join(", ")}). Declare extrinsic dopants first.`); return; }
    if(!Object.values(comp).every(v => Number.isFinite(v) && v >= 0) || Object.values(comp).every(v => !v)){ errs.push(`${nm}: could not read composition`); return; }
    const dops = dopants.filter(el => comp[el] > 0);
    if(dops.length > 1){ errs.push(`${nm}: phases containing more than one dopant (${dops.join(", ")}) are not supported.`); return; }
    try {const col=(name,fallback)=>{const j=head.indexOf(name);return j<0?fallback:r[j];};dHf=normalizeEnergy(dHf,col('energytype','formation'),col('basis','formula'),col('units',1),comp,S.muRef);}
    catch(err){errs.push(`${nm}: ${err.message}`);return;}
    if(dops.length) dopList.push({name:nm, comp, dHf, dop:dops[0]});
    else list.push({name:nm, comp, dHf});
  });
  return {list, dopList, errs};
}

/* ============================================================ linear algebra */
function solve(A, b){
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c+1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if(Math.abs(M[p][c]) < 1e-11) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = M[r][c]/M[c][c];
      if(!f) continue;
      for(let k = c; k <= n; k++) M[r][k] -= f*M[c][k];
    }
  }
  return M.map((r, i) => r[n]/r[i]);
}
function combos(n, k){
  const out = [], cur = [];
  (function rec(start){
    if(cur.length === k){ out.push([...cur]); return; }
    for(let i = start; i < n; i++){ cur.push(i); rec(i+1); cur.pop(); }
  })(0);
  return out;
}

/* ============================================================ stability region */
function buildConstraints(){
  const els = S.elements, N = els.length;
  const c = els.map(e => S.hostCoeff[e] || 0);
  let p = 0;
  for(let i = 1; i < N; i++) if(Math.abs(c[i]) > Math.abs(c[p])) p = i;
  S.pivot = p;
  const free = els.map((_, i) => i).filter(i => i !== p);
  const g0 = S.hostDHf / c[p];
  const g  = free.map(i => -c[i]/c[p]);

  const A = [], b = [], names = [];
  const add = (full, rhs, nm) => {
    const row = free.map((i, j) => full[i] + full[p]*g[j]);
    A.push(row); b.push(rhs - full[p]*g0); names.push(nm);
  };
  els.forEach((e, i) => { const r = new Array(N).fill(0); r[i] = 1; add(r, 0, e+" elemental limit"); });
  for(const ph of S.phases) add(els.map(e => ph.comp[e] || 0), ph.dHf, ph.name);
  return {A, b, names, free, p, g0, g, d:N-1};
}

function computeVertices(){
  const K = buildConstraints();
  const {A, b, names, free, p, g0, g, d} = K;
  S.K = K;
  if(d <= 0){ S.verts = [{dmu:{[S.elements[0]]: g0}, act:["host"]}]; return; }
  let combinations = 1;
  for(let i = 1; i <= d; i++) combinations *= (A.length-i+1)/i;
  if(combinations > 20000) throw Error("Too many phase combinations. Reduce the phase table (limit: 20,000 boundary combinations).");
  const raw = [];
  for(const idx of combos(A.length, d)){
    const x = solve(idx.map(i => A[i]), idx.map(i => b[i]));
    if(!x || x.some(v => !Number.isFinite(v))) continue;
    let ok = true;
    for(let k = 0; k < A.length; k++){
      let s = 0; for(let j = 0; j < d; j++) s += A[k][j]*x[j];
      if(s > b[k] + 1e-7){ ok = false; break; }
    }
    if(!ok) continue;
    const dmu = {};
    free.forEach((i, j) => dmu[S.elements[i]] = x[j]);
    dmu[S.elements[p]] = g0 + g.reduce((s, gj, j) => s + gj*x[j], 0);
    const act = [];
    for(let k = 0; k < A.length; k++){
      let s = 0; for(let j = 0; j < d; j++) s += A[k][j]*x[j];
      if(Math.abs(s - b[k]) < 1e-6) act.push(names[k]);
    }
    raw.push({dmu, act:act.sort()});
  }
  const uniq = [];
  for(const v of raw){
    if(!uniq.some(u => S.elements.every(e => Math.abs(u.dmu[e] - v.dmu[e]) < 1e-6))) uniq.push(v);
  }
  S.verts = uniq;
  orderVertices();
}

function orderVertices(){
  if(S.verts.length < 3 || !S.axX || !S.axY) return;
  const pts = S.verts.map(v => [v.dmu[S.axX], v.dmu[S.axY]]);
  const cx = pts.reduce((s, q) => s+q[0], 0)/pts.length;
  const cy = pts.reduce((s, q) => s+q[1], 0)/pts.length;
  S.verts.sort((a, b) =>
    Math.atan2(a.dmu[S.axY]-cy, a.dmu[S.axX]-cx) -
    Math.atan2(b.dmu[S.axY]-cy, b.dmu[S.axX]-cx));
}

function hull2(points){
  const P = points.map(p => [...p]).sort((a, b) => a[0]-b[0] || a[1]-b[1]);
  if(P.length < 3) return P;
  const cr = (o,a,b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lo = [];
  for(const q of P){ while(lo.length >= 2 && cr(lo[lo.length-2], lo[lo.length-1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for(let i = P.length-1; i >= 0; i--){ const q = P[i];
    while(up.length >= 2 && cr(up[up.length-2], up[up.length-1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

function feasibility(dmu){
  const out = [];
  for(const e of S.elements){
    if(dmu[e] > 1e-6) out.push({name:e+" elemental limit", by:dmu[e]});
  }
  for(const ph of S.phases){
    const s = S.elements.reduce((a, e) => a + (ph.comp[e]||0)*dmu[e], 0);
    if(s > ph.dHf + 1e-6) out.push({name:ph.name, by:s - ph.dHf});
  }
  const hostSum = S.elements.reduce((a, e) => a + (S.hostCoeff[e]||0)*dmu[e], 0);
  return {viol:out, hostResid: hostSum - S.hostDHf};
}

/* ============================================================ energetics */
/* Extrinsic dopants (dilute limit). The host region fixes Δμ of the host
   elements; each dopant phase D_a H1_b1 H2_b2 ... must not precipitate:
     a·Δμ_D + Σ b_i Δμ_i ≤ ΔHf(phase)  →  Δμ_D ≤ (ΔHf − Σ b_i Δμ_i)/a
   together with the elemental limit Δμ_D ≤ 0. The solubility limit is the
   lowest of these bounds, so with MnO2 the bound on Δμ_Mn moves with Δμ_O. */
function dopantLimits(el, hostDmu){
  const out = [{name:`${el} elemental limit`, v:0}];
  for(const ph of S.dopPhases || []){
    if(ph.dop !== el) continue;
    let s = ph.dHf;
    for(const e of S.elements) s -= (ph.comp[e] || 0)*hostDmu[e];
    out.push({name:ph.name, v:s/ph.comp[el]});
  }
  return out.sort((a, b) => a.v - b.v);
}
function dopantState(el, hostDmu){
  const lim = dopantLimits(el, hostDmu), set = (S.dopSet || {})[el] || {mode:"auto"};
  let v = lim[0].v, src = lim[0].name, mode = "auto";
  if(set.mode === "phase"){
    const hit = lim.find(l => l.name === set.phase);
    if(hit){ v = hit.v; src = hit.name; mode = "phase"; }
  } else if(set.mode === "fixed" && Number.isFinite(set.value)){
    v = set.value; src = "fixed value"; mode = "fixed";
  }
  return {v, src, mode, lim, viol:lim.filter(l => v > l.v + 1e-6)};
}
function fullDmu(hostDmu){
  const out = {...hostDmu};
  for(const el of S.dopants || []) out[el] = dopantState(el, hostDmu).v;
  return out;
}
function ef(d, EF, dmu){
  const M = fullDmu(dmu || S.dmu);
  let e = d.Etot - S.bulk + d.Ecorr + d.q*(S.vbm + EF);
  for(const [el, n] of Object.entries(d.dn)) if(n) e -= n*(S.muRef[el] + (M[el] || 0));
  return e;
}
function defectNames(){
  const seen = [];
  for(const d of S.defects) if(!seen.includes(d.name)) seen.push(d.name);
  return seen;
}
function linesFor(name, dmu){
  const best = new Map();                      // one line per charge: keep the lowest
  for(const d of S.defects){
    if(d.name !== name) continue;
    const A = ef(d, 0, dmu);
    if(!best.has(d.q) || A < best.get(d.q).A) best.set(d.q, {q:d.q, A});
  }
  return [...best.values()].sort((a, b) => b.q - a.q);
}
function envelope(ls, gap){
  if(!ls.length) return {segs:[], levels:[]};
  const bp = new Set([0, gap]);
  for(let i = 0; i < ls.length; i++) for(let j = i+1; j < ls.length; j++){
    if(ls[i].q === ls[j].q) continue;
    const x = (ls[j].A - ls[i].A)/(ls[i].q - ls[j].q);
    if(x > 1e-9 && x < gap - 1e-9) bp.add(x);
  }
  const xs = [...bp].sort((a, b) => a-b);
  const segs = [];
  for(let i = 0; i < xs.length-1; i++){
    const mid = (xs[i] + xs[i+1])/2;
    let bestL = ls[0], bestV = Infinity;
    for(const l of ls){ const v = l.A + l.q*mid; if(v < bestV - 1e-12){ bestV = v; bestL = l; } }
    const last = segs[segs.length-1];
    if(last && last.q === bestL.q) last.x1 = xs[i+1];
    else segs.push({q:bestL.q, A:bestL.A, x0:xs[i], x1:xs[i+1]});
  }
  const levels = [];
  for(let i = 0; i < segs.length-1; i++){
    const x = segs[i].x1;
    levels.push({q1:segs[i].q, q2:segs[i+1].q, eps:x, ef:segs[i].A + segs[i].q*x});
  }
  return {segs, levels};
}

/* Find a free spot for a charge label on one envelope segment. Tries the
   middle first, then other points along the segment, above then below the
   line; returns null when every candidate collides with a placed label. */
function labelSpot(seg, SX, SY, placed, o){
  for(const f of [0.5, 0.32, 0.68, 0.2, 0.8]){
    const x = seg.x0 + f*(seg.x1 - seg.x0), px = SX(x), py = SY(seg.A + seg.q*x);
    for(const ty of [py - o.above, py + o.below]){
      if(ty < o.top || ty > o.bottom) continue;
      if(placed.some(q => Math.abs(q[0]-px) < o.w && Math.abs(q[1]-ty) < o.h)) continue;
      if((o.avoid || []).some(r => px + o.w/2 > r.x0 && px - o.w/2 < r.x1 && ty + o.h/2 > r.y0 && ty - o.h/2 < r.y1)) continue;
      placed.push([px, ty]);
      return [px, ty];
    }
  }
  return null;
}

/* ============================================================ number helpers */
const fx = (v, n=3) => (Number.isFinite(v) ? v.toFixed(n) : "—");
const sgn = q => (q > 0 ? "+" : q < 0 ? "−" : "") + Math.abs(q);
function niceTicks(lo, hi, want=6){
  const span = hi - lo;
  if(!(span > 0)) return [lo];
  const raw = span/want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw/mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10)*mag;
  const out = [];
  for(let t = Math.ceil(lo/step)*step; t <= hi + step*1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}

/* ============================================================ chart: stability region */
function renderRegion(){
  if(!S.valid) return;
  const svg = document.getElementById("svg-region");
  const box = document.getElementById("cb-region");
  const W = Math.max(280, box.clientWidth || 420);
  const H = Math.max(260, Math.min(400, W*0.8));
  const m = {t:16, r:18, b:48, l:60};
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const ink = css("--ink"), ink2 = css("--ink-2"), ink3 = css("--ink-3");
  const grid = css("--grid"), line2 = css("--line-2"), acc = css("--accent");
  const surf = css("--surface");

  const pts = S.verts.map(v => [v.dmu[S.axX], v.dmu[S.axY]]);
  const cur = [S.dmu[S.axX], S.dmu[S.axY]];
  const allX = pts.map(p => p[0]).concat([cur[0], 0]);
  const allY = pts.map(p => p[1]).concat([cur[1], 0]);
  let x0 = Math.min(...allX), x1 = Math.max(...allX);
  let y0 = Math.min(...allY), y1 = Math.max(...allY);
  const padX = Math.max(0.08, (x1-x0)*0.14), padY = Math.max(0.08, (y1-y0)*0.14);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const SX = v => m.l + (v - x0)/(x1 - x0)*iw;
  const SY = v => m.t + ih - (v - y0)/(y1 - y0)*ih;

  let g = "";
  const xt = niceTicks(x0, x1, 5), yt = niceTicks(y0, y1, 5);
  for(const t of xt) g += `<line x1="${SX(t)}" y1="${m.t}" x2="${SX(t)}" y2="${m.t+ih}" stroke="${grid}" stroke-width="1"/>`;
  for(const t of yt) g += `<line x1="${m.l}" y1="${SY(t)}" x2="${m.l+iw}" y2="${SY(t)}" stroke="${grid}" stroke-width="1"/>`;
  for(const t of xt) g += `<text x="${SX(t)}" y="${m.t+ih+18}" fill="${ink3}" font-size="12.5" font-family="${css('--mono')||'monospace'}" text-anchor="middle">${t}</text>`;
  for(const t of yt) g += `<text x="${m.l-8}" y="${SY(t)+4.5}" fill="${ink3}" font-size="12.5" font-family="monospace" text-anchor="end">${t}</text>`;
  g += `<line x1="${m.l}" y1="${m.t+ih}" x2="${m.l+iw}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<text x="${m.l+iw/2}" y="${H-7}" fill="${ink2}" font-size="13.5" text-anchor="middle">Δμ(${S.axX}) — eV</text>`;
  g += `<text transform="translate(15,${m.t+ih/2}) rotate(-90)" fill="${ink2}" font-size="13.5" text-anchor="middle">Δμ(${S.axY}) — eV</text>`;

  if(pts.length >= 3){
    const h = hull2(pts);
    const dstr = h.map(p => `${SX(p[0])},${SY(p[1])}`).join(" ");
    g += `<polygon points="${dstr}" fill="${acc}" fill-opacity="0.13" stroke="${acc}" stroke-width="2" stroke-linejoin="round"/>`;
  } else if(pts.length === 2){
    g += `<line x1="${SX(pts[0][0])}" y1="${SY(pts[0][1])}" x2="${SX(pts[1][0])}" y2="${SY(pts[1][1])}" stroke="${acc}" stroke-width="3" stroke-linecap="round"/>`;
  }

  pts.forEach((p, i) => {
    const sel = i === S.selVtx;
    g += `<circle class="vdot" data-i="${i}" cx="${SX(p[0])}" cy="${SY(p[1])}" r="${sel?7:5.5}"
           fill="${sel?acc:surf}" stroke="${acc}" stroke-width="2" style="cursor:pointer"/>`;
    g += `<text x="${SX(p[0])+9}" y="${SY(p[1])-7}" fill="${ink}" font-size="13" font-weight="600" font-family="monospace">${String.fromCharCode(65+i)}</text>`;
  });

  // current condition crosshair (when it is not exactly a vertex)
  const onV = pts.some(p => Math.abs(p[0]-cur[0]) < 1e-9 && Math.abs(p[1]-cur[1]) < 1e-9);
  if(!onV){
    g += `<line x1="${SX(cur[0])-7}" y1="${SY(cur[1])}" x2="${SX(cur[0])+7}" y2="${SY(cur[1])}" stroke="${ink}" stroke-width="1.5"/>`;
    g += `<line x1="${SX(cur[0])}" y1="${SY(cur[1])-7}" x2="${SX(cur[0])}" y2="${SY(cur[1])+7}" stroke="${ink}" stroke-width="1.5"/>`;
  }
  svg.innerHTML = g;

  const tip = document.getElementById("tip-region");
  svg.querySelectorAll(".vdot").forEach(el => {
    el.addEventListener("click", () => { pickVertex(+el.dataset.i); });
    el.addEventListener("mouseenter", () => {
      const i = +el.dataset.i, v = S.verts[i];
      tip.innerHTML = `<div class="th">Vertex ${String.fromCharCode(65+i)} — ${v.act.join(" + ")}</div>` +
        S.elements.map(e => `<div class="tr"><span class="nm">Δμ(${e})</span><span>${fx(v.dmu[e])}</span></div>`).join("");
      tip.style.left = SX(pts[i][0]) + "px";
      tip.style.top = (SY(pts[i][1]) - 10) + "px";
      tip.classList.add("on");
    });
    el.addEventListener("mouseleave", () => tip.classList.remove("on"));
  });
}

/* ============================================================ chart: main diagram */
let MAINGEO = null;
function renderMain(){
  if(!S.valid) return;
  if(S.defectReady === false){ $("svg-main").innerHTML = ""; return; }
  if(!S.verts.length){ $("svg-main").innerHTML = ""; return; }
  const svg = document.getElementById("svg-main");
  const box = document.getElementById("cb-main");
  const W = Math.max(300, box.clientWidth || 860);
  const narrow = W < 560;
  const H = Math.max(320, Math.min(560, W*(narrow ? 0.85 : 0.56)));
  const labelRoom = S.showLbl && !narrow ? 104 : 18;
  const m = {t:22, r:labelRoom, b:54, l:64};
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const ink = css("--ink"), ink2 = css("--ink-2"), ink3 = css("--ink-3");
  const grid = css("--grid"), line2 = css("--line-2"), surf = css("--surface");
  const gap = S.gap;

  const names = defectNames().filter(n => !S.hidden.has(n));
  const data = names.map((n, i) => {
    const ls = linesFor(n);
    const {segs, levels} = envelope(ls, gap);
    return {name:n, ls, segs, levels,
            color: css(SERIES[i % 8]), dash: DASH[Math.floor(i/8) % 4]};
  });

  // y range from the envelopes (plus all-charge lines when shown)
  let lo = Infinity, hi = -Infinity;
  for(const d of data){
    for(const s of d.segs){
      lo = Math.min(lo, s.A + s.q*s.x0, s.A + s.q*s.x1);
      hi = Math.max(hi, s.A + s.q*s.x0, s.A + s.q*s.x1);
    }
    if(S.showAll) for(const l of d.ls){
      lo = Math.min(lo, l.A, l.A + l.q*gap);
      hi = Math.max(hi, l.A, l.A + l.q*gap);
    }
  }
  if(!Number.isFinite(lo)){ lo = 0; hi = 1; }
  const pad = Math.max(0.15, (hi-lo)*0.10);
  hi = hi + pad;
  lo = (lo >= 0 && lo < 1.0) ? 0 : lo - pad;   // anchor at zero only when it is close

  const SX = v => m.l + v/gap*iw;
  const SY = v => m.t + ih - (v - lo)/(hi - lo)*ih;
  MAINGEO = {SX, SY, m, iw, ih, lo, hi, data, gap, W, H};

  let g = "";
  const yt = niceTicks(lo, hi, narrow ? 5 : 7);
  const xt = niceTicks(0, gap, narrow ? 4 : 6).filter(t => t >= -1e-9 && t <= gap + 1e-9);
  for(const t of yt) g += `<line x1="${m.l}" y1="${SY(t)}" x2="${m.l+iw}" y2="${SY(t)}" stroke="${grid}" stroke-width="1"/>`;
  for(const t of xt) g += `<line x1="${SX(t)}" y1="${m.t}" x2="${SX(t)}" y2="${m.t+ih}" stroke="${grid}" stroke-width="1"/>`;
  if(lo < 0 && hi > 0) g += `<line x1="${m.l}" y1="${SY(0)}" x2="${m.l+iw}" y2="${SY(0)}" stroke="${line2}" stroke-width="1.5" stroke-dasharray="4 3"/>`;

  // band edges
  g += `<line x1="${SX(0)}" y1="${m.t}" x2="${SX(0)}" y2="${m.t+ih}" stroke="${ink3}" stroke-width="1.5"/>`;
  g += `<line x1="${SX(gap)}" y1="${m.t}" x2="${SX(gap)}" y2="${m.t+ih}" stroke="${ink3}" stroke-width="1.5"/>`;
  g += `<text x="${SX(0)+5}" y="${m.t+14}" fill="${ink3}" font-size="12.5" font-family="monospace" letter-spacing="0.5">VBM</text>`;
  g += `<text x="${SX(gap)-5}" y="${m.t+14}" fill="${ink3}" font-size="12.5" font-family="monospace" letter-spacing="0.5" text-anchor="end">CBM</text>`;

  for(const t of yt) g += `<text x="${m.l-9}" y="${SY(t)+4.5}" fill="${ink3}" font-size="13" font-family="monospace" text-anchor="end">${t}</text>`;
  for(const t of xt) g += `<text x="${SX(t)}" y="${m.t+ih+19}" fill="${ink3}" font-size="13" font-family="monospace" text-anchor="middle">${t}</text>`;
  g += `<line x1="${m.l}" y1="${m.t+ih}" x2="${m.l+iw}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<text x="${m.l+iw/2}" y="${H-9}" fill="${ink2}" font-size="14" text-anchor="middle">Fermi level above VBM — eV</text>`;
  g += `<text transform="translate(16,${m.t+ih/2}) rotate(-90)" fill="${ink2}" font-size="14" text-anchor="middle">Formation energy — eV</text>`;

  // faint all-charge-state lines behind the envelopes
  if(S.showAll){
    for(const d of data) for(const l of d.ls){
      g += `<line x1="${SX(0)}" y1="${SY(l.A)}" x2="${SX(gap)}" y2="${SY(l.A + l.q*gap)}"
             stroke="${d.color}" stroke-width="1" stroke-opacity="0.34" stroke-dasharray="3 3"/>`;
    }
  }

  // envelopes
  const placed = [];                       // charge-label positions already drawn
  for(const d of data){
    const pts = [];
    d.segs.forEach((s, i) => {
      if(i === 0) pts.push([SX(s.x0), SY(s.A + s.q*s.x0)]);
      pts.push([SX(s.x1), SY(s.A + s.q*s.x1)]);
    });
    if(pts.length){
      g += `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none"
             stroke="${d.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"
             ${d.dash ? `stroke-dasharray="${d.dash}"` : ""}/>`;
    }
    // transition-level markers: 2px surface ring
    for(const lv of d.levels){
      g += `<circle cx="${SX(lv.eps)}" cy="${SY(lv.ef)}" r="3.6" fill="${d.color}" stroke="${surf}" stroke-width="2"/>`;
    }
    // charge annotation on wide segments
    if(S.showLbl) for(const s of d.segs){
      const w = SX(s.x1) - SX(s.x0);
      if(w < 42) continue;
      const spot = labelSpot(s, SX, SY, placed, {w:26, h:15, above:8, below:18, top:m.t+12, bottom:m.t+ih-2});
      if(!spot) continue;
      g += `<text x="${spot[0]}" y="${spot[1]}" fill="${d.color}" font-size="12.5" font-weight="600"
             font-family="monospace" text-anchor="middle"
             paint-order="stroke" stroke="${surf}" stroke-width="3"
             stroke-linejoin="round">${sgn(s.q)}</text>`;
    }
  }

  // right-edge direct labels (relief for the contrast WARN on some hues)
  if(S.showLbl && !narrow){
    const lab = data.filter(d => d.segs.length).map(d => {
      const s = d.segs[d.segs.length-1];
      return {name:d.name, color:d.color, y:SY(s.A + s.q*s.x1)};
    }).sort((a, b) => a.y - b.y);
    const MIN = 16;
    for(let i = 1; i < lab.length; i++)
      if(lab[i].y - lab[i-1].y < MIN) lab[i].y = lab[i-1].y + MIN;
    if(lab.length){
      const over = lab[lab.length-1].y - (m.t + ih);
      if(over > 0) for(const L of lab) L.y -= over;
      if(lab[0].y < m.t + 6) { const up = m.t + 6 - lab[0].y; for(const L of lab) L.y += up; }
    }
    for(const L of lab){
      g += `<line x1="${m.l+iw+2}" y1="${L.y}" x2="${m.l+iw+8}" y2="${L.y}" stroke="${L.color}" stroke-width="2"/>`;
      g += `<text x="${m.l+iw+11}" y="${L.y+3.5}" fill="${ink}" font-size="13" font-family="monospace">${esc(L.name)}</text>`;
    }
  }

  g += `<rect id="hitzone" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/>`;
  g += `<line id="cross" x1="0" y1="${m.t}" x2="0" y2="${m.t+ih}" stroke="${ink3}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  svg.innerHTML = g;
  wireMainHover();
}

function wireMainHover(){
  const svg = document.getElementById("svg-main");
  const box = document.getElementById("cb-main");
  const tip = document.getElementById("tip-main");
  const cross = svg.querySelector("#cross");
  const zone = svg.querySelector("#hitzone");
  if(!zone || !MAINGEO) return;
  const {SX, SY, m, iw, ih, gap, data, W} = MAINGEO;

  function move(ev){
    const r = box.getBoundingClientRect();
    const scale = (W || r.width)/r.width;
    const px = (ev.clientX - r.left)*scale;
    let EF = (px - m.l)/iw*gap;
    EF = Math.max(0, Math.min(gap, EF));
    cross.setAttribute("x1", SX(EF)); cross.setAttribute("x2", SX(EF));
    cross.setAttribute("opacity", "1");
    const rows = data.map(d => {
      let best = null;
      for(const l of d.ls){ const v = l.A + l.q*EF; if(!best || v < best.v) best = {v, q:l.q}; }
      return best ? {name:d.name, color:d.color, ...best} : null;
    }).filter(Boolean).sort((a, b) => a.v - b.v);
    tip.innerHTML = `<div class="th">E<sub>F</sub> = ${fx(EF)} eV above VBM</div>` +
      rows.map(r => `<div class="tr"><span class="nm"><span class="dot" style="background:${r.color}"></span>${esc(r.name)}<sup style="color:var(--ink-3)">${sgn(r.q)}</sup></span><span>${fx(r.v)}</span></div>`).join("");
    const cx = SX(EF)/scale, cy = (m.t + 8)/scale;
    tip.style.left = Math.max(80, Math.min(r.width - 80, cx)) + "px";
    tip.style.top = Math.max(0, cy) + "px";
    tip.style.transform = "translate(-50%, 0)";
    tip.classList.add("on");
  }
  zone.addEventListener("mousemove", move);
  zone.addEventListener("mouseleave", () => { tip.classList.remove("on"); cross.setAttribute("opacity","0"); });
  zone.addEventListener("touchmove", e => { if(e.touches[0]) move(e.touches[0]); }, {passive:true});
}

/* ============================================================ DOM helpers */
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = id => document.getElementById(id);

/* ============================================================ panels */
function renderChips(){
  const n = defectNames().length;
  const cond = S.verts[S.selVtx];
  $("chips").innerHTML = [
    `<span class="chip">host <b>${esc(S.hostFormula)}</b></span>`,
    S.defectReady === false ? '<span class="chip">stability only</span>' : `<span class="chip">gap <b>${fx(S.gap,2)} eV</b></span>`,
    `<span class="chip">${n} defect${n===1?"":"s"} · <b>${S.defects.length}</b> entries</span>`,
    `<span class="chip">Δμ <b>${[...S.elements, ...S.dopants].map(e => `${e} ${fx(fullDmu(S.dmu)[e],2)}`).join(" · ")}</b></span>`
  ].join("");
  $("cond-tag").textContent = (cond
    ? `vertex ${String.fromCharCode(65+S.selVtx)} — ${cond.act.join(" + ")}`
    : "custom Δμ") + S.dopants.map(el => `; Δμ(${el}) from ${dopantState(el, S.dmu).src}`).join("");
  $("tag-host").textContent = S.elements.join(" ");
  $("tag-def").textContent = `${S.defects.length} rows`;
  $("tag-ph").textContent = `${S.phases.length} phases` + (S.dopPhases.length ? ` + ${S.dopPhases.length} dopant` : "");
  $("region-dim").textContent = S.elements.length <= 2
    ? "1-D line segment"
    : S.elements.length === 3 ? "2-D polygon"
    : `${S.elements.length-1}-D polytope — shown projected`;
}

function renderVertexList(){
  const box = $("vtx-list");
  if(!S.verts.length){ box.innerHTML = `<div class="note bad">No stable region — the host is unstable against the phases given.</div>`; return; }
  box.innerHTML = S.verts.map((v, i) => `
    <button class="vtx-btn ${i===S.selVtx?"sel":""}" data-i="${i}">
      <span class="id">${String.fromCharCode(65+i)}</span>
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(v.act.join(" + "))}</span>
    </button>`).join("");
  box.querySelectorAll(".vtx-btn").forEach(b =>
    b.addEventListener("click", () => pickVertex(+b.dataset.i)));
}

function renderDmuInputs(){
  const p = S.elements[S.pivot];
  $("dmu-inputs").innerHTML = S.elements.map(e => `
    <div class="flexline" style="gap:8px">
      <span class="lbl" style="width:64px">Δμ(${e})</span>
      <input type="number" step="0.01" id="dmu-${e}" value="${S.dmu[e].toFixed(4)}"
        ${e===p?"disabled":""} style="flex:1" aria-label="Delta mu ${e}">
      ${e===p?`<span class="muted" style="font-size:13px">solved</span>`:""}
    </div>`).join("");
  for(const e of S.elements){
    if(e === p) continue;
    $("dmu-"+e).addEventListener("change", () => {
      const v = parseFloat($("dmu-"+e).value);
      if(!Number.isFinite(v) || v === S.dmu[e]) return;
      S.dmu[e] = v;
      // re-solve the pivot from the host equality
      let s = 0;
      for(const k of S.elements) if(k !== p) s += (S.hostCoeff[k]||0)*S.dmu[k];
      S.dmu[p] = (S.hostDHf - s)/(S.hostCoeff[p]||1);
      S.selVtx = S.verts.findIndex(vv => S.elements.every(k => Math.abs(vv.dmu[k]-S.dmu[k]) < 1e-6));
      draw();
    });
  }
}

function renderFeas(){
  const {viol, hostResid} = feasibility(S.dmu);
  let h = "";
  if(Math.abs(hostResid) > 1e-6)
    h += `<div class="note bad">Off the host line by ${fx(hostResid)} eV — Δμ does not satisfy the ${esc(S.hostFormula)} equality.</div>`;
  else if(viol.length)
    h += `<div class="note warn"><b>Outside the stability region.</b><br>` +
         viol.map(v => `${esc(v.name)} would precipitate — exceeded by ${fx(v.by)} eV`).join("<br>") + `</div>`;
  else
    h += `<div class="note">Inside the stability region; ${esc(S.hostFormula)} is the equilibrium phase here.</div>`;
  $("feas").innerHTML = h;
}

function renderDopants(){
  const box = $("dop-panel");
  if(!S.dopants.length){ box.innerHTML = ""; return; }
  const anionHost = S.elements.some(e => ["O","S","Se","Te","N","F","Cl","Br","I","P","As","Sb"].includes(e));
  box.innerHTML = S.dopants.map(el => {
    const st = dopantState(el, S.dmu), set = S.dopSet[el] || {mode:"auto"};
    const phases = S.dopPhases.filter(p => p.dop === el);
    const opts = `<option value="auto" ${st.mode==="auto"?"selected":""}>Solubility limit (auto)</option>` +
      phases.map(p => `<option value="phase:${esc(p.name)}" ${st.mode==="phase"&&set.phase===p.name?"selected":""}>In equilibrium with ${esc(p.name)}</option>`).join("") +
      `<option value="fixed" ${st.mode==="fixed"?"selected":""}>Fixed Δμ(${esc(el)})</option>`;
    let notes = "";
    if(!phases.length)
      notes += `<div class="note ${anionHost?"warn":""}">Only metallic ${esc(el)} bounds Δμ(${esc(el)}).${anionHost ? ` For a host like ${esc(S.hostFormula)}, ${esc(el)} compounds with the host anion (for example oxides) usually set a much lower limit. Add them to the competing-phase table.` : ""}</div>`;
    if(st.viol.length)
      notes += `<div class="note warn"><b>Above the solubility limit.</b><br>` +
        st.viol.map(l => `${esc(l.name)} would precipitate (exceeded by ${fx(st.v - l.v)} eV)`).join("<br>") + `</div>`;
    const rows = S.verts.map((v, i) => {
      const s = dopantState(el, v.dmu);
      return `<tr${i===S.selVtx?' style="font-weight:600"':""}><td>${String.fromCharCode(65+i)}</td><td class="num">${fx(s.v)}</td><td>${esc(s.src)}</td></tr>`;
    }).join("");
    return `<div class="stack" style="gap:6px">
      <div class="flexline" style="gap:8px"><span class="lbl" style="width:64px">Δμ(${esc(el)})</span>
        <span class="mono" style="flex:1">${fx(st.v,4)}</span><span class="muted" style="font-size:13px">${esc(st.src)}</span></div>
      <select id="dop-mode-${el}" aria-label="How Δμ(${esc(el)}) is set">${opts}</select>
      ${st.mode==="fixed" ? `<input type="number" step="0.01" id="dop-val-${el}" value="${st.v.toFixed(4)}" aria-label="Fixed Δμ ${esc(el)}">` : ""}
      ${notes}
      ${S.verts.length ? `<div class="tbl-wrap"><table><thead><tr><th>Vertex</th><th class="num">Δμ(${esc(el)})</th><th>set by</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    </div>`;
  }).join("");
  for(const el of S.dopants){
    $("dop-mode-"+el).addEventListener("change", e => {
      const v = e.target.value;
      if(v === "auto") S.dopSet[el] = {mode:"auto"};
      else if(v === "fixed") S.dopSet[el] = {mode:"fixed", value:dopantState(el, S.dmu).v};
      else S.dopSet[el] = {mode:"phase", phase:v.slice(6)};
      draw();
    });
    $("dop-val-"+el)?.addEventListener("change", e => {
      const v = numOr(e.target.value, NaN);
      // Re-rendering removes this input; its blur then fires a second change with the same value.
      if(Number.isFinite(v) && v !== S.dopSet[el]?.value){ S.dopSet[el] = {mode:"fixed", value:v}; draw(); }
    });
  }
}

function renderDnSummary(){
  const seen = new Map();
  for(const d of S.defects) if(!seen.has(d.name)) seen.set(d.name, d);
  const label = {"name":"from name", "columns, match name":"columns ✓ name", "columns":"columns (name not in standard notation)"};
  $("dn-summary").innerHTML = seen.size
    ? `<div class="lbl" style="margin-bottom:4px">Δn used</div>` +
      [...seen.values()].map(d => `<div class="mono" style="font-size:13.5px">${esc(d.name)}: ${esc(fmtDn(d.dn))} <span class="muted">· ${esc(label[d.dnSource] || d.dnSource)}</span></div>`).join("")
    : "";
  $("dn-summary").hidden = !seen.size;
}

function renderLegend(){
  const names = defectNames();
  $("legend").innerHTML = names.map((n, i) => {
    const off = S.hidden.has(n);
    return `<button class="lg ${off?"off":""}" data-n="${esc(n)}" aria-pressed="${!off}">
      <span class="dot" style="background:${css(SERIES[i%8])}"></span>${esc(n)}</button>`;
  }).join("") || `<span class="muted">No defect entries loaded.</span>`;
  $("legend").querySelectorAll(".lg").forEach(b => b.addEventListener("click", () => {
    const n = b.dataset.n;
    S.hidden.has(n) ? S.hidden.delete(n) : S.hidden.add(n);
    draw();
  }));
}

function renderTables(){
  if(!S.valid || !S.verts.length){ for(const id of ["tbl-lv","tbl-edge"]) $(id).querySelector("tbody").innerHTML = ""; return; }
  const names = defectNames();
  const lv = $("tbl-lv").querySelector("tbody");
  const ed = $("tbl-edge").querySelector("tbody");
  let a = "", b = "";
  names.forEach((n, i) => {
    const col = css(SERIES[i%8]);
    const ls = linesFor(n);
    const {segs, levels} = envelope(ls, S.gap);
    const dim = S.hidden.has(n) ? ' style="opacity:.42"' : "";
    for(const L of levels){
      const kind = Math.abs(L.q1 - L.q2) > 1 ? "charge-state skip*" : "single-electron";
      a += `<tr${dim}><td><span class="swatch" style="background:${col}"></span>${esc(n)}</td>
        <td>ε(${sgn(L.q1)}/${sgn(L.q2)})</td>
        <td class="num">${fx(L.eps)}</td><td class="num">${fx(S.gap - L.eps)}</td>
        <td class="num">${fx(L.ef)}</td><td class="muted">${kind}</td></tr>`;
    }
    if(!levels.length && segs.length)
      a += `<tr${dim}><td><span class="swatch" style="background:${col}"></span>${esc(n)}</td>
        <td class="muted">none in gap</td><td class="num">—</td><td class="num">—</td>
        <td class="num">—</td><td class="muted">q = ${sgn(segs[0].q)} throughout</td></tr>`;

    if(segs.length){
      const f0 = segs[0], fL = segs[segs.length-1];
      const eV = f0.A + f0.q*0, eC = fL.A + fL.q*S.gap;
      let mn = Infinity;
      for(const s of segs) mn = Math.min(mn, s.A + s.q*s.x0, s.A + s.q*s.x1);
      b += `<tr${dim}><td><span class="swatch" style="background:${col}"></span>${esc(n)}</td>
        <td class="num">${fx(eV)}</td><td>${sgn(f0.q)}</td>
        <td class="num">${fx(eC)}</td><td>${sgn(fL.q)}</td>
        <td class="num">${fx(mn)}</td>
        <td class="num muted">${ls.map(l => sgn(l.q)).join(" ")}</td></tr>`;
    }
  });
  lv.innerHTML = a || `<tr><td colspan="6" class="muted">No entries.</td></tr>`;
  ed.innerHTML = b || `<tr><td colspan="7" class="muted">No entries.</td></tr>`;
}

function renderMsgs(){
  const m = [];
  if(!S.verts.length) m.push(`<div class="note bad">No stable host condition exists for these inputs. Formation-energy plots and exports are unavailable.</div>`);
  if(S.errors.length) m.push(`<div class="note warn">${S.errors.map(esc).join("<br>")}</div>`);
  if(defectNames().length > 8)
    m.push(`<div class="note">More than eight defects: hues repeat with a changed line style, so read the right-edge labels rather than color alone.</div>`);
  $("main-msg").innerHTML = m.join("");
}

/* ============================================================ orchestration */
function pickVertex(i){
  if(!S.verts[i]) return;
  S.selVtx = i;
  for(const e of S.elements) S.dmu[e] = S.verts[i].dmu[e];
  draw();
}
function draw(){
  if(!S.valid) return;
  renderChips(); renderVertexList(); renderDmuInputs(); renderFeas(); renderDopants(); renderDnSummary();
  renderRegion(); renderMsgs();
  if(S.defectReady === false){
    for(const id of ["legend","svg-main","fig-prev","cond-rows","fig-series"]) $(id).innerHTML = "";
    for(const id of ["tbl-lv","tbl-edge"]) $(id).querySelector("tbody").innerHTML = "";
    $("main-msg").innerHTML += '<div class="note">Stability region is available. Add valid defect entries, bulk energy, VBM, band gap and elemental references to enable defect plots.</div>';
    return;
  }
  renderLegend(); renderMain(); renderTables();
  renderCondRows(); renderSeriesRows(); renderFigure();
}

function readSystem(){
  // Show the raw-energy help and the per-cell count only when they apply.
  $("note-raw").hidden = $("host-type").value !== "total";
  $("units-field").hidden = $("host-basis").value !== "cell";
  S.hostFormula = $("f-host").value.trim();
  const hc = parseFormula(S.hostFormula);
  if(!hc) throw Error("Enter a valid host formula, such as ZnO, In2O3 or CuInSe2.");
  if(Object.keys(hc).length < 2 || Object.keys(hc).length > 4) throw Error("Use a host containing 2–4 elements.");
  const els = Object.keys(hc);
  const dops = parseDopants($("f-dop").value, els);
  const changed = els.join() !== S.elements.join();
  const refsChanged = changed || dops.join() !== S.dopants.join();
  S.hostDHf = requiredNumber("f-dhf", "Host energy");
  S.hostCoeff = hc; S.elements = els; S.dopants = dops;
  for(const d of Object.keys(S.dopSet)) if(!dops.includes(d)) delete S.dopSet[d];
  if(refsChanged){
    // A new element starts with a blank reference (never a silent zero); stale
    // references from a previous host are dropped.
    S.muRef = Object.fromEntries([...els, ...dops].map(e => [e, Number.isFinite(S.muRef[e]) ? S.muRef[e] : NaN]));
    buildMuRefGrid();
  }
  if(changed){
    S.dmu = {};
    S.axX = els[0]; S.axY = els[1] || els[0];
    buildAxisSelects();
  }
  for(const e of [...els, ...dops]){
    const inp = $("mu-"+e);
    if(inp) S.muRef[e] = numOr(inp.value, NaN);
  }
  S.hostDHf=normalizeEnergy(S.hostDHf,$('host-type').value,$('host-basis').value,$('host-units').value,hc,S.muRef);
  $('host-normalized').textContent=`Calculated host ΔHf: ${S.hostDHf.toFixed(6)} eV/formula. Cell formula count applies only to eV/cell.`;
}
function normalizeEnergy(value,type,basis,units,comp,refs){
  if(basis==='cell'){const n=numOr(units,NaN);if(!(n>0))throw Error('Enter positive formula units per cell.');value/=n;}
  else if(basis==='atom')value*=Object.values(comp).reduce((a,b)=>a+b,0);
  else if(basis!=='formula')throw Error('Invalid energy basis.');
  if(type==='total')for(const [e,n] of Object.entries(comp)){if(!n)continue;if(!Number.isFinite(refs[e]))throw Error(`Enter reference energy for ${e}.`);value-=n*refs[e];}
  else if(type!=='formation')throw Error('Invalid energy type.');
  if(!Number.isFinite(value))throw Error('Invalid normalized energy.');return value;
}
function parseDopants(text, hostEls){
  const list = String(text || "").split(/[\s,;]+/).filter(Boolean);
  for(const el of list){
    if(!ELEMENTS.has(el)) throw Error(`Dopant '${el}' is not an element symbol.`);
    if(hostEls.includes(el)) throw Error(`${el} is a host element, not an extrinsic dopant.`);
  }
  if(new Set(list).size !== list.length) throw Error("Each dopant should be listed once.");
  if(list.length > 4) throw Error("Use at most four extrinsic dopants.");
  return list;
}
function buildMuRefGrid(){
  const all = [...S.elements, ...S.dopants];
  $("muref-grid").innerHTML = all.map(e => `
    <div class="field"><label for="mu-${e}">${e}${S.dopants.includes(e) ? ' <span class="muted">(dopant)</span>' : ''}</label>
      <input type="number" step="0.0001" id="mu-${e}" placeholder="required for defects" value="${Number.isFinite(S.muRef[e]) ? S.muRef[e] : ''}"></div>`).join("");
  all.forEach(e => $("mu-"+e).addEventListener("change", recompute));
}
function buildAxisSelects(){
  for(const [id, key] of [["ax-x","axX"], ["ax-y","axY"]]){
    const sel = $(id);
    sel.innerHTML = S.elements.map(e => `<option value="${e}" ${S[key]===e?"selected":""}>${e}</option>`).join("");
  }
}

function requiredNumber(id, name){
  const n = numOr($(id).value, NaN);
  if(!Number.isFinite(n)) throw Error(`${name}: enter a finite number.`);
  return n;
}
const EXPORT_IDS = ["b-svg", "b-tsv", "b-png", "b-png6", "b-svgdl", "b-agr", "b-figcopy"];
function invalidate(message){
  S.valid = false;
  $("input-status").innerHTML = `<div class="note bad"><b>Inputs need attention.</b> ${esc(message)} Results are cleared until the inputs are corrected.</div>`;
  $("dn-summary").hidden = true;
  for(const id of ["chips","vtx-list","dmu-inputs","feas","dop-panel","dn-summary","legend","svg-region","svg-main","fig-prev","cond-rows","fig-series","main-msg"]) $(id).innerHTML = "";
  for(const id of ["tbl-lv","tbl-edge"]) $(id).querySelector("tbody").innerHTML = "";
  $("region-dim").textContent = "Calculation paused";
  $("cond-tag").textContent = "";
  EXPORT_IDS.forEach(id => $(id).disabled = true);
}
function recompute(){
 for(const id of ['tip-region','tip-main']){const tip=$(id);tip.classList.remove('on');tip.innerHTML='';}
 try {
  readSystem();
  const pres = loadPhases($("ta-ph").value, S.elements, S.dopants);
  S.phases = pres.list; S.dopPhases = pres.dopList;
  if(pres.errs.length) throw Error(pres.errs.join("; "));
  for(const [el, set] of Object.entries(S.dopSet))
    if(set.mode === "phase" && !S.dopPhases.some(p => p.dop === el && p.name === set.phase)) S.dopSet[el] = {mode:"auto"};
  S.defects = []; S.errors = []; S.defectReady = false;
  try {
    const dres = $("ta-def").value.trim() ? loadDefects($("ta-def").value, S.elements, S.dopants) : {list:[],errs:[]};
    if(dres.errs.length) throw Error(dres.errs.join("; "));
    if(dres.list.length){
      S.bulk = requiredNumber("f-bulk", "Bulk supercell energy");
      S.vbm = requiredNumber("f-vbm", "VBM energy");
      S.gap = requiredNumber("f-gap", "Band gap");
      if(S.gap <= 0) throw Error("The band gap must be greater than zero.");
      for(const e of S.elements) S.muRef[e] = requiredNumber("mu-"+e, `Reference for ${e}`);
      // Dopant references are needed only for dopants that appear in a defect.
      for(const e of S.dopants) if(dres.list.some(d => d.dn[e]))
        S.muRef[e] = requiredNumber("mu-"+e, `Reference for dopant ${e}`);
      S.defects = dres.list; S.defectReady = true;
    }
  } catch(err){ S.errors = [err.message]; }
  computeVertices();
  S.valid = true;
  $("input-status").innerHTML = S.defectReady ? "" : '<div class="note">Stability-only mode: defect inputs are optional and do not block the chemical-potential diagram.</div>';
  EXPORT_IDS.forEach(id => $(id).disabled = !S.verts.length || !S.defectReady);
  if(!S.verts.length){
    for(const e of S.elements) S.dmu[e] = S.hostDHf / (S.elements.length*S.hostCoeff[e]);
  } else {
    if(S.selVtx >= S.verts.length) S.selVtx = 0;
    const keep = S.elements.every(e => Number.isFinite(S.dmu[e]));
    const stillV = keep && S.verts.findIndex(v => S.elements.every(e => Math.abs(v.dmu[e]-S.dmu[e]) < 1e-6));
    if(!keep || Math.abs(feasibility(S.dmu).hostResid) > 1e-6 || feasibility(S.dmu).viol.length){
      S.selVtx = Math.max(0, Math.min(S.selVtx, S.verts.length-1));
      for(const e of S.elements) S.dmu[e] = S.verts[S.selVtx].dmu[e];
    } else S.selVtx = stillV;
  }
  draw();
 } catch(err){ invalidate(err.message); }
}

function loadDemo(){
  $('host-type').value='formation';$('host-basis').value='formula';$('host-units').value=1;
  $("f-host").value = DEMO.host; $("f-dhf").value = DEMO.dHf; $("f-dop").value = ""; S.dopSet = {};
  $("f-bulk").value = DEMO.bulk; $("f-vbm").value = DEMO.vbm; $("f-gap").value = DEMO.gap;
  S.muRef = {...DEMO.muRef}; S.elements = [];
  $("ta-def").value = DEMO.defects; $("ta-ph").value = DEMO.phases;
  S.hidden.clear(); S.selVtx = 0; S.dmu = {}; S.fig.condsTouched = false; S.fig.caps = ["","",""];
  $("src-tag").textContent = "illustrative example";
  $("data-notice").textContent = "The CuInSe₂ example is illustrative, not a validated material dataset. Replace it with your own consistent DFT energies. Calculations and file processing stay in your browser.";
  recompute();
}

// Chemical Potential Lab schema v1: normalize energies without changing their references.
function fromChemicalSession(data){
  const m = data.model;
  if(![1,2].includes(data.schemaVersion) || !m || !['formation','total'].includes(m.mode)) throw Error('Choose a Chemical Potential Lab session (schema version 1 or 2).');
  const formula = s => String(s || '').replace(/[₀₁₂₃₄₅₆₇₈₉]/g,c=>String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c)));
  const host = formula(m.target?.formula), comp = parseFormula(host);
  if(!comp || ![2,3].includes(Object.keys(comp).length)) throw Error('Chemical Potential Lab sessions require a binary or ternary host.');
  const elements = Object.keys(comp), refs = Object.fromEntries(elements.map(e=>[e,numOr(m.refs?.[e],NaN)]));
  const energy = row => {
    const f = formula(row?.formula), c = parseFormula(f);
    if(!c || Object.keys(c).some(e=>!elements.includes(e))) throw Error('Invalid phase formula or foreign element.');
    let h = numOr(row.energy,NaN);
    if(!Number.isFinite(h)) throw Error(`Invalid energy for ${f}.`);
    if(row.basis === 'atom') h *= Object.values(c).reduce((a,b)=>a+b,0);
    else if(row.basis === 'cell'){
      const n = numOr(row.units,NaN);
      if(!(n>0)) throw Error(`Invalid formula units per cell for ${f}.`);
      h /= n;
    } else if(row.basis && row.basis !== 'formula') throw Error('Unknown energy basis.');
    const type=row.energyType || m.mode;
    if(!['formation','total'].includes(type)) throw Error('Unknown energy type.');
    if(type === 'total') for(const [e,n] of Object.entries(c)){
      if(!Number.isFinite(refs[e])) throw Error(`Missing reference energy for ${e}.`);
      h -= n*refs[e];
    }
    if(!Number.isFinite(h)) throw Error('Energy conversion overflow.');
    return {name:f,comp:c,dHf:h};
  };
  if(!Array.isArray(m.phases) || m.phases.length>150) throw Error('Enter at most 150 phases.');
  const target = energy(m.target), phases = m.phases.filter(p=>p.enabled!==false).map(energy);
  const z=m.eliminated || elements.at(-1), axes=m.axes || [...elements.filter(e=>e!==z),z];
  if(axes.length!==elements.length || new Set(axes).size!==elements.length || axes.some(e=>!elements.includes(e))) throw Error('Invalid session axes.');
  let dmu=null;
  if(Array.isArray(data.selected) && data.selected.length===2 && data.selected.every(Number.isFinite)){
    // Both Lab's binary line and ternary view store [X,Y].
    dmu={[axes[0]]:data.selected[0],[axes[1]]:data.selected[1]};
    if(elements.length===3) dmu[axes[2]]=(target.dHf-comp[axes[0]]*data.selected[0]-comp[axes[1]]*data.selected[1])/comp[axes[2]];
  }
  const explanation=`JSON default energy mode: ${m.mode}; host energy type: ${m.target.energyType || m.mode}. Host input: ${m.target.energy} eV/${m.target.basis||'formula'}${m.target.basis==='cell'?`, ${m.target.units} formula units/cell`:''}. Host formation enthalpy used: ${target.dHf} eV/formula. `+'Each entry uses its own energy type, or the session default when omitted. References are subtracted only for total energies. Check the host and phase types if the result is unexpected.';
  return {host,enthalpy:target.dHf,phases,refs,axes,dmu,explanation,own:data.ownEnergies===true};
}
function toChemicalSession(){
  if(!S.valid || ![2,3].includes(S.elements.length)) throw Error('Calculate a binary or ternary stability region first.');
  const formula=c=>Object.entries(c).filter(([,n])=>n>0).map(([e,n])=>e+(n===1?'':n)).join('');
  const axes=[S.axX,...S.elements.filter(e=>e!==S.axX)];
  if(S.elements.length===3 && S.axY!==S.axX){ axes.splice(1,axes.length-1,S.axY,...S.elements.filter(e=>e!==S.axX && e!==S.axY)); }
  return {schemaVersion:1,ownEnergies:S.chemicalOwn===true,view:'2d',selected:S.verts.length?[S.dmu[axes[0]],S.dmu[axes[1]]]:null,
    model:{mode:'formation',axes,eliminated:axes.at(-1),refs:Object.fromEntries(S.elements.map(e=>[e,Number.isFinite(S.muRef[e])?S.muRef[e]:''])),
      target:{formula:S.hostFormula,energy:S.hostDHf,basis:'formula',units:1},
      phases:S.phases.map(p=>({formula:formula(p.comp),energy:p.dHf,basis:'formula',units:1,enabled:true}))}};
}

/* ============================================================ wiring */
["f-host","f-dop","f-dhf","f-bulk","f-vbm","f-gap"].forEach(id =>
  $(id).addEventListener("change", recompute));
$("b-def").addEventListener("click", () => { $("src-tag").textContent = "your data"; recompute(); });
$("b-ph").addEventListener("click",  () => { $("src-tag").textContent = "your data"; recompute(); });
$("b-demo").addEventListener("click", loadDemo);
$("b-calculate").addEventListener("click", recompute);
$("t-all").addEventListener("change", e => { S.showAll = e.target.checked; renderMain(); });
$("t-lbl").addEventListener("change", e => { S.showLbl = e.target.checked; renderMain(); });
$("ax-x").addEventListener("change", e => {
  if(e.target.value === S.axY) S.axY = S.axX;
  S.axX = e.target.value; orderVertices();
  S.selVtx = S.verts.findIndex(v => S.elements.every(el => Math.abs(v.dmu[el]-S.dmu[el]) < 1e-6));
  S.fig.condsTouched = false; buildAxisSelects(); draw();
});
$("ax-y").addEventListener("change", e => {
  if(e.target.value === S.axX) S.axX = S.axY;
  S.axY = e.target.value; orderVertices();
  S.selVtx = S.verts.findIndex(v => S.elements.every(el => Math.abs(v.dmu[el]-S.dmu[el]) < 1e-6));
  S.fig.condsTouched = false; buildAxisSelects(); draw();
});

function wireUpload(inputId, taId){
  $(inputId).addEventListener("change", ev => {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const rd = new FileReader();
    rd.onload = () => { $(taId).value = rd.result; $("src-tag").textContent = f.name;
      $("data-notice").textContent = "User-supplied data. Results depend on your energy references and included phases. Save inputs to keep a local copy; figure styling is not included.";
      recompute(); };
    rd.onerror = () => invalidate("Could not read the uploaded file.");
    if(f.size > 2000000){ invalidate("Use CSV files smaller than 2 MB."); return; }
    rd.readAsText(f);
  });
}
wireUpload("u-def", "ta-def");
wireUpload("u-ph", "ta-ph");

// Show a short status on a button, then return to its real label. The label is
// remembered once, so back-to-back messages ("Rendering…" then "Downloaded")
// can never leave a temporary message behind as the button's text.
function flash(btn, txt, ms = 1400){
  if(!btn.dataset.label) btn.dataset.label = btn.textContent;
  clearTimeout(btn._flashTimer);
  btn.textContent = txt;
  btn._flashTimer = ms > 0 ? setTimeout(() => { btn.textContent = btn.dataset.label; }, ms) : null;
}
$("b-svg").addEventListener("click", async e => {
  const clone = $("svg-main").cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelector("#cross")?.remove();
  clone.querySelector("#hitzone")?.remove();
  const svg = new XMLSerializer().serializeToString(clone);
  try { await navigator.clipboard.writeText(svg); flash(e.target, "Copied"); }
  catch { flash(e.target, "Copy blocked"); }
});
$("b-tsv").addEventListener("click", async e => {
  const rows = [["defect","q1","q2","eps_above_VBM_eV","eps_below_CBM_eV","Ef_at_eps_eV"]];
  for(const n of defectNames()){
    for(const L of envelope(linesFor(n), S.gap).levels)
      rows.push([n, L.q1, L.q2, L.eps.toFixed(4), (S.gap-L.eps).toFixed(4), L.ef.toFixed(4)]);
  }
  const M = fullDmu(S.dmu);
  const head = `# ${S.hostFormula}  Delta-mu: ` +
    [...S.elements, ...S.dopants].map(el => `${el}=${M[el].toFixed(4)}`).join(" ");
  try { await navigator.clipboard.writeText(head + "\n" + rows.map(r => r.join("\t")).join("\n"));
        flash(e.target, "Copied"); }
  catch { flash(e.target, "Copy blocked"); }
});

/* ============================================================ publication figure */
const FIGCOL = ["#2a78d6","#eb6834","#1baf7a","#eda100","#e87ba4","#008300","#4a3aa7","#e34948"];
const GRAYDASH = ["", "5 2.2", "1.6 1.8", "7 2 1.6 2", "3.2 1.8", "9 2.4 1.6 2.4 1.6 2.4"];

S.fig = {
  n:1, conds:[0,1,2], caps:["","",""],
  width:3.3, height:2.7, font:"sans", fs:8, lw:1.4,
  xTick:0.2, yTick:1, minor:2, autoTick:true,
  yAuto:true, yMin:0, yMax:4,
  tickPad:2, xPad:2, yPad:2, pGap:8, axisLW:0.9,
  frame:true, gray:false, mk:true, cl:true, letters:true, white:true,
  labelMode:"end",
  xTitle:"E_F − E_{VBM} (eV)", yTitle:"Formation energy (eV)",
  style:Object.create(null)
};

function styleOf(nm){
  const F = S.fig;
  if(!F.style[nm]){
    const i = defectNames().indexOf(nm);
    F.style[nm] = {vis:true, color:FIGCOL[(i < 0 ? 0 : i) % 8], label:nm};
  }
  return F.style[nm];
}
function condDmu(i){
  if(i === -1 || !S.verts[i]) return {...S.dmu};
  return {...S.verts[i].dmu};
}
function autoCaption(i){
  if(i === -1 || !S.verts[i]) return feasibility(S.dmu).viol.length ? "Custom Δμ (outside stability)" : "Custom Δμ";
  return S.verts[i].act.join(" + ");
}
function autoStep(lo, hi, want){          // 1 / 2 / 5 decades only — no 2.5 steps
  const span = Math.abs(hi - lo) || 1;
  const raw = span/want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw/mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10)*mag;
}
function decimalsFor(step){               // enough places to write the step exactly
  for(let d = 0; d <= 4; d++) if(Math.abs(step - +step.toFixed(d)) < 1e-9) return d;
  return 4;
}
const HALO = w => ` paint-order="stroke" stroke="#ffffff" stroke-width="${w.toFixed(2)}" stroke-linejoin="round"`;

/* rich text: V_Cu, E_{VBM}, ^{2+} */
function richParts(str){
  const out = [];
  let i = 0, buf = "";
  const push = (t, k) => { if(t !== "") out.push({t, k}); };
  while(i < str.length){
    const c = str[i];
    if(c === "_" || c === "^"){
      push(buf, "n"); buf = "";
      const k = c === "_" ? "sub" : "sup";
      i++;
      let tok = "";
      if(str[i] === "{"){ i++; while(i < str.length && str[i] !== "}") tok += str[i++]; i++; }
      else { while(i < str.length && /[A-Za-z0-9+\-−.]/.test(str[i])) tok += str[i++]; }
      push(tok, k);
    } else { buf += c; i++; }
  }
  push(buf, "n");
  return out;
}
function richSVG(str, fs){
  const parts = richParts(String(str));
  let s = "", cur = 0;
  for(const p of parts){
    const want = p.k === "sub" ? fs*0.30 : p.k === "sup" ? -fs*0.36 : 0;
    const sz = p.k === "n" ? fs : fs*0.72;
    s += `<tspan dy="${(want-cur).toFixed(2)}" font-size="${sz.toFixed(2)}">${esc(p.t)}</tspan>`;
    cur = want;
  }
  return s;
}
const richWidth = (str, fs) => richParts(String(str))
  .reduce((w, p) => w + p.t.length*fs*(p.k === "n" ? 0.55 : 0.40), 0);

function publicationModel(){
  if(S.defectReady === false) throw Error("Add valid defect inputs before exporting a defect figure.");
  if(!S.valid || !S.verts.length) throw Error("No stable host conditions are available. Check the input energies and phases.");
  const F = S.fig, n = F.n, fs = F.fs, lw = F.lw;
  const W = F.width*72, H = F.height*72;
  const fam = F.font === "serif"
    ? "'Times New Roman', Times, serif"
    : "Helvetica, Arial, sans-serif";
  const names = defectNames().filter(nm => styleOf(nm).vis);

  const panels = [];
  for(let p = 0; p < n; p++){
    const dmu = condDmu(F.conds[p]);
    const series = names.map((nm, i) => {
      const st = styleOf(nm);
      const {segs, levels} = envelope(linesFor(nm, dmu), S.gap);
      return {label: st.label || nm,
              color: F.gray ? "#000000" : st.color,
              dash: F.gray ? GRAYDASH[i % GRAYDASH.length] : "",
              segs, levels};
    });
    panels.push({series, cap: F.caps[p] || autoCaption(F.conds[p])});
  }

  let lo = Infinity, hi = -Infinity;
  for(const P of panels) for(const s of P.series) for(const g of s.segs){
    lo = Math.min(lo, g.A + g.q*g.x0, g.A + g.q*g.x1);
    hi = Math.max(hi, g.A + g.q*g.x0, g.A + g.q*g.x1);
  }
  if(!Number.isFinite(lo)){ lo = 0; hi = 1; }

  const xStep = F.autoTick ? autoStep(0, S.gap, 6) : Math.max(1e-4, F.xTick);
  let yStep   = F.autoTick ? autoStep(lo, hi, 6)  : Math.max(1e-4, F.yTick);
  if(F.yAuto){
    const pad = Math.max((hi-lo)*0.06, yStep*0.25);
    lo = Math.floor((lo - pad)/yStep)*yStep;
    hi = Math.ceil((hi + pad)/yStep)*yStep;
    if(lo > -yStep*0.5 && lo < yStep*0.5) lo = 0;
  } else { lo = F.yMin; hi = F.yMax; }
  if(!(hi > lo)) throw Error("The y maximum must be greater than the y minimum.");

  const xd = decimalsFor(xStep), yd = decimalsFor(yStep);
  const ticksFrom = (a, b, st) => {
    if(!Number.isFinite(st) || st <= 0 || (b-a)/st > 1000)
      throw Error("Too many ticks. Increase the tick interval or reduce minor subdivisions.");
    const out = [], first = Math.ceil(a/st - 1e-9);
    for(let i = 0; i <= 1001; i++){
      const t = (first+i)*st;
      if(t > b + st*1e-9) break;
      out.push(+t.toFixed(10));
    }
    return out;
  };
  const xMaj = ticksFrom(0, S.gap, xStep), yMaj = ticksFrom(lo, hi, yStep);
  const xMin = F.minor > 1 ? ticksFrom(0, S.gap, xStep/F.minor) : [];
  const yMinT = F.minor > 1 ? ticksFrom(lo, hi, yStep/F.minor) : [];

  // margins built from explicit pads, so every gap is adjustable
  const legendH = F.labelMode === "legend" ? fs*1.9 : 0;
  const tp = Math.max(0, F.tickPad), xp = Math.max(0, F.xPad);
  const yp = Math.max(0, F.yPad),    gp = Math.max(0, F.pGap);
  const yLabW = yMaj.reduce((w, t) => Math.max(w, t.toFixed(yd).length), 1)*fs*0.56;
  // A title's height depends on what it contains: a superscript reaches above the
  // cap line, a subscript drops below the baseline. Measure the actual title rather
  // than guessing, so nothing is clipped and a plain title does not waste margin.
  const capOf  = s => fs*(/\^/.test(s) ? 1.10 : 0.98);   // 0.98 clears parentheses
  const dropOf = s => fs*(/_/.test(s)  ? 0.56 : 0.32);
  const xCap = capOf(F.xTitle), xDrop = dropOf(F.xTitle);
  const yCap = capOf(F.yTitle), yDrop = dropOf(F.yTitle);
  const digitH = fs*0.90;
  const mL = tp + yLabW + yp + yCap + yDrop;
  const mR = fs*0.9;
  const mT = fs*0.9 + legendH;
  const mB = tp + digitH + xp + xCap + xDrop;
  // Line-end labels sit outside each frame, in a reserved strip, so they never
  // cover the curves or get clipped at the panel edge.
  const endFs = fs*0.92, endPad = fs*0.35;
  const labW = F.labelMode === "end"
    ? Math.max(0, ...panels.flatMap(P => P.series.filter(s => s.segs.length).map(s => richWidth(s.label, endFs)))) + endPad + fs*0.2
    : 0;
  const pw = (W - mL - mR - (n-1)*gp - n*labW)/n;
  const ph = H - mT - mB;
  const stride = pw + labW + gp;
  const tkMaj = fs*0.55, tkMin = fs*0.30;
  const aw = Math.max(0.4, F.axisLW);       // frame and ticks, independent of the data lines
  S.__geo = {mL, mR, mT, mB, pw, ph, gp, n, W, H, xMaj, yMaj, xMin, yMinT};
  if(!(pw > fs*2) || !(ph > fs*2))
    throw new Error("no room left for the plot — reduce the label gaps, shorten series labels or increase the figure size");

  // Shared label layout (figure points), used by both the SVG and Grace exports.
  panels.forEach((P, p) => {
    const X0 = mL + p*stride, Y0 = mT;
    const SX = v => X0 + v/S.gap*pw;
    const SY = v => Y0 + ph - (v - lo)/(hi - lo)*ph;
    P.X0 = X0;
    P.charges = [];
    const head = [F.letters && n > 1 ? `(${String.fromCharCode(97+p)})` : "", P.cap].filter(Boolean).join(" ");
    const avoid = head ? [{x0:X0, x1:X0 + fs*0.55 + richWidth(head, fs*0.95) + fs*0.3, y0:Y0, y1:Y0 + fs*1.75}] : [];
    if(F.cl){
      const placed = [];
      for(const s of P.series) for(const sg of s.segs){
        if(SX(sg.x1) - SX(sg.x0) < fs*2.2) continue;
        const spot = labelSpot(sg, SX, SY, placed,
          {w:fs*1.9, h:fs*1.05, above:lw + fs*0.45, below:lw + fs*1.15, top:Y0 + fs*0.8, bottom:Y0 + ph - fs*0.2, avoid});
        if(spot) P.charges.push({x:spot[0], y:spot[1], t:sgn(sg.q), c:s.color});
      }
    }
    P.ends = [];
    if(F.labelMode === "end"){
      const L = P.series.filter(s => s.segs.length).map(s => {
        const sg = s.segs[s.segs.length-1];
        return {t:s.label, c:s.color, y:SY(sg.A + sg.q*sg.x1)};
      }).sort((a, b) => a.y - b.y);
      const MIN = fs*1.15, top = Y0 + fs*0.35, bottom = Y0 + ph - fs*0.1;
      for(const q of L) q.y = Math.max(top, Math.min(bottom, q.y));
      for(let i = 1; i < L.length; i++) if(L[i].y - L[i-1].y < MIN) L[i].y = L[i-1].y + MIN;
      if(L.length){
        const over = L[L.length-1].y - bottom;
        if(over > 0) for(const q of L) q.y -= over;
        for(let i = L.length-2; i >= 0; i--) if(L[i+1].y - L[i].y < MIN) L[i].y = L[i+1].y - MIN;
      }
      for(const q of L) P.ends.push({...q, x:X0 + pw + endPad, base:q.y + endFs*0.33});
    }
  });

  return {F,H,W,aw,digitH,endFs,fam,fs,gp,hi,labW,legendH,lo,lw,mL,mR,mT,n,panels,ph,pw,stride,tkMaj,tkMin,tp,xCap,xMaj,xMin,xd,xp,yCap,yMaj,yMinT,yd,xStep,yStep};
}

function buildFigureSVG(){
  const {F,H,W,aw,digitH,endFs,fam,fs,gp,hi,labW,legendH,lo,lw,mL,mR,mT,n,panels,ph,pw,stride,tkMaj,tkMin,tp,xCap,xMaj,xMin,xd,xp,yCap,yMaj,yMinT,yd,xStep,yStep} = publicationModel();
  const AX = "#000000";
  let g = "";
  if(F.white) g += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  for(let p = 0; p < n; p++){
    const X0 = mL + p*stride, Y0 = mT;
    const SX = v => X0 + v/S.gap*pw;
    const SY = v => Y0 + ph - (v - lo)/(hi - lo)*ph;
    const P = panels[p];
    const cid = `publication-clip-${p}`;
    g += `<clipPath id="${cid}"><rect x="${X0}" y="${Y0}" width="${pw}" height="${ph}"/></clipPath>`;

    g += `<g clip-path="url(#${cid})">`;
    for(const s of P.series){
      const pts = [];
      s.segs.forEach((sg, i) => {
        if(i === 0) pts.push([SX(sg.x0), SY(sg.A + sg.q*sg.x0)]);
        pts.push([SX(sg.x1), SY(sg.A + sg.q*sg.x1)]);
      });
      if(pts.length > 1)
        g += `<polyline points="${pts.map(q => q.map(v => v.toFixed(2)).join(",")).join(" ")}"
               fill="none" stroke="${s.color}" stroke-width="${lw}" stroke-linejoin="round"
               stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
      if(F.mk) for(const L of s.levels)
        g += `<circle cx="${SX(L.eps).toFixed(2)}" cy="${SY(L.ef).toFixed(2)}"
               r="${Math.max(1.1, lw*1.25).toFixed(2)}" fill="${s.color}"/>`;
    }
    for(const c of P.charges)
      g += `<text x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}"
             font-family="${fam}" font-size="${(fs*0.82).toFixed(2)}" fill="${c.c}"
             text-anchor="middle"${HALO(fs*0.26)}>${esc(c.t)}</text>`;
    g += `</g>`;

    // Frame and ticks are axis-aligned hairlines. They are collected into their
    // own crispEdges group so the renderer snaps them to whole pixels — without
    // that, each panel sits at a different sub-pixel offset and a thin tick can
    // antialias to nothing in one panel while showing in the next.
    let axg = "", txt = "";
    const alw = aw.toFixed(2);
    if(F.frame)
      axg += `<rect x="${X0.toFixed(2)}" y="${Y0.toFixed(2)}" width="${pw.toFixed(2)}" height="${ph.toFixed(2)}" fill="none" stroke="${AX}" stroke-width="${alw}"/>`;
    else {
      axg += `<line x1="${X0.toFixed(2)}" y1="${(Y0+ph).toFixed(2)}" x2="${(X0+pw).toFixed(2)}" y2="${(Y0+ph).toFixed(2)}" stroke="${AX}" stroke-width="${alw}"/>`;
      axg += `<line x1="${X0.toFixed(2)}" y1="${Y0.toFixed(2)}" x2="${X0.toFixed(2)}" y2="${(Y0+ph).toFixed(2)}" stroke="${AX}" stroke-width="${alw}"/>`;
    }
    const tick = (x1,y1,x2,y2) => `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${AX}" stroke-width="${alw}"/>`;
    for(const t of xMin){ axg += tick(SX(t), Y0+ph, SX(t), Y0+ph-tkMin); if(F.frame) axg += tick(SX(t), Y0, SX(t), Y0+tkMin); }
    for(const t of yMinT){ if(t < lo-1e-9 || t > hi+1e-9) continue;
      axg += tick(X0, SY(t), X0+tkMin, SY(t)); if(F.frame) axg += tick(X0+pw, SY(t), X0+pw-tkMin, SY(t)); }
    // Every tick keeps its label. Where panels sit close together the outermost
    // labels would run into each other across the gap, so instead of dropping one
    // they are anchored to the frame edge — the number stays, it just tucks inward.
    const tight = n > 1 && gp + labW < fs*1.9;
    xMaj.forEach((t, k) => {
      axg += tick(SX(t), Y0+ph, SX(t), Y0+ph-tkMaj); if(F.frame) axg += tick(SX(t), Y0, SX(t), Y0+tkMaj);
      let anchor = "middle";
      if(tight && k === xMaj.length-1 && p < n-1 && SX(t) > X0 + pw - fs*1.2) anchor = "end";
      if(tight && k === 0 && p > 0 && SX(t) < X0 + fs*1.2) anchor = "start";
      txt += `<text x="${SX(t).toFixed(2)}" y="${(Y0+ph+tp+digitH).toFixed(2)}" font-family="${fam}"
             font-size="${fs}" fill="${AX}" text-anchor="${anchor}">${t.toFixed(xd)}</text>`;
    });
    for(const t of yMaj){
      axg += tick(X0, SY(t), X0+tkMaj, SY(t)); if(F.frame) axg += tick(X0+pw, SY(t), X0+pw-tkMaj, SY(t));
      if(p === 0) txt += `<text x="${(X0-tp).toFixed(2)}" y="${(SY(t)+fs*0.35).toFixed(2)}" font-family="${fam}"
             font-size="${fs}" fill="${AX}" text-anchor="end">${t.toFixed(yd)}</text>`;
    }
    g += `<g shape-rendering="crispEdges">${axg}</g>${txt}`;

    // panel letter + condition caption
    const head = [];
    if(F.letters && n > 1) head.push(`(${String.fromCharCode(97+p)})`);
    if(P.cap) head.push(P.cap);
    if(head.length)
      g += `<text x="${(X0+fs*0.55).toFixed(2)}" y="${(Y0+fs*1.35).toFixed(2)}" font-family="${fam}"
             font-size="${(fs*0.95).toFixed(2)}" fill="${AX}"${HALO(fs*0.30)}>${richSVG(head.join(" "), fs*0.95)}</text>`;

    // line-end labels, outside the frame
    for(const q of P.ends)
      g += `<text x="${q.x.toFixed(2)}" y="${q.base.toFixed(2)}" font-family="${fam}"
             font-size="${endFs.toFixed(2)}" fill="${q.c}" text-anchor="start">${richSVG(q.t, endFs)}</text>`;
  }

  // shared legend
  if(F.labelMode === "legend" && panels.length){
    const ss = panels[0].series;
    const seg = fs*1.8, padx = fs*0.5, gapx = fs*1.1;
    let tot = 0;
    for(const s of ss) tot += seg + padx + richWidth(s.label, fs*0.92) + gapx;
    let x = Math.max(mL, (W - (tot - gapx))/2);
    const y = mT - legendH + fs*1.0;
    for(const s of ss){
      g += `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x+seg).toFixed(2)}" y2="${y.toFixed(2)}"
             stroke="${s.color}" stroke-width="${lw}" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
      x += seg + padx;
      g += `<text x="${x.toFixed(2)}" y="${(y+fs*0.33).toFixed(2)}" font-family="${fam}"
             font-size="${(fs*0.92).toFixed(2)}" fill="${AX}">${richSVG(s.label, fs*0.92)}</text>`;
      x += richWidth(s.label, fs*0.92) + gapx;
    }
  }

  // axis titles
  const spanW = W - mL - mR;
  const xTitleY = mT + ph + tp + digitH + xp + xCap;
  const yTitleX = yCap;
  g += `<text x="${(mL + spanW/2).toFixed(2)}" y="${xTitleY.toFixed(2)}" font-family="${fam}"
         font-size="${fs}" fill="${AX}" text-anchor="middle">${richSVG(F.xTitle, fs)}</text>`;
  g += `<text transform="translate(${yTitleX.toFixed(2)},${(mT + ph/2).toFixed(2)}) rotate(-90)"
         font-family="${fam}" font-size="${fs}" fill="${AX}" text-anchor="middle">${richSVG(F.yTitle, fs)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${F.width}in" height="${F.height}in" `
       + `viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" shape-rendering="geometricPrecision">${g}</svg>`;
}

// Grace projects contain native graphs, XY sets and text objects. Keep commands
// on individual lines even when a user-supplied label contains control characters.
function graceText(value){
  const clean = t => t.replace(/[\x00-\x1f\x7f]/g," ").replace(/"/g,"'").replace(/\\/g,"/").replace(/−/g,"-")
    .replace(/[Δμε]/g, c => "\\x"+({"Δ":"D","μ":"m","ε":"e"}[c])+"\\f{}");
  return '"' + richParts(String(value)).map(({t,k}) => k==="n" ? clean(t)
    : (k==="sub" ? "\\s" : "\\S")+clean(t)+"\\N").join("") + '"';
}
function buildFigureAGR(){
  const {F,W,H,mL,mT,pw,ph,gp,panels,lo,hi,xStep,yStep,xd,yd,stride} = publicationModel();
  const out=["# Grace project file", "@version 50125"], data=[];
  const cmd=t=>out.push("@"+t);
  const unit=Math.min(W,H), font=F.font==="serif"?0:4, size=F.fs/(0.025*unit);
  cmd(`page size ${Math.round(W)}, ${Math.round(H)}`);
  cmd(`page background fill ${F.white?"on":"off"}`);
  const colors=new Map([["#000000",1]]);
  for(const p of panels) for(const s of p.series) if(!colors.has(s.color)){
    const id=colors.size+1; colors.set(s.color,id);
    const rgb=s.color.slice(1).match(/../g).map(v=>parseInt(v,16));
    cmd(`map color ${id} to (${rgb.join(", ")}) , "series${id}"`);
  }
  panels.forEach((panel,p)=>{
    const left=mL+p*stride, bottom=H-mT-ph;
    const wx=x=>(x-left)/pw*S.gap, wy=y=>lo+(mT+ph-y)/ph*(hi-lo);   // figure points → world
    cmd(`g${p} on`); cmd(`with g${p}`);
    cmd(`world 0, ${lo}, ${S.gap}, ${hi}`);
    cmd(`view ${left/unit}, ${bottom/unit}, ${(left+pw)/unit}, ${(bottom+ph)/unit}`);
    cmd(`frame type ${F.frame?0:1}`); cmd(`frame linewidth ${F.axisLW}`);
    for(const [axis,title,step,prec] of [["xaxis",F.xTitle,xStep,xd],["yaxis",p===0?F.yTitle:"",yStep,yd]]){
      cmd(`${axis} on`); cmd(`${axis} label ${graceText(title)}`); cmd(`${axis} label font ${font}`);
      cmd(`${axis} label char size ${size}`); cmd(`${axis} tick major ${step}`);
      cmd(`${axis} tick minor ticks ${F.minor-1}`); cmd(`${axis} tick place ${F.frame?"both":"normal"}`);
      cmd(`${axis} ticklabel ${axis==="yaxis" && p>0?"off":"on"}`); cmd(`${axis} ticklabel prec ${prec}`);
      cmd(`${axis} ticklabel char size ${size}`); cmd(`${axis} ticklabel font ${font}`);
    }
    cmd(`legend ${F.labelMode==="legend" && p===0?"on":"off"}`);
    if(F.labelMode==="legend"){cmd("legend loctype view");cmd(`legend ${left/unit}, ${(H-mT)/unit}`);cmd(`legend char size ${size}`);}
    let id=0;
    const label=(text,x,y,color=1,just=0)=>{
      cmd("with string");cmd("string on");cmd("string loctype world");cmd(`string g${p}`);cmd(`string ${x}, ${y}`);
      cmd(`string color ${color}`);cmd(`string font ${font}`);cmd(`string char size ${size}`);cmd(`string just ${just}`);cmd(`string def ${graceText(text)}`);
    };
    const caption=[F.letters && panels.length>1?`(${String.fromCharCode(97+p)})`:"",panel.cap].filter(Boolean).join(" ");
    if(caption) label(caption,0.02*S.gap,hi-.07*(hi-lo));
    panel.series.forEach((series,i)=>{
      if(!series.segs.length) return;
      const color=colors.get(series.color);
      const set=(points,markers)=>{
        const k=id++, key=`s${k}`; cmd(`with g${p}`);
        cmd(`${key} comment ${graceText(series.label+(markers?" transitions":""))}`);
        cmd(`${key} legend ${graceText(markers?"":series.label)}`);
        cmd(`${key} line type ${markers?0:1}`);cmd(`${key} line linestyle ${F.gray?1+i%5:1}`);
        cmd(`${key} line color ${color}`);cmd(`${key} line linewidth ${F.lw}`);cmd(`${key} symbol ${markers?1:0}`);
        if(markers){cmd(`${key} symbol color ${color}`);cmd(`${key} symbol fill color ${color}`);cmd(`${key} symbol fill pattern 1`);}
        data.push(`@target G${p}.S${k}`,"@type xy",...points.map(pt=>pt.join(" ")),"&");
      };
      const points=series.segs.map(s=>[s.x0,s.A+s.q*s.x0]);
      const last=series.segs.at(-1); points.push([last.x1,last.A+last.q*last.x1]); set(points,false);
      if(F.mk && series.levels.length) set(series.levels.map(l=>[l.eps,l.ef]),true);
    });
    for(const q of panel.ends) label(q.t,wx(q.x),wy(q.base),colors.get(q.c),0);
    for(const c of panel.charges) label(c.t,wx(c.x),wy(c.y),colors.get(c.c),1);
  });
  return [...out,...data,""].join("\n");
}

/* ---------- figure controls ---------- */
function renderCondRows(){
  const F = S.fig;
  const nv = S.verts.length;
  if(!F.condsTouched){
    for(let i = 0; i < 3; i++) F.conds[i] = (i === 0 && S.selVtx === -1) || !nv ? -1 : (Math.max(0,S.selVtx) + i) % nv;
  }
  for(let i = 0; i < 3; i++) if(F.conds[i] >= nv) F.conds[i] = nv ? nv-1 : -1;
  const opts = i => S.verts.map((v, k) =>
      `<option value="${k}" ${F.conds[i]===k?"selected":""}>${String.fromCharCode(65+k)} — ${esc(v.act.join(" + "))}</option>`
    ).join("") + `<option value="-1" ${F.conds[i]===-1?"selected":""}>current Δμ</option>`;
  let h = "";
  for(let i = 0; i < F.n; i++){
    h += `<div class="condrow">
      <span class="pl">${F.n>1 ? "("+String.fromCharCode(97+i)+")" : "—"}</span>
      <select id="cond-${i}">${opts(i)}</select>
      <input type="text" id="cap-${i}" placeholder="${esc(autoCaption(F.conds[i])) || "caption"}" value="${esc(F.caps[i])}">
    </div>`;
  }
  $("cond-rows").innerHTML = h;
  for(let i = 0; i < F.n; i++){
    $("cond-"+i).addEventListener("change", e => {
      F.condsTouched = true; F.conds[i] = +e.target.value; renderCondRows(); renderFigure(); });
    $("cap-"+i).addEventListener("input", e => { F.caps[i] = e.target.value; renderFigure(); });
  }
}
function renderSeriesRows(){
  const names = defectNames();
  $("fig-series").innerHTML = names.map((nm, i) => {
    const st = styleOf(nm);
    return `<tr>
      <td><input type="checkbox" id="sv${i}" ${st.vis?"checked":""} aria-label="show ${esc(nm)}"></td>
      <td><input type="color" id="sc${i}" value="${st.color}" aria-label="color ${esc(nm)}"></td>
      <td class="muted" style="font-size:13.5px">${esc(nm)}</td>
      <td style="width:100%"><input type="text" id="sl${i}" value="${esc(st.label)}" aria-label="label ${esc(nm)}"></td>
    </tr>`;
  }).join("") || `<tr><td class="muted">No defects loaded.</td></tr>`;
  names.forEach((nm, i) => {
    $("sv"+i).addEventListener("change", e => { styleOf(nm).vis = e.target.checked; renderFigure(); });
    $("sc"+i).addEventListener("input",  e => { styleOf(nm).color = e.target.value; renderFigure(); });
    $("sl"+i).addEventListener("input",  e => { styleOf(nm).label = e.target.value; renderFigure(); });
  });
}
function renderFigure(){
  const F = S.fig;
  try { $("fig-prev").innerHTML = buildFigureSVG(); }
  catch(err){ $("fig-prev").innerHTML = `<div class="note bad">Figure could not be drawn: ${esc(err.message)}</div>`; }
  $("fig-dim").innerHTML = `<span class="dim">${F.width.toFixed(2)} × ${F.height.toFixed(2)} in`
    + ` · <b>${Math.round(F.width*300)} × ${Math.round(F.height*300)} px</b> at 300 dpi</span>`;
  $("f-xt").disabled = F.autoTick; $("f-yt").disabled = F.autoTick;
  $("f-ymin").disabled = F.yAuto;  $("f-ymax").disabled = F.yAuto;
}

/* ---------- figure wiring ---------- */
function bindFig(id, key, kind){
  const el = $(id);
  const ev = kind === "check" ? "change" : (kind === "text" ? "input" : "change");
  el.addEventListener(ev, () => {
    if(kind === "check"){ S.fig[key] = el.checked; }
    else if(kind === "num" || kind === "pad"){
      let v = numOr(el.value, NaN);
      if(Number.isFinite(v)){
        if(el.min !== "") v = Math.max(Number(el.min), v);
        if(el.max !== "") v = Math.min(Number(el.max), v);
        if(key === "minor") v = Math.round(v);
        S.fig[key] = v;
      }
      el.value = S.fig[key];   // 0 is a valid value
    } else { S.fig[key] = el.value; }
    renderFigure();
  });
}
$("f-n").addEventListener("change", e => {
  S.fig.n = +e.target.value; renderCondRows(); renderFigure();
});
$("f-preset").addEventListener("change", e => {
  if(e.target.value === "custom") return;
  S.fig.width = parseFloat(e.target.value);
  $("f-w").value = S.fig.width.toFixed(3);
  renderFigure();
});
$("f-w").addEventListener("change", e => {
  S.fig.width = Math.min(14, Math.max(1.5, numOr(e.target.value, 3.3)));
  e.target.value = S.fig.width;
  $("f-preset").value = "custom"; renderFigure();
});
bindFig("f-h","height","num");
bindFig("f-font","font","sel");
bindFig("f-fs","fs","num");
bindFig("f-lw","lw","num");
bindFig("f-alw","axisLW","num");
bindFig("f-xt","xTick","num");
bindFig("f-yt","yTick","num");
bindFig("f-mn","minor","num");
bindFig("f-ymin","yMin","num");
bindFig("f-ymax","yMax","num");
bindFig("f-tickpad","tickPad","pad");
bindFig("f-xpad","xPad","pad");
bindFig("f-ypad","yPad","pad");
bindFig("f-pgap","pGap","pad");
$("f-tight").addEventListener("click", () => {
  const v = {tickPad:1, xPad:0, yPad:0, pGap:4};
  for(const k in v){ S.fig[k] = v[k]; }
  $("f-tickpad").value = 1; $("f-xpad").value = 0; $("f-ypad").value = 0; $("f-pgap").value = 4;
  renderFigure();
});
bindFig("f-xtitle","xTitle","text");
bindFig("f-ytitle","yTitle","text");
bindFig("f-autotick","autoTick","check");
bindFig("f-yauto","yAuto","check");
bindFig("f-frame","frame","check");
bindFig("f-gray","gray","check");
bindFig("f-mk","mk","check");
bindFig("f-cl","cl","check");
bindFig("f-letters","letters","check");
bindFig("f-white","white","check");
bindFig("f-lm","labelMode","sel");

/* ---------- export ---------- */
function directSave(filename, data){
  const blob = data instanceof Blob ? data : new Blob([data], {type:"image/svg+xml"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function figName(ext){
  const host = (S.hostFormula || "figure").replace(/[^A-Za-z0-9]/g, "");
  return `${host}_formation_energy.${ext}`;
}
function pngWithDpi(bytes, dpi){
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0,9); chunk.set([112,72,89,115],4);
  view.setUint32(8,Math.round(dpi/0.0254)); view.setUint32(12,Math.round(dpi/0.0254)); chunk[16]=1;
  let crc=0xffffffff;
  for(const b of chunk.slice(4,17)){ crc ^= b; for(let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  view.setUint32(17,(crc^0xffffffff)>>>0);
  const parts=[bytes.slice(0,8)]; let offset=8;
  while(offset < bytes.length){
    const length=new DataView(bytes.buffer, bytes.byteOffset+offset,4).getUint32(0)+12;
    const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
    if(type !== "pHYs") parts.push(bytes.slice(offset,offset+length));
    if(type === "IHDR") parts.push(chunk);
    offset += length;
  }
  const out=new Uint8Array(parts.reduce((n,a)=>n+a.length,0)); let at=0;
  for(const part of parts){out.set(part,at); at+=part.length;}
  return out;
}
async function rasterize(dpi){
  const svg = buildFigureSVG();
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error("the browser could not rasterize the figure"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const c = document.createElement("canvas");
  if(S.fig.width*dpi*S.fig.height*dpi > 25000000) throw Error("Image exceeds 25 megapixels. Reduce its dimensions or choose 300 dpi");
  c.width  = Math.round(S.fig.width*dpi);
  c.height = Math.round(S.fig.height*dpi);
  const ctx = c.getContext("2d");
  if(S.fig.white){ ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  if(!blob) throw Error("The browser could not create the PNG");
  return new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), dpi)], {type:"image/png"});
}
function figMsg(html, cls){
  $("fig-msg").innerHTML = html ? `<div class="note ${cls||""}">${html}</div>` : "";
}
async function saveFile(filename, data, btn){
  directSave(filename, data); flash(btn, "Downloaded"); figMsg("");
}
async function exportPNG(dpi, btn){
  if(btn.disabled) return;
  flash(btn, "Rendering…", 0);           // stays until rendering finishes
  btn.disabled = true;
  try {
    const blob = await rasterize(dpi);
    if(!blob) throw new Error("empty image");
    await saveFile(figName("png"), blob, btn);
  } catch(err){
    flash(btn, "Failed");
    figMsg(`PNG export failed: ${esc(err.message)}. The SVG export is unaffected.`, "warn");
  } finally {
    btn.disabled = false;
  }
}
$("b-png").addEventListener("click", e => exportPNG(300, e.target));
$("b-png6").addEventListener("click", e => exportPNG(600, e.target));
$("b-svgdl").addEventListener("click", async e => {
  try { await saveFile(figName("svg"), buildFigureSVG(), e.target); }
  catch(err){ figMsg(esc(err.message), "warn"); }
});
$("b-agr").addEventListener("click", async e => {
  try { await saveFile(figName("agr"), new Blob([buildFigureAGR()], {type:"text/plain"}), e.target); }
  catch(err){ figMsg(esc(err.message), "warn"); }
});
$("b-figcopy").addEventListener("click", async e => {
  try { await navigator.clipboard.writeText(buildFigureSVG()); flash(e.target, "Copied"); }
  catch { flash(e.target, "Copy blocked"); }
});
for(const id of ["b-png","b-png6","b-svgdl","b-agr"]) $(id).hidden = false;

const INPUT_IDS = ["f-host","f-dhf","f-bulk","f-vbm","f-gap","ta-def","ta-ph"];
for(const id of ['host-type','host-basis','host-units'])$(id).addEventListener('change',()=>{$('import-explanation').hidden=true;recompute();});
$("b-save-lab").addEventListener("click",()=>{
  try { directSave('chemical-potential-session.json',new Blob([JSON.stringify(toChemicalSession(),null,2)],{type:'application/json'})); }
  catch(err){ $("input-status").textContent=err.message; }
});
$("b-save-inputs").addEventListener("click", () => {
  if(!S.valid){ $("input-status").scrollIntoView({behavior:"smooth"}); return; }
  const data = {format:"defect-formation-explorer",version:1,
    inputs:Object.fromEntries(INPUT_IDS.map(id=>[id,$(id).value])),
    hostEnergy:{type:$('host-type').value,basis:$('host-basis').value,units:$('host-units').value},
    references:Object.fromEntries([...S.elements, ...S.dopants].map(el=>[el,$("mu-"+el).value])),
    dopants:$("f-dop").value, dopantSettings:JSON.parse(JSON.stringify(S.dopSet)),
    dmu:{...S.dmu}};
  directSave(figName("json"),new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
});
$("u-inputs").addEventListener("change", async e => {
  const file=e.target.files?.[0]; if(!file) return;
  try {
    if(file.size > 2000000) throw Error("Input file must be smaller than 2 MB.");
    const data=JSON.parse(await file.text());
    if([1,2].includes(data.schemaVersion) && data.model){
      const imported=fromChemicalSession(data);
      $("import-explanation").hidden=false;
      $("import-explanation").textContent=imported.explanation;
      $("f-host").value=imported.host; $("f-dhf").value=data.model.target.energy;
      $('host-type').value=data.model.target.energyType || data.model.mode;
      $('host-basis').value=data.model.target.basis || 'formula';
      $('host-units').value=data.model.target.units ?? 1;
      $("ta-ph").value='phase,dHf\n'+imported.phases.map(p=>`${p.name},${p.dHf}`).join('\n');
      for(const id of ['ta-def','f-bulk','f-vbm','f-gap','f-dop']) $(id).value=''; S.dopSet={};
      S.elements=[]; S.muRef=imported.refs; S.chemicalOwn=imported.own;
      S.dmu={}; S.selVtx=0; S.hidden.clear(); S.fig.condsTouched=false;
      recompute();
      S.axX=imported.axes[0]; S.axY=imported.axes[1]; orderVertices(); buildAxisSelects();
      if(imported.dmu){ const f=feasibility(imported.dmu); if(Math.abs(f.hostResid)<1e-6 && !f.viol.length) S.dmu=imported.dmu; }
      S.selVtx=S.verts.findIndex(v=>S.elements.every(el=>Math.abs(v.dmu[el]-S.dmu[el])<1e-6));
      draw();
      $("src-tag").textContent='Chemical Potential Lab session';
      $("data-notice").textContent='Imported host energy, type and units preserved exactly from the session. Calculated host ΔHf is shown separately. Competing phases are normalized to formation enthalpies per formula. '+(imported.own?'User-supplied energies.':'Check source energy provenance before research use.')+' Defect inputs were cleared. Enter your bulk/VBM/gap and elemental references before adding defects.';
      e.target.value='';
      return;
    }
    applySavedInputs(data);
    $("src-tag").textContent="saved inputs";
    $("data-notice").textContent="User-supplied data. Results depend on your energy references and included phases. Save inputs to keep a local copy; figure styling is not included.";
  } catch(err){ $("input-status").textContent=`Could not open inputs: ${err.message}`; }
  e.target.value="";
});
// Restore a file written by "Save inputs" (also used by the bundled examples).
function applySavedInputs(data){
  if(data.format !== "defect-formation-explorer" || data.version !== 1 ||
    !INPUT_IDS.every(id=>typeof data.inputs?.[id] === "string")) throw Error("Choose an input file saved by this app.");
  const comp=parseFormula(data.inputs["f-host"]);
  if(!comp) throw Error("Invalid host formula.");
  INPUT_IDS.forEach(id=>$(id).value=data.inputs[id]);
  $('host-type').value=data.hostEnergy?.type||'formation';$('host-basis').value=data.hostEnergy?.basis||'formula';$('host-units').value=data.hostEnergy?.units||1;
  $("f-dop").value = typeof data.dopants === "string" ? data.dopants : "";
  S.dopSet = data.dopantSettings && typeof data.dopantSettings === "object" ? JSON.parse(JSON.stringify(data.dopantSettings)) : {};
  S.elements=[]; S.dopants=[]; S.muRef=Object.fromEntries(Object.entries(data.references || {}).map(([el,v])=>[el,numOr(v,NaN)]));
  S.selVtx=0; S.hidden.clear(); S.fig.condsTouched=false;
  recompute();
  if(S.valid && S.elements.every(el=>Number.isFinite(data.dmu?.[el]))){
    const f=feasibility(data.dmu);
    if(Math.abs(f.hostResid)<1e-6){ S.dmu={...data.dmu}; S.selVtx=S.verts.findIndex(v=>S.elements.every(el=>Math.abs(v.dmu[el]-S.dmu[el])<1e-6)); draw(); }
  }
}
// Bundled examples in examples/ (illustrative numbers, saved-inputs format).
async function loadExample(file, label){
  try {
    const res = await fetch(`examples/${file}`, {cache:"no-cache"});
    if(!res.ok) throw Error(`HTTP ${res.status}`);
    applySavedInputs(await res.json());
    $("src-tag").textContent = label;
    $("data-notice").textContent = `${label}: illustrative numbers that show the input format, not results from a real calculation. Replace them with your own consistent DFT energies.`;
  } catch(err){
    $("input-status").innerHTML = `<div class="note bad">Could not load the example (${esc(err.message)}). Examples need the app to be served over http(s); you can also open the file from the examples folder with Open inputs.</div>`;
  }
}
$("b-ex-zno").addEventListener("click", () => loadExample("ZnO_native_defects.json", "ZnO native-defect example"));
$("b-ex-znoal").addEventListener("click", () => loadExample("ZnO_Al_doped.json", "ZnO:Al example"));
for(const id of [...INPUT_IDS,"f-dop","muref-grid"]){
  $(id).addEventListener("input", () => {
    $("src-tag").textContent="your data";
    $("data-notice").textContent="User-supplied data. Results depend on your energy references and included phases. Save inputs to keep a local copy; figure styling is not included.";
    invalidate("Inputs changed. Press Calculate after editing to update the results.");
  });
}
let rt;
new ResizeObserver(() => {
  clearTimeout(rt);
  rt = setTimeout(() => { renderRegion(); renderMain(); }, 90);
}).observe(document.getElementById("cb-main"));

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderRegion(); renderMain(); });
new MutationObserver(() => { renderRegion(); renderMain(); })
  .observe(document.documentElement, {attributes:true, attributeFilter:["data-theme"]});

loadDemo();
