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

function loadDefects(text, elements){
  const {head, rows, rawHead} = parseTable(text);
  const iName = head.findIndex(h => ["defect","name","label"].includes(h));
  const iQ    = head.findIndex(h => ["charge","q"].includes(h));
  const iE    = head.findIndex(h => ["e_tot","etot","energy","e"].includes(h));
  const iC    = head.findIndex(h => ["e_corr","ecorr","correction","corr"].includes(h));
  const errs = [];
  if(iName < 0) errs.push("no 'defect' column");
  if(iQ < 0) errs.push("no 'charge' column");
  if(iE < 0) errs.push("no 'E_tot' column");
  const elCol = {};
  for(const el of elements){
    const j = rawHead.findIndex(h => h === el);
    if(j >= 0) elCol[el] = j;
    else errs.push(`missing '${el}' atom-count column (use 0 if unchanged)`);
  }
  for(const col of rawHead) if(ELEMENTS.has(col) && !elements.includes(col))
    errs.push(`Unsupported dopant column '${col}': only host elements are supported.`);
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
    const dn = {};
    for(const el of elements) dn[el] = numOr(r[elCol[el]], NaN);
    const Ecorr = iC >= 0 ? numOr(r[iC], NaN) : 0;
    if(!Number.isFinite(Ecorr) || !Object.values(dn).every(Number.isInteger)){
      errs.push(`row ${n+2}: E_corr must be numeric and atom counts must be integers`); return;
    }
    const previous = list.find(d => d.name === nm);
    if(previous && elements.some(el => previous.dn[el] !== dn[el])){
      errs.push(`row ${n+2}: all charge states of ${nm} must have the same atom counts`); return;
    }
    if(list.filter(d => d.name === nm).length >= 100){ errs.push(`${nm}: limit 100 entries per defect`); return; }
    list.push({name:nm, q, Etot:E, Ecorr, dn});
  });
  return {list, errs};
}

function loadPhases(text, elements){
  if(!String(text).trim()) return {list:[], errs:[]};
  const {head, rows, rawHead} = parseTable(text);
  const iName = head.findIndex(h => ["phase","formula","name","compound"].includes(h));
  const iH    = head.findIndex(h => ["dhf","d_hf","hf","enthalpy","e_f","dh"].includes(h));
  const errs = [];
  if(iName < 0 || iH < 0) return {list:[], errs:["need 'phase' and 'dHf' columns"]};
  const elCol = {};
  for(const el of elements){
    const j = rawHead.findIndex(h => h === el);
    if(j >= 0) elCol[el] = j;
  }
  for(const col of rawHead) if(ELEMENTS.has(col) && !elements.includes(col))
    errs.push(`Phase column '${col}' is outside the host elements.`);
  if(errs.length) return {list:[], errs};
  const hasCols = Object.keys(elCol).length > 0;
  const list = [];
  rows.forEach((r, n) => {
    const nm = r[iName];
    if(!nm){ errs.push(`row ${n+2}: missing phase name`); return; }
    const dHf = numOr(r[iH], NaN);
    if(!Number.isFinite(dHf)){ errs.push(`row ${n+2}: bad dHf`); return; }
    let comp = {};
    if(hasCols){
      for(const el of elements) comp[el] = elCol[el] !== undefined ? numOr(r[elCol[el]], NaN) : 0;

    } else {
      comp = parseFormula(nm) || {};
    }
    const foreign = Object.keys(comp).filter(k => !elements.includes(k));
    if(foreign.length){ errs.push(`${nm}: contains elements outside the host (${foreign.join(", ")})`); return; }
    if(!Object.values(comp).every(v => Number.isFinite(v) && v >= 0) || Object.values(comp).every(v => !v)){ errs.push(`${nm}: could not read composition`); return; }
    list.push({name:nm, comp, dHf});
  });
  return {list, errs};
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
function ef(d, EF, dmu){
  const M = dmu || S.dmu;
  let e = d.Etot - S.bulk + d.Ecorr + d.q*(S.vbm + EF);
  for(const el of S.elements) e -= (d.dn[el]||0)*((S.muRef[el]||0) + (M[el]||0));
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
  const H = Math.max(240, Math.min(360, W*0.78));
  const m = {t:14, r:16, b:40, l:52};
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
  for(const t of xt) g += `<text x="${SX(t)}" y="${m.t+ih+15}" fill="${ink3}" font-size="10" font-family="${css('--mono')||'monospace'}" text-anchor="middle">${t}</text>`;
  for(const t of yt) g += `<text x="${m.l-7}" y="${SY(t)+3.5}" fill="${ink3}" font-size="10" font-family="monospace" text-anchor="end">${t}</text>`;
  g += `<line x1="${m.l}" y1="${m.t+ih}" x2="${m.l+iw}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<text x="${m.l+iw/2}" y="${H-6}" fill="${ink2}" font-size="11" text-anchor="middle">Δμ(${S.axX}) — eV</text>`;
  g += `<text transform="translate(12,${m.t+ih/2}) rotate(-90)" fill="${ink2}" font-size="11" text-anchor="middle">Δμ(${S.axY}) — eV</text>`;

  if(pts.length >= 3){
    const h = hull2(pts);
    const dstr = h.map(p => `${SX(p[0])},${SY(p[1])}`).join(" ");
    g += `<polygon points="${dstr}" fill="${acc}" fill-opacity="0.13" stroke="${acc}" stroke-width="2" stroke-linejoin="round"/>`;
  } else if(pts.length === 2){
    g += `<line x1="${SX(pts[0][0])}" y1="${SY(pts[0][1])}" x2="${SX(pts[1][0])}" y2="${SY(pts[1][1])}" stroke="${acc}" stroke-width="3" stroke-linecap="round"/>`;
  }

  pts.forEach((p, i) => {
    const sel = i === S.selVtx;
    g += `<circle class="vdot" data-i="${i}" cx="${SX(p[0])}" cy="${SY(p[1])}" r="${sel?6:4.5}"
           fill="${sel?acc:surf}" stroke="${acc}" stroke-width="2" style="cursor:pointer"/>`;
    g += `<text x="${SX(p[0])+9}" y="${SY(p[1])-7}" fill="${ink}" font-size="10.5" font-weight="600" font-family="monospace">${String.fromCharCode(65+i)}</text>`;
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
  if(!S.verts.length){ $("svg-main").innerHTML = ""; return; }
  const svg = document.getElementById("svg-main");
  const box = document.getElementById("cb-main");
  const W = Math.max(300, box.clientWidth || 860);
  const narrow = W < 560;
  const H = Math.max(320, Math.min(560, W*(narrow ? 0.85 : 0.56)));
  const labelRoom = S.showLbl && !narrow ? 86 : 16;
  const m = {t:18, r:labelRoom, b:46, l:56};
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
  g += `<text x="${SX(0)+5}" y="${m.t+11}" fill="${ink3}" font-size="10" font-family="monospace" letter-spacing="0.5">VBM</text>`;
  g += `<text x="${SX(gap)-5}" y="${m.t+11}" fill="${ink3}" font-size="10" font-family="monospace" letter-spacing="0.5" text-anchor="end">CBM</text>`;

  for(const t of yt) g += `<text x="${m.l-8}" y="${SY(t)+3.5}" fill="${ink3}" font-size="10.5" font-family="monospace" text-anchor="end">${t}</text>`;
  for(const t of xt) g += `<text x="${SX(t)}" y="${m.t+ih+16}" fill="${ink3}" font-size="10.5" font-family="monospace" text-anchor="middle">${t}</text>`;
  g += `<line x1="${m.l}" y1="${m.t+ih}" x2="${m.l+iw}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t+ih}" stroke="${line2}" stroke-width="1"/>`;
  g += `<text x="${m.l+iw/2}" y="${H-8}" fill="${ink2}" font-size="11.5" text-anchor="middle">Fermi level above VBM — eV</text>`;
  g += `<text transform="translate(13,${m.t+ih/2}) rotate(-90)" fill="${ink2}" font-size="11.5" text-anchor="middle">Formation energy — eV</text>`;

  // faint all-charge-state lines behind the envelopes
  if(S.showAll){
    for(const d of data) for(const l of d.ls){
      g += `<line x1="${SX(0)}" y1="${SY(l.A)}" x2="${SX(gap)}" y2="${SY(l.A + l.q*gap)}"
             stroke="${d.color}" stroke-width="1" stroke-opacity="0.34" stroke-dasharray="3 3"/>`;
    }
  }

  // envelopes
  for(const d of data){
    const pts = [];
    d.segs.forEach((s, i) => {
      if(i === 0) pts.push([SX(s.x0), SY(s.A + s.q*s.x0)]);
      pts.push([SX(s.x1), SY(s.A + s.q*s.x1)]);
    });
    if(pts.length){
      g += `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none"
             stroke="${d.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
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
      const xm = (s.x0 + s.x1)/2;
      const y = SY(s.A + s.q*xm);
      g += `<text x="${SX(xm)}" y="${y - 7}" fill="${d.color}" font-size="10" font-weight="600"
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
    const MIN = 13;
    for(let i = 1; i < lab.length; i++)
      if(lab[i].y - lab[i-1].y < MIN) lab[i].y = lab[i-1].y + MIN;
    if(lab.length){
      const over = lab[lab.length-1].y - (m.t + ih);
      if(over > 0) for(const L of lab) L.y -= over;
      if(lab[0].y < m.t + 6) { const up = m.t + 6 - lab[0].y; for(const L of lab) L.y += up; }
    }
    for(const L of lab){
      g += `<line x1="${m.l+iw+2}" y1="${L.y}" x2="${m.l+iw+8}" y2="${L.y}" stroke="${L.color}" stroke-width="2"/>`;
      g += `<text x="${m.l+iw+11}" y="${L.y+3.5}" fill="${ink}" font-size="10.5" font-family="monospace">${esc(L.name)}</text>`;
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
    `<span class="chip">gap <b>${fx(S.gap,2)} eV</b></span>`,
    `<span class="chip">${n} defect${n===1?"":"s"} · <b>${S.defects.length}</b> entries</span>`,
    `<span class="chip">Δμ <b>${S.elements.map(e => `${e} ${fx(S.dmu[e],2)}`).join(" · ")}</b></span>`
  ].join("");
  $("cond-tag").textContent = cond
    ? `vertex ${String.fromCharCode(65+S.selVtx)} — ${cond.act.join(" + ")}`
    : "custom Δμ";
  $("tag-host").textContent = S.elements.join(" ");
  $("tag-def").textContent = `${S.defects.length} rows`;
  $("tag-ph").textContent = `${S.phases.length} phases`;
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
      <span class="lbl" style="width:56px">Δμ(${e})</span>
      <input type="number" step="0.01" id="dmu-${e}" value="${S.dmu[e].toFixed(4)}"
        ${e===p?"disabled":""} style="flex:1" aria-label="Delta mu ${e}">
      ${e===p?`<span class="muted mono" style="font-size:10px">solved</span>`:""}
    </div>`).join("");
  for(const e of S.elements){
    if(e === p) continue;
    $("dmu-"+e).addEventListener("change", () => {
      const v = parseFloat($("dmu-"+e).value);
      if(!Number.isFinite(v)) return;
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
  renderChips(); renderVertexList(); renderDmuInputs(); renderFeas();
  renderLegend(); renderRegion(); renderMain(); renderTables(); renderMsgs();
  renderCondRows(); renderSeriesRows(); renderFigure();
}

function readSystem(){
  S.hostFormula = $("f-host").value.trim();
  const hc = parseFormula(S.hostFormula);
  if(!hc) throw Error("Enter a valid host formula, such as ZnO, In2O3 or CuInSe2.");
  if(Object.keys(hc).length < 2 || Object.keys(hc).length > 4) throw Error("Use a host containing 2–4 elements.");
  const els = Object.keys(hc);
  const changed = els.join() !== S.elements.join();
  S.hostDHf = requiredNumber("f-dhf", "Host formation enthalpy");
  S.bulk = requiredNumber("f-bulk", "Bulk supercell energy");
  S.vbm = requiredNumber("f-vbm", "VBM energy");
  S.gap = requiredNumber("f-gap", "Band gap");
  if(S.gap <= 0) throw Error("The band gap must be greater than zero.");
  S.hostCoeff = hc; S.elements = els;
  if(changed){
    for(const e of els) if(!(e in S.muRef)) S.muRef[e] = 0;
    S.axX = els[0]; S.axY = els[1] || els[0];
    buildMuRefGrid(); buildAxisSelects();
  }
  for(const e of els){
    const inp = $("mu-"+e);
    if(inp) S.muRef[e] = requiredNumber("mu-"+e, `Reference for ${e}`);
  }
}
function buildMuRefGrid(){
  $("muref-grid").innerHTML = S.elements.map(e => `
    <div class="field"><label for="mu-${e}">${e}</label>
      <input type="number" step="0.0001" id="mu-${e}" value="${(S.muRef[e]||0).toFixed(4)}"></div>`).join("");
  S.elements.forEach(e => $("mu-"+e).addEventListener("change", recompute));
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
const EXPORT_IDS = ["b-svg", "b-tsv", "b-png", "b-png6", "b-svgdl", "b-figcopy"];
function invalidate(message){
  S.valid = false;
  $("input-status").innerHTML = `<div class="note bad"><b>Inputs need attention.</b> ${esc(message)} Results are cleared until the inputs are corrected.</div>`;
  for(const id of ["chips","vtx-list","dmu-inputs","feas","legend","svg-region","svg-main","fig-prev","cond-rows","fig-series","main-msg"]) $(id).innerHTML = "";
  for(const id of ["tbl-lv","tbl-edge"]) $(id).querySelector("tbody").innerHTML = "";
  $("region-dim").textContent = "Calculation paused";
  $("cond-tag").textContent = "";
  EXPORT_IDS.forEach(id => $(id).disabled = true);
}
function recompute(){
 try {
  readSystem();
  const dres = loadDefects($("ta-def").value, S.elements);
  const pres = loadPhases($("ta-ph").value, S.elements);
  S.defects = dres.list; S.phases = pres.list;
  S.errors = [...dres.errs, ...pres.errs];
  if(S.errors.length) throw Error(S.errors.join("; "));
  if(!S.defects.length) throw Error("Add at least one defect entry.");
  computeVertices();
  S.valid = true;
  $("input-status").innerHTML = "";
  EXPORT_IDS.forEach(id => $(id).disabled = !S.verts.length);
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
  $("f-host").value = DEMO.host; $("f-dhf").value = DEMO.dHf;
  $("f-bulk").value = DEMO.bulk; $("f-vbm").value = DEMO.vbm; $("f-gap").value = DEMO.gap;
  S.muRef = {...DEMO.muRef}; S.elements = [];
  $("ta-def").value = DEMO.defects; $("ta-ph").value = DEMO.phases;
  S.hidden.clear(); S.selVtx = 0; S.dmu = {}; S.fig.condsTouched = false; S.fig.caps = ["","",""];
  $("src-tag").textContent = "illustrative example";
  $("data-notice").textContent = "The CuInSe₂ example is illustrative, not a validated material dataset. Replace it with your own consistent DFT energies. Calculations and file processing stay in your browser.";
  recompute();
}

/* ============================================================ wiring */
["f-host","f-dhf","f-bulk","f-vbm","f-gap"].forEach(id =>
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

function flash(btn, txt){
  const old = btn.textContent; btn.textContent = txt;
  setTimeout(() => btn.textContent = old, 1400);
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
  const head = `# ${S.hostFormula}  Delta-mu: ` +
    S.elements.map(el => `${el}=${S.dmu[el].toFixed(4)}`).join(" ");
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

function buildFigureSVG(){
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
  const pw = (W - mL - mR - (n-1)*gp)/n;
  const ph = H - mT - mB;
  const tkMaj = fs*0.55, tkMin = fs*0.30;
  const aw = Math.max(0.4, F.axisLW);       // frame and ticks, independent of the data lines
  S.__geo = {mL, mR, mT, mB, pw, ph, gp, n, W, H, xMaj, yMaj, xMin, yMinT};
  if(!(pw > fs*2) || !(ph > fs*2))
    throw new Error("no room left for the plot — reduce the label gaps or increase the figure size");

  const AX = "#000000";
  let g = "";
  if(F.white) g += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  for(let p = 0; p < n; p++){
    const X0 = mL + p*(pw + gp), Y0 = mT;
    const SX = v => X0 + v/S.gap*pw;
    const SY = v => Y0 + ph - (v - lo)/(hi - lo)*ph;
    const P = panels[p];
    const cid = `publication-clip-${p}`;
    g += `<clipPath id="${cid}"><rect x="${X0}" y="${Y0}" width="${pw}" height="${ph}"/></clipPath>`;

    g += `<g clip-path="url(#${cid})">`;
    const placed = [];                     // charge-label collision guard
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
      if(F.cl) for(const sg of s.segs){
        if(SX(sg.x1) - SX(sg.x0) < fs*2.2) continue;
        const xm = (sg.x0 + sg.x1)/2;
        const tx = SX(xm), ty = SY(sg.A + sg.q*xm) - lw - fs*0.45;
        if(placed.some(q => Math.abs(q[0]-tx) < fs*1.9 && Math.abs(q[1]-ty) < fs*1.05)) continue;
        placed.push([tx, ty]);
        g += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}"
               font-family="${fam}" font-size="${(fs*0.82).toFixed(2)}" fill="${s.color}"
               text-anchor="middle"${HALO(fs*0.26)}>${esc(sgn(sg.q))}</text>`;
      }
    }
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
    const tight = n > 1 && gp < fs*1.9;
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

    // line-end labels
    if(F.labelMode === "end"){
      const L = P.series.filter(s => s.segs.length).map(s => {
        const sg = s.segs[s.segs.length-1];
        return {t:s.label, c:s.color, y:SY(sg.A + sg.q*sg.x1)};
      }).sort((a,b) => a.y - b.y);
      const MIN = fs*1.32;
      for(let i = 1; i < L.length; i++) if(L[i].y - L[i-1].y < MIN) L[i].y = L[i-1].y + MIN;
      if(L.length){
        const over = L[L.length-1].y - (Y0 + ph - fs*0.35);
        if(over > 0) for(const q of L) q.y -= over;
        const under = (Y0 + fs*1.0) - L[0].y;
        if(under > 0) for(const q of L) q.y += under;
      }
      for(const q of L)
        g += `<text x="${(X0+pw-fs*0.4).toFixed(2)}" y="${(q.y - fs*0.42).toFixed(2)}" font-family="${fam}"
               font-size="${(fs*0.92).toFixed(2)}" fill="${q.c}" text-anchor="end"${HALO(fs*0.30)}>${richSVG(q.t, fs*0.92)}</text>`;
    }
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
      <td class="muted" style="font-size:11.5px">${esc(nm)}</td>
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
  flash(btn, "Rendering…");
  try {
    const blob = await rasterize(dpi);
    if(!blob) throw new Error("empty image");
    await saveFile(figName("png"), blob, btn);
  } catch(err){
    figMsg(`PNG export failed: ${esc(err.message)}. The SVG export is unaffected.`, "warn");
  }
}
$("b-png").addEventListener("click", e => exportPNG(300, e.target));
$("b-png6").addEventListener("click", e => exportPNG(600, e.target));
$("b-svgdl").addEventListener("click", async e => {
  try { await saveFile(figName("svg"), buildFigureSVG(), e.target); }
  catch(err){ figMsg(esc(err.message), "warn"); }
});
$("b-figcopy").addEventListener("click", async e => {
  try { await navigator.clipboard.writeText(buildFigureSVG()); flash(e.target, "Copied"); }
  catch { flash(e.target, "Copy blocked"); }
});
for(const id of ["b-png","b-png6","b-svgdl"]) $(id).hidden = false;

const INPUT_IDS = ["f-host","f-dhf","f-bulk","f-vbm","f-gap","ta-def","ta-ph"];
$("b-save-inputs").addEventListener("click", () => {
  if(!S.valid){ $("input-status").scrollIntoView({behavior:"smooth"}); return; }
  const data = {format:"defect-formation-explorer",version:1,
    inputs:Object.fromEntries(INPUT_IDS.map(id=>[id,$(id).value])),
    references:Object.fromEntries(S.elements.map(el=>[el,$("mu-"+el).value])),
    dmu:{...S.dmu}};
  directSave(figName("json"),new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
});
$("u-inputs").addEventListener("change", async e => {
  const file=e.target.files?.[0]; if(!file) return;
  try {
    if(file.size > 2000000) throw Error("Input file must be smaller than 2 MB.");
    const data=JSON.parse(await file.text());
    if(data.format !== "defect-formation-explorer" || data.version !== 1 ||
      !INPUT_IDS.every(id=>typeof data.inputs?.[id] === "string")) throw Error("Choose an input file saved by this app.");
    const comp=parseFormula(data.inputs["f-host"]);
    if(!comp || !Object.keys(comp).every(el=>Number.isFinite(numOr(data.references?.[el],NaN)))) throw Error("Missing or invalid elemental references.");
    INPUT_IDS.forEach(id=>$(id).value=data.inputs[id]);
    S.elements=[]; S.muRef=Object.fromEntries(Object.keys(comp).map(el=>[el,Number(data.references[el])]));
    S.selVtx=0; S.hidden.clear(); S.fig.condsTouched=false;
    recompute();
    if(S.valid && S.elements.every(el=>Number.isFinite(data.dmu?.[el]))){
      const f=feasibility(data.dmu);
      if(Math.abs(f.hostResid)<1e-6){ S.dmu={...data.dmu}; S.selVtx=S.verts.findIndex(v=>S.elements.every(el=>Math.abs(v.dmu[el]-S.dmu[el])<1e-6)); draw(); }
    }
    $("src-tag").textContent="saved inputs";
    $("data-notice").textContent="User-supplied data. Results depend on your energy references and included phases. Save inputs to keep a local copy; figure styling is not included.";
  } catch(err){ $("input-status").textContent=`Could not open inputs: ${err.message}`; }
  e.target.value="";
});
for(const id of [...INPUT_IDS,"muref-grid"]){
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
