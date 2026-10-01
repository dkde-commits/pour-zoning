// 독립 검산: 프로그램이 낸 값을 따로 다시 계산해 대조한다. 결과가 다르면 오류 문구를 돌려준다.
const fs = require('fs'), path = require('path');
const C = require('../js/core.js');
const src = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
const { bendAtNode } = new Function(src + ';return {bendAtNode};')();
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));

// 모델 단위 검사: 물량 보존, 구역 수 하한, 순경간
function checkModel(M, inp) {
  const E = [], U = M.units;
  const su = U.reduce((a, u) => a + u.vol, 0); if (!near(su, M.C, 1e-9)) E.push(`단위 물량 합 ${su} ≠ 총량 ${M.C}`);
  let sc = 0; for (let k = 0; k < M.cellVol.length; k++) sc += M.cellVol[k]; if (!near(sc, M.C, 1e-6)) E.push('칸 물량 합 ≠ 총량');
  if (!near(M.pieces.reduce((a, p) => a + p.vol, 0), M.C, 1e-6)) E.push('조각 물량 합 ≠ 총량');
  const nl = Math.max(Math.ceil(M.C / inp.P - 1e-9), U.filter(u => u.vol > inp.P / 2 + 1e-9).length);
  if (M.Nmin !== nl) E.push(`구역 수 하한 ${M.Nmin} ≠ ${nl}`);
  for (const b of M.beams) if (b.fa !== undefined && !(b.fa >= b.a - 1e-9 && b.fb <= b.b + 1e-9 && b.fb > b.fa)) { E.push('순경간 면 위치 이상'); break; }
  return E;
}

// 구획안 검사: 물량·수식, 연결성, 꺾임, 규칙 1·2, 비상 중단선
function checkPlan(M, inp, s) {
  const E = [], U = M.units, N = s.vol.length, z = s.z, T = M.C / N;
  const vol = new Array(N).fill(0); U.forEach((u, i) => vol[z[i]] += u.vol);
  vol.forEach((v, k) => { if (!near(v, s.vol[k], 1e-9)) E.push(`C${k + 1} 물량 불일치`); });
  if (!near(s.maxVol, Math.max(...vol)) || !near(s.minVol, Math.min(...vol))) E.push('최대·최소 구역 불일치');
  if (!near(s.maxDev, Math.max(...vol.map(v => Math.abs(v - T))) / T, 1e-6)) E.push('물량 불균형 불일치');
  let J = 0; for (const e of M.edges) { if (e.A < 0) continue; if (z[M.unitOf[e.A]] !== z[M.unitOf[e.B]]) J += Math.hypot(e.x2 - e.x1, e.y2 - e.y1); }
  if (!near(s.total, J, 1e-6)) E.push('이음 길이 합 불일치');
  if (s.maxVol > inp.P + 1e-6) E.push('하루 한도 초과');
  for (let k = 0; k < N; k++) { // 규칙 6
    const mem = []; U.forEach((u, i) => { if (z[i] === k) mem.push(i); }); if (!mem.length) { E.push('빈 구역'); continue; }
    const seen = new Set([mem[0]]), st = [mem[0]]; while (st.length) { const u = st.pop(); for (const [v] of U[u].nb) if (z[v] === k && !seen.has(v)) { seen.add(v); st.push(v); } }
    if (seen.size !== mem.length) E.push(`C${k + 1} 떨어져 있음(규칙 6)`);
  }
  for (let j = 1; j < M.ny; j++) for (let i = 1; i < M.nx; i++) if (bendAtNode(M, z, j * (M.nx + 1) + i)) { E.push('슬래브 한가운데 꺾임(규칙 3)'); j = M.ny; break; }
  const r = inp.ratio, m = inp.mult; // 규칙 1·2
  for (const e of M.edges) {
    if (e.A < 0 || z[M.unitOf[e.A]] === z[M.unitOf[e.B]]) continue;
    if (!e.ok) { E.push('절단 불가 경계를 사용: ' + e.why); break; }
    const vert = Math.abs(e.x1 - e.x2) < 1e-9;
    for (const [px, py] of [[e.x1, e.y1], [e.x2, e.y2]]) for (const b of M.beams) {
      if (vert ? b.o !== 'h' : b.o !== 'v') continue; const perp = vert ? py : px, al = vert ? px : py;
      if (Math.abs(perp - b.c) > 1e-6 || al <= b.a + 1e-6 || al >= b.b - 1e-6) continue;
      const fa = b.fa ?? b.a, fb = b.fb ?? b.b, L = fb - fa, lo = fa + L * (1 - r) / 2, hi = fb - L * (1 - r) / 2;
      if (al < lo - 1e-6 || al > hi + 1e-6) E.push(`규칙 1 위반 @${al.toFixed(2)}`);
      for (const jn of b.j) if (Math.abs(al - jn.pos) < jn.w / 2 + m * jn.w - 1e-6) E.push(`규칙 2 위반 @${al.toFixed(2)}`);
    }
  }
  const cap = inp.truck || 6, tie = inp.tieTol ?? 0.5; // 비상 중단선
  for (let k = 0; k < N; k++) {
    const sp = C.stopPlan(M, z, k, inp.pourDir || 'auto', cap, tie).best, tr = Math.max(1, Math.ceil(vol[k] / cap - 1e-9));
    if (sp.trucks !== tr || sp.need !== tr - 1) E.push(`C${k + 1} 레미콘·중단선 수 불일치`);
    let cum = 0; const at = sp.order.map(u => (cum += U[u].vol));
    for (const st of sp.stops) {
      if (!near(st.cum, at[st.step - 1], 1e-9)) E.push('멈출 자리 누적 물량 불일치');
      const left = new Set(sp.order.slice(st.step)), s0 = [...left][0], seen = new Set([s0]), q = [s0];
      while (q.length) { const u = q.pop(); for (const [v] of U[u].nb) if (left.has(v) && !seen.has(v)) { seen.add(v); q.push(v); } }
      if (seen.size !== left.size) E.push('멈출 자리인데 남은 쪽이 갈라짐');
    }
    sp.segments.forEach(sg => {
      const inSeg = sp.stops.filter(p => p.cum > sg.lo + 1e-9 && p.cum <= sg.hi + 1e-9);
      if (!!sg.rep !== inSeg.length > 0) E.push('구간 커버 판정 불일치');
      if (sg.rep) { const dmin = Math.min(...inSeg.map(p => sg.hi - p.cum)); const best = inSeg.filter(p => sg.hi - p.cum <= dmin + tie + 1e-9).sort((a, b) => a.r - b.r || a.len - b.len)[0]; if (best !== sg.rep) E.push('대표 선 선택 불일치'); }
    });
  }
  return [...new Set(E)];
}

// 화면과 같은 순서로 구획: 하한 구역 수 → 결정적 판정으로 가능한 구역 수
function plan(M, P) {
  let N = Math.max(M.Nmin, M.comps.length); if (M.units.some(u => u.vol > P + 1e-9)) return { N, sols: [] };
  let R = C.recommend(M, N, P, 120, 10, 3000);
  if (!R.sols.length) { const f = C.exactFeasible(M, P, N + 1, 8, 1200); if (f.plan) { N = f.plan.n; const r2 = C.recommend(M, N, P, 120, 10, 4000); R = r2.sols.length ? r2 : { sols: [f.plan] }; } }
  return { N, sols: R.sols };
}
module.exports = { checkModel, checkPlan, plan };
