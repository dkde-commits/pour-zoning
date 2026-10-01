// 계산: 규칙 1~6 판정, 최소 타설 단위, 구획 탐색, 비상 중단선(2장), 시공 중 재분할(3장)
// ===== CORE-START : 화면과 무관한 계산 로직 (규칙 1~6) =====
const EPS = 1e-6, TOL = 0.05;

function uniqSorted(arr, e) {
  const a = arr.slice().sort((p, q) => p - q), out = [];
  for (const v of a) if (!out.length || Math.abs(v - out[out.length - 1]) > e) out.push(v);
  return out;
}
function pip(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inRect(x, y, r) { return x > r[0] && x < r[2] && y > r[1] && y < r[3]; }
function normRect(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; }
function mkBeam(o, c, a, b, w, kind) { return { o, c, a, b, w, kind, j: [] }; }

// 규칙 1·2: 보를 가로지르는 위치 pos가 가운데 구간 안이고, 작은보 접합부 ±(배수×폭) 밖인가
function crossOK(beam, pos, r, m) {
  // 규칙 1: 순경간(지지 부재 면 사이) L의 가운데 비율 r 구간 (문서 v2 규칙 1)
  const fa = beam.fa !== undefined ? beam.fa : beam.a, fb = beam.fb !== undefined ? beam.fb : beam.b;
  const L = fb - fa, lo = fa + L * (1 - r) / 2, hi = fb - L * (1 - r) / 2;
  if (pos < lo - EPS || pos > hi + EPS) return { ok: false, why: 'mid' };
  // 규칙 2: 작은보 옆면에서 작은보 폭 × m 떨어진 곳 (KCS 14 20 10 3.6.5(1) '약 2배 거리만큼 떨어진 곳', ACI 318 26.5.6.2(c) 면에서 잼)
  for (const jn of beam.j) if (Math.abs(pos - jn.pos) < jn.w / 2 + m * jn.w - EPS) return { ok: false, why: 'jn' };
  return { ok: true };
}

function analyze(inp) {
  const W = [], E = [];
  // 슬래브는 여러 조각일 수 있다(Revit에서 바닥을 나눠 그린 경우). 조각들의 합집합을 한 바닥으로 본다
  const polys = (inp.slabs && inp.slabs.length ? inp.slabs : [inp.slab])
    .filter(p => Array.isArray(p) && p.length >= 3).map(p => p.map(q => [+q[0], +q[1]]));
  const poly = polys[0];
  if (!poly) { E.push('슬래브 외곽선 꼭짓점을 3개 이상 입력하세요.'); return { E, W }; }
  if (inp.columns.length < 2) {
    E.push(inp.columns.length ? '이 층을 받치는 기둥을 1개밖에 찾지 못했습니다. 보 구조 규칙(보 경간 기준)을 적용할 수 없습니다.'
      : '이 층을 받치는 기둥을 찾지 못했습니다. 벽식 구조처럼 기둥이 없는 층은 보 경간을 기준으로 하는 규칙 1·2를 적용할 수 없습니다. 보 구조 층을 선택하세요.');
    return { E, W };
  }
  const pipAny = (x, y) => polys.some(pg => pip(x, y, pg));
  outer: for (const pg of polys) for (let i = 0; i < pg.length; i++) {
    const p = pg[i], q = pg[(i + 1) % pg.length];
    if (Math.abs(p[0] - q[0]) > TOL && Math.abs(p[1] - q[1]) > TOL) { W.push('슬래브 외곽선에 사선 변이 있어 계단 모양으로 근사했습니다.'); break outer; }
  }
  const r = inp.ratio, m = inp.mult;
  // 구조벽만 반영: 기준보다 얇은 벽(칸막이·건식벽)은 절단 판정에서 제외한다
  const minWallT = inp.minWallT > 0 ? inp.minWallT : 0.2;
  const allWalls = (inp.walls || []).map(normRect);
  const walls = allWalls.filter(w => Math.min(w[2] - w[0], w[3] - w[1]) >= minWallT - 1e-9);
  const openings = (inp.openings || []).map(normRect);
  // 규칙 3 보완: 슬래브 끝을 따라 놓인 외벽은 절단선이 '관통'하는 것이 아니라 거기서 '끝나는' 자리다.
  // 벽의 긴 면 한쪽 바로 바깥이 슬래브 밖이면 외곽벽으로 보고, 절단을 막는 벽에서 뺀다
  const isPerimeterWall = w => {
    const dx = w[2] - w[0], dy = w[3] - w[1], d = 0.15, pts = [];
    for (const t of [0.2, 0.5, 0.8]) {
      if (dx >= dy) { const x = w[0] + dx * t; pts.push([[x, w[1] - d], [x, w[3] + d]]); }
      else { const y = w[1] + dy * t; pts.push([[w[0] - d, y], [w[2] + d, y]]); }
    }
    let out = 0; for (const [p, q] of pts) if (!pipAny(p[0], p[1]) || !pipAny(q[0], q[1])) out++;
    return out >= 2;
  };
  const perimeterWalls = walls.filter(isPerimeterWall);
  const innerWalls = walls.filter(w => !perimeterWalls.includes(w));
  if (allWalls.length - walls.length) W.push(`두께 ${minWallT} m 미만인 벽 ${allWalls.length - walls.length}개는 칸막이벽으로 보고 제외했습니다.`);
  // 기둥 좌표가 조금씩 어긋난 모델에서 그리드선이 수십 개로 쪼개지지 않도록 묶는 허용오차
  const gtol = inp.gridTol > 0 ? inp.gridTol : 0.3;
  const cluster = (vals) => {
    const a = vals.slice().sort((p, q) => p - q), out = [];
    let run = [a[0]];
    for (let i = 1; i < a.length; i++) {
      if (a[i] - run[run.length - 1] <= gtol) run.push(a[i]);
      else { out.push(run.reduce((p, q) => p + q, 0) / run.length); run = [a[i]]; }
    }
    if (run.length) out.push(run.reduce((p, q) => p + q, 0) / run.length);
    return out.map(v => Math.round(v * 1000) / 1000);
  };
  const xs = cluster(inp.columns.map(c => c[0])), ys = cluster(inp.columns.map(c => c[1]));
  const snap = (v, arr) => { let best = v, bd = gtol; for (const a of arr) { const d = Math.abs(a - v); if (d <= bd) { bd = d; best = a; } } return best; };
  const cs = inp.columns.map(c => [snap(c[0], xs), snap(c[1], ys)]);
  const onCol = (x, y) => cs.some(c => Math.abs(c[0] - x) <= gtol && Math.abs(c[1] - y) <= gtol);
  const touchesSlab = (x, y, o) => {
    const d = 0.05;
    return o === 'h' ? (pipAny(x, y + d) || pipAny(x, y - d)) : (pipAny(x + d, y) || pipAny(x - d, y));
  };

  // 입력한 보(모델에서 읽은 보)를 먼저 등록: 양 끝이 기둥이면 큰보, 아니면 작은보
  const beams = [];
  let diag = 0;
  for (const row of inp.beams) {
    const [x1, y1, x2, y2] = row; const w = row[4] > 0 ? row[4] : inp.defW;
    let b;
    if (Math.abs(y1 - y2) <= TOL) b = mkBeam('h', (y1 + y2) / 2, Math.min(x1, x2), Math.max(x1, x2), w, 'B');
    else if (Math.abs(x1 - x2) <= TOL) b = mkBeam('v', (x1 + x2) / 2, Math.min(y1, y2), Math.max(y1, y2), w, 'B');
    else { diag++; continue; }
    const e1 = b.o === 'h' ? [b.a, b.c] : [b.c, b.a], e2 = b.o === 'h' ? [b.b, b.c] : [b.c, b.b];
    b.c = b.o === 'h' ? snap(b.c, ys) : snap(b.c, xs);
    b.a = snap(b.a, b.o === 'h' ? xs : ys); b.b = snap(b.b, b.o === 'h' ? xs : ys);
    if (b.b - b.a < 0.3) continue;
    if (onCol(e1[0], e1[1]) && onCol(e2[0], e2[1])) b.kind = 'G';
    beams.push(b);
  }
  // 모델에 보가 없는 기둥 사이 구간만 큰보를 가정해서 채움 (가정한 개수는 경고로 알림)
  let assumed = 0;
  const covered = (o, c, a0, b0) => beams.some(g => g.o === o && Math.abs(g.c - c) <= gtol && g.a <= a0 + gtol && g.b >= b0 - gtol);
  for (const y of ys) {
    const on = cs.filter(c => c[1] === y).map(c => c[0]).sort((p, q) => p - q);
    for (let i = 0; i < on.length - 1; i++) {
      if (on[i + 1] - on[i] <= TOL || !touchesSlab((on[i] + on[i + 1]) / 2, y, 'h')) continue;
      if (covered('h', y, on[i], on[i + 1])) continue;
      beams.push(mkBeam('h', y, on[i], on[i + 1], 0, 'G')); assumed++;
    }
  }
  for (const x of xs) {
    const on = cs.filter(c => c[0] === x).map(c => c[1]).sort((p, q) => p - q);
    for (let i = 0; i < on.length - 1; i++) {
      if (on[i + 1] - on[i] <= TOL || !touchesSlab(x, (on[i] + on[i + 1]) / 2, 'v')) continue;
      if (covered('v', x, on[i], on[i + 1])) continue;
      beams.push(mkBeam('v', x, on[i], on[i + 1], 0, 'G')); assumed++;
    }
  }
  if (assumed) W.push(`모델에 보가 없는 기둥 사이 구간 ${assumed}곳은 큰보가 있다고 가정했습니다.`);
  if (diag) W.push(`사선 보 ${diag}개는 계산에서 제외했습니다.`);
  // 작은보 끝이 다른 보 중간에 닿는 곳 = 접합점 (규칙 2)
  for (const sb of beams) {
    if (sb.kind !== 'B') continue;
    const ends = sb.o === 'h' ? [[sb.a, sb.c], [sb.b, sb.c]] : [[sb.c, sb.a], [sb.c, sb.b]];
    for (const [px, py] of ends) for (const g of beams) {
      if (g === sb || g.o === sb.o) continue;
      const along = g.o === 'h' ? px : py, perp = g.o === 'h' ? py : px;
      if (Math.abs(perp - g.c) <= TOL && along > g.a + TOL && along < g.b - TOL) g.j.push({ pos: along, w: sb.w });
    }
  }

  // 규칙 1의 순경간: 보 양 끝의 지지 부재(기둥·벽, 작은보는 큰보) 면 위치
  const colHalf = (x, y, o) => {
    let best = null;
    for (const r0 of inp.columns) { if (Math.hypot(r0[0] - x, r0[1] - y) > gtol + 0.05) continue;
      const sx = r0[2] > 0 ? r0[2] : (inp.colSize > 0 ? inp.colSize : 0.6), sy = r0[3] > 0 ? r0[3] : sx;
      const h = (o === 'h' ? sx : sy) / 2; if (best === null || h > best) best = h; }
    return best;
  };
  const supHalf = (b, along) => {
    const x = b.o === 'h' ? along : b.c, y = b.o === 'h' ? b.c : along;
    const ch = colHalf(x, y, b.o); if (ch !== null) return ch;
    for (const g of beams) { if (g === b || g.o === b.o) continue;
      const al = g.o === 'h' ? x : y, pp = g.o === 'h' ? y : x;
      if (Math.abs(pp - g.c) <= TOL + (g.w || inp.defW) / 2 && al >= g.a - TOL && al <= g.b + TOL) return (g.w > 0 ? g.w : inp.defW) / 2; }
    for (const w of walls) if (x >= w[0] - TOL && x <= w[2] + TOL && y >= w[1] - TOL && y <= w[3] + TOL) return (b.o === 'h' ? w[2] - w[0] : w[3] - w[1]) / 2;
    return 0;
  };
  for (const b of beams) {
    const fa = b.a + supHalf(b, b.a), fb = b.b - supHalf(b, b.b);
    if (fb - fa > 0.3) { b.fa = fa; b.fb = fb; }
  }

  // 절단 후보선: 기둥 사이 경간마다 1개, 가로지르는 보들을 가장 많이 만족하는 위치 (규칙 1·2·5)
  // 규칙 1·2: 기둥 사이 가운데 구간에서, 가로지르는 보마다 자를 수 있는 조각을 모두 찾아
  // 조각마다 후보선 하나(조각 가운데)를 둔다. 판정이 같은 연속 구간 = 조각
  function cutCandidates(s0, s1, crossers) {
    const L = s1 - s0, lo = s0 + L * (1 - r) / 2, hi = s1 - L * (1 - r) / 2;
    // 그리드 경간 전체를 훑되, 판정은 실제로 가로지르는 보마다 그 보의 가운데 구간으로 한다.
    // (다른 줄의 기둥 때문에 그리드가 잘게 나뉘어도, 긴 보의 유효 구간을 놓치지 않게)
    // 가로지르는 보가 없는 자리는 이 경간의 가운데 구간 안에서만 허용한다
    const step = Math.max(0.01, Math.min(0.025, L / 240));
    const inThird = p => p >= lo - 1e-9 && p <= hi + 1e-9;
    const sig = p => { let k = '', any = false, n = 0; for (const b of crossers) if (p > b.a + TOL && p < b.b - TOL) { n++; const ok = crossOK(b, p, r, m).ok; k += ok ? '1' : '0'; if (ok) any = true; } return n === 0 ? { k: inThird(p) ? 'T' : 'F', ok: inThird(p) } : { k, ok: any }; };
    const out = []; let run = null;
    const minW = inp.minCut > 0 ? inp.minCut : 0.05;
    const put = v => {
      const snapP = Math.round(v / 0.05) * 0.05;
      const p = (snapP >= run.a - 1e-9 && snapP <= run.b + 1e-9) ? snapP : v;
      const q = Math.round(p * 1000) / 1000;
      if (!out.some(o => Math.abs(o.pos - q) < 0.02)) out.push({ pos: q });
    };
    const flush = () => {
      if (run && run.ok && run.b - run.a >= minW - 1e-9) {
        const w = run.b - run.a;
        // 자를 수 있는 조각이 넓으면 그 안에서 여러 위치를 후보로 둔다 (선택지 확대)
        put((run.a + run.b) / 2); // 문서 v2 1.7: 자를 수 있는 구간(겹치는 범위)의 한가운데 한 줄
      }
      run = null;
    };
    for (let p = s0 + step; p <= s1 - step + 1e-9; p += step) {
      const q = p, g = sig(q);
      if (run && run.k === g.k) run.b = q; else { flush(); run = { a: q, b: q, k: g.k, ok: g.ok }; }
    }
    flush();
    return out;
  }
  const hB = beams.filter(b => b.o === 'h'), vB = beams.filter(b => b.o === 'v');
  const cutX = [], cutY = [];
  for (let i = 0; i < xs.length - 1; i++) cutX.push(...cutCandidates(xs[i], xs[i + 1], hB));
  for (let i = 0; i < ys.length - 1; i++) cutY.push(...cutCandidates(ys[i], ys[i + 1], vB));

  // 셀 격자
  const allPts = polys.flat();
  const bx0 = Math.min(...allPts.map(p => p[0])), bx1 = Math.max(...allPts.map(p => p[0]));
  const by0 = Math.min(...allPts.map(p => p[1])), by1 = Math.max(...allPts.map(p => p[1]));
  // 반드시 정확해야 하는 좌표(그리드·절단 후보·보)와, 근사해도 되는 좌표(외곽선·벽·개구부)를 나눈다
  const keepX = [...xs, ...cutX.map(c => c.pos)], keepY = [...ys, ...cutY.map(c => c.pos)];
  for (const b of beams) { if (b.o === 'v') { keepX.push(b.c); keepY.push(b.a, b.b); } else { keepY.push(b.c); keepX.push(b.a, b.b); } }
  const softX = allPts.map(p => p[0]), softY = allPts.map(p => p[1]);
  for (const rc of [...walls, ...openings]) { softX.push(rc[0], rc[2]); softY.push(rc[1], rc[3]); }
  const inX = v => v >= bx0 - EPS && v <= bx1 + EPS, inY = v => v >= by0 - EPS && v <= by1 + EPS;
  let X, Y, snapG = 0;
  // 곡선 외곽 등으로 좌표가 너무 많으면 근사 좌표만 격자에 맞춰 줄인다 (계산 폭주 방지)
  for (;;) {
    const sn = v => snapG ? Math.round(v / snapG) * snapG : v;
    X = uniqSorted([...keepX, ...softX.map(sn)].filter(inX), 0.005);
    Y = uniqSorted([...keepY, ...softY.map(sn)].filter(inY), 0.005);
    if (X.length * Y.length <= 120000 || snapG >= 1) break;
    snapG = snapG ? snapG * 2 : 0.05;
  }
  if (snapG) W.push(`외곽선·벽 좌표가 너무 촘촘해 ${snapG.toFixed(2)} m 간격으로 근사했습니다.`);
  const nx = X.length - 1, ny = Y.length - 1, idx = (i, j) => j * nx + i;
  const inPoly = new Uint8Array(nx * ny), active = new Uint8Array(nx * ny), blockKind = new Uint8Array(nx * ny); // 1=벽, 2=개구부
  let totalArea = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2, k = idx(i, j);
    if (!pipAny(cx, cy)) continue;
    inPoly[k] = 1;
    if (openings.some(rc => inRect(cx, cy, rc))) { blockKind[k] = 2; continue; }
    // 벽 자리에도 슬래브는 이어져 있다. 잘라내지 않고 "절단 불가" 표시만 한다
    if (innerWalls.some(rc => inRect(cx, cy, rc))) blockKind[k] = 1;
    active[k] = 1; totalArea += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
  }
  // 규칙 4: 받치는 보가 한쪽에만 있는(자유단이 있는) 영역 = 캔틸레버
  const cantMin = inp.cantMin > 0 ? inp.cantMin : 0.6;
  const cantCell = new Uint8Array(nx * ny);
  // 규칙 4: 슬래브가 받침(보·구조벽)의 바깥 면보다 cantMin 넘게 밖으로 나간 부분 = 캔틸레버.
  // 한 줄 안에서도 슬래브가 여러 토막으로 끊길 수 있으므로(ㄷ자·L자 평면) 토막마다 따로 본다.
  // 토막의 끝이 슬래브 밖(자유단)일 때만 캔틸레버를 따진다. 개구부·벽에서 끝나면 받침이 있다고 본다.
  const supH = cy => vB.filter(b => b.a - TOL <= cy && cy <= b.b + TOL).map(b => ({ c: b.c, h: (b.w > 0 ? b.w : inp.defW) / 2 }))
    .concat(walls.filter(w => (w[3] - w[1]) > (w[2] - w[0]) && w[1] - TOL <= cy && cy <= w[3] + TOL).map(w => ({ c: (w[0] + w[2]) / 2, h: (w[2] - w[0]) / 2 })));
  const supV = cx => hB.filter(b => b.a - TOL <= cx && cx <= b.b + TOL).map(b => ({ c: b.c, h: (b.w > 0 ? b.w : inp.defW) / 2 }))
    .concat(walls.filter(w => (w[2] - w[0]) >= (w[3] - w[1]) && w[0] - TOL <= cx && cx <= w[2] + TOL).map(w => ({ c: (w[1] + w[3]) / 2, h: (w[3] - w[1]) / 2 })));
  // 방향별로 두 가지를 기록: flag = 자유단 쪽으로 마지막 받침 바깥면보다 cantMin 넘게 나감, span = 받침 사이에 걸쳐 있음
  // 캔틸레버 = 한 방향으로 나가 있으면서, 다른 방향으로도 받침 사이에 걸쳐 있지 않은 부분
  const flagH = new Uint8Array(nx * ny), spanH = new Uint8Array(nx * ny), flagV = new Uint8Array(nx * ny), spanV = new Uint8Array(nx * ny);
  const markRuns = (n, idxOf, P, sups, flag, span) => {
    let t = 0;
    while (t < n) {
      if (!active[idxOf(t)]) { t++; continue; }
      let e = t; while (e < n && active[idxOf(e)]) e++;
      const s0 = P[t], s1 = P[e];
      const freeLo = t === 0 || !inPoly[idxOf(t - 1)], freeHi = e >= n || !inPoly[idxOf(e)];
      const inRun = sups.filter(o => o.c + o.h > s0 - TOL && o.c - o.h < s1 + TOL);
      if (inRun.length) {
        const hiFace = Math.max(...inRun.map(o => o.c + o.h)), loFace = Math.min(...inRun.map(o => o.c - o.h));
        for (let q = t; q < e; q++) {
          const cc = (P[q] + P[q + 1]) / 2, k = idxOf(q);
          // 받침 사이, 또는 가장 바깥 받침에서 기준 길이(cantMin) 안쪽의 가장자리 띠는 받쳐진 바닥으로 본다
          if (inRun.length >= 2 && cc >= loFace - cantMin - TOL && cc <= hiFace + cantMin + TOL) span[k] = 1;
          if (freeHi && cc > hiFace && s1 - hiFace > cantMin + 1e-6) flag[k] = 1;
          if (freeLo && cc < loFace && loFace - s0 > cantMin + 1e-6) flag[k] = 1;
        }
      }
      t = e;
    }
  };
  for (let j = 0; j < ny; j++) markRuns(nx, i => idx(i, j), X, supH((Y[j] + Y[j + 1]) / 2), flagH, spanH);
  for (let i = 0; i < nx; i++) markRuns(ny, j => idx(i, j), Y, supV((X[i] + X[i + 1]) / 2), flagV, spanV);
  for (let k = 0; k < nx * ny; k++) if ((flagH[k] && !spanV[k]) || (flagV[k] && !spanH[k])) cantCell[k] = 1;
  const isCutX = x => cutX.some(c => Math.abs(c.pos - x) < 0.006), isCutY = y => cutY.some(c => Math.abs(c.pos - y) < 0.006);
  function nodeBad(x, y, dir) {
    for (const b of (dir === 'v' ? hB : vB)) {
      const along = dir === 'v' ? x : y, perp = dir === 'v' ? y : x;
      if (Math.abs(b.c - perp) > TOL) continue;
      if (along > b.a + TOL && along < b.b - TOL) { const q = crossOK(b, along, r, m); if (!q.ok) return q.why; }
    }
    return null;
  }
  // 셀 사이 경계면 → 자를 수 있는가
  const edges = [];
  for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
    const A = idx(i - 1, j), B = idx(i, j), x = X[i];
    if (!inPoly[A] || !inPoly[B]) continue;
    const cand = isCutX(x);
    if (!active[A] || !active[B]) { if (cand) edges.push({ x1: x, y1: Y[j], x2: x, y2: Y[j + 1], A: -1, B: -1, ok: false, why: 'open', cand, len: Y[j + 1] - Y[j] }); continue; }
    let ok = false, why = 'grid';
    if (cand) {
      if (blockKind[A] === 1 || blockKind[B] === 1) why = 'wall';
      else if ((cantCell[A] || cantCell[B]) && !inp.cantExt) why = 'cant';
      else { const w1 = nodeBad(x, Y[j], 'v') || nodeBad(x, Y[j + 1], 'v'); if (w1) why = w1; else { ok = true; why = ''; } }
    }
    edges.push({ x1: x, y1: Y[j], x2: x, y2: Y[j + 1], A, B, ok, why, cand, len: Y[j + 1] - Y[j] });
  }
  for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
    const A = idx(i, j - 1), B = idx(i, j), y = Y[j];
    if (!inPoly[A] || !inPoly[B]) continue;
    const cand = isCutY(y);
    if (!active[A] || !active[B]) { if (cand) edges.push({ x1: X[i], y1: y, x2: X[i + 1], y2: y, A: -1, B: -1, ok: false, why: 'open', cand, len: X[i + 1] - X[i] }); continue; }
    let ok = false, why = 'grid';
    if (cand) {
      if (blockKind[A] === 1 || blockKind[B] === 1) why = 'wall';
      else if ((cantCell[A] || cantCell[B]) && !inp.cantExt) why = 'cant';
      else { const w1 = nodeBad(X[i], y, 'h') || nodeBad(X[i + 1], y, 'h'); if (w1) why = w1; else { ok = true; why = ''; } }
    }
    edges.push({ x1: X[i], y1: y, x2: X[i + 1], y2: y, A, B, ok, why, cand, len: X[i + 1] - X[i] });
  }

  // 자를 수 없는 경계로 붙은 셀 = 최소 타설 단위
  const par = new Int32Array(nx * ny); for (let k = 0; k < par.length; k++) par[k] = k;
  const find = k => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  for (const e of edges) if (e.A >= 0 && !e.ok) { const a = find(e.A), b = find(e.B); if (a !== b) par[a] = b; }
  const unitOf = new Int32Array(nx * ny).fill(-1), rootMap = new Map(), units = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = idx(i, j); if (!active[k]) continue;
    const rt = find(k); let u = rootMap.get(rt);
    if (u === undefined) { u = units.length; rootMap.set(rt, u); units.push({ area: 0, sx: 0, sy: 0, cells: [], nb: new Map() }); }
    unitOf[k] = u;
    const a = (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
    units[u].area += a; units[u].sx += a * (X[i] + X[i + 1]) / 2; units[u].sy += a * (Y[j] + Y[j + 1]) / 2; units[u].cells.push(k);
  }
  if (!units.length) { E.push('슬래브 안에 계산할 영역이 없습니다. 외곽선 좌표를 확인하세요.'); return { E, W }; }
  const C = inp.C > 0 ? inp.C : totalArea * inp.t;
  // 물량 = 슬래브(칸 면적 비례) + 슬래브 아래 보(보가 실제로 놓인 칸에 배분). 보 깊이가 없으면 면적 비례로만
  const beamRows = (inp.beams || []).filter(r0 => r0[5] > 0);
  let cellBeam = null, beamTot = 0;
  if (beamRows.length) {
    cellBeam = new Float64Array(nx * ny);
    for (const r0 of beamRows) {
      const [x1, y1, x2, y2, w0, d0] = r0, w = w0 > 0 ? w0 : inp.defW, hor = Math.abs(y1 - y2) <= TOL;
      const bx0 = hor ? Math.min(x1, x2) : x1 - w / 2, bx1 = hor ? Math.max(x1, x2) : x1 + w / 2;
      const by0 = hor ? y1 - w / 2 : Math.min(y1, y2), by1 = hor ? y1 + w / 2 : Math.max(y1, y2);
      // 보가 걸친 칸에 겹친 면적만큼 넣고, 슬래브 밖·개구부로 빠진 부분은 걸친 칸에 비례해 채워 총량을 보존한다
      const hits = []; let got = 0;
      for (let j = 0; j < ny; j++) { const oy = Math.min(by1, Y[j + 1]) - Math.max(by0, Y[j]); if (oy <= 0) continue;
        for (let i = 0; i < nx; i++) { const k = idx(i, j); if (!active[k]) continue; const ox = Math.min(bx1, X[i + 1]) - Math.max(bx0, X[i]); if (ox <= 0) continue;
          hits.push([k, ox * oy * d0]); got += ox * oy * d0; } }
      const want = r0[6] > 0 ? r0[6] : (bx1 - bx0) * (by1 - by0) * d0; // 모델에서 읽은 실제 보 물량이 있으면 그것을
      if (got > 1e-12) { const f = want / got; for (const [k, v] of hits) { cellBeam[k] += v * f; } beamTot += want; }
      else { // 슬래브 칸과 전혀 겹치지 않으면 가장 가까운 칸에
        const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2; let bk = -1, bd = Infinity;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = idx(i, j); if (!active[k]) continue; const d = Math.hypot((X[i] + X[i + 1]) / 2 - mx, (Y[j] + Y[j + 1]) / 2 - my); if (d < bd) { bd = d; bk = k; } }
        if (bk >= 0) { cellBeam[bk] += want; beamTot += want; } }
    }
  }
  const Cslab = cellBeam ? (inp.Cslab > 0 ? inp.Cslab : Math.max(0, C - beamTot)) : C;
  for (const u of units) {
    u.cx = u.sx / u.area; u.cy = u.sy / u.area; u.vol = u.area / totalArea * Cslab;
    if (cellBeam) for (const k of u.cells) u.vol += cellBeam[k];
  }
  // 칸마다 물량(시공 기록의 조각 물량에 쓴다)
  const cellVol = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = idx(i, j); if (active[k]) cellVol[k] = (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]) / totalArea * Cslab + (cellBeam ? cellBeam[k] : 0); }
  const Ctot = units.reduce((a, u) => a + u.vol, 0);
  const lineKeyOf = e => (Math.abs(e.x1 - e.x2) < 1e-9 ? 'x' + e.x1.toFixed(3) : 'y' + e.y1.toFixed(3));
  const lineId = new Map();
  for (const u of units) u.nbl = new Map();
  for (const e of edges) {
    if (e.A < 0 || !e.ok) continue;
    const a = unitOf[e.A], b = unitOf[e.B]; if (a === b) continue;
    units[a].nb.set(b, (units[a].nb.get(b) || 0) + e.len); units[b].nb.set(a, (units[b].nb.get(a) || 0) + e.len);
    const k = lineKeyOf(e);
    if (!lineId.has(k)) lineId.set(k, lineId.size);
    const id = lineId.get(k);
    if (!units[a].nbl.has(b)) units[a].nbl.set(b, new Set());
    if (!units[b].nbl.has(a)) units[b].nbl.set(a, new Set());
    units[a].nbl.get(b).add(id); units[b].nbl.get(a).add(id);
  }
  const lines = Array.from(lineId.keys());
  // 서로 이어지지 않은 덩어리(벽 등으로 완전히 분리)
  const comp = new Int32Array(units.length).fill(-1), comps = [];
  for (let s = 0; s < units.length; s++) {
    if (comp[s] >= 0) continue;
    const list = [s]; comp[s] = comps.length;
    for (let q = 0; q < list.length; q++) for (const [v] of units[list[q]].nb) if (comp[v] < 0) { comp[v] = comps.length; list.push(v); }
    comps.push(list);
  }
  // 본 바닥과 떨어진 작은 바닥(가장 큰 덩어리의 25% 미만)은 가장 가까운 본 바닥 조각과 '같은 날' 묶는다.
  // 서로 맞닿지 않으므로 이음은 생기지 않고, 규칙 6(한 구역 연결)은 '연속 타설 면'에 대한 것이라 따로 치는 작은 판에는 해당하지 않는다.
  const linked = [];
  if (inp.linkDetached && comps.length > 1) {
    const cvol = comps.map(c => c.reduce((a, u) => a + units[u].vol, 0));
    // 묶는 기준은 하루 한도와 무관하게 '가장 큰 덩어리의 25% 미만'으로 둔다 (한도를 바꿔도 전제가 흔들리지 않게)
    const limit = 0.25 * Math.max(...cvol);
    const bigIdx = cvol.map((v, i) => i).filter(i => cvol[i] >= limit);
    if (!bigIdx.length) bigIdx.push(cvol.indexOf(Math.max(...cvol)));
    const bigUnits = bigIdx.flatMap(i => comps[i]);
    comps.forEach((c, i) => {
      if (bigIdx.includes(i)) return;
      let best = null;
      for (const a of c) for (const b of bigUnits) {
        const d = Math.hypot(units[a].cx - units[b].cx, units[a].cy - units[b].cy);
        if (!best || d < best.d) best = { a, b, d };
      }
      units[best.a].nb.set(best.b, 0); units[best.b].nb.set(best.a, 0);
      units[best.a].nbl.set(best.b, new Set()); units[best.b].nbl.set(best.a, new Set());
      linked.push({ units: c.slice(), to: best.b, vol: cvol[i] });
    });
    if (linked.length) {
      // 연결 후 덩어리 다시 계산
      comp.fill(-1); comps.length = 0;
      for (let s0 = 0; s0 < units.length; s0++) {
        if (comp[s0] >= 0) continue;
        const list = [s0]; comp[s0] = comps.length;
        for (let q = 0; q < list.length; q++) for (const [v] of units[list[q]].nb) if (comp[v] < 0) { comp[v] = comps.length; list.push(v); }
        comps.push(list);
      }
      W.push(`본 바닥과 떨어진 작은 바닥 ${linked.length}곳(합계 ${linked.reduce((a, x) => a + x.vol, 0).toFixed(1)} ㎥)은 가장 가까운 구역과 같은 날 치도록 묶었습니다.`);
    }
  }
  const ppar = new Int32Array(nx * ny); for (let k = 0; k < ppar.length; k++) ppar[k] = k;
  const pfind = k => { while (ppar[k] !== k) { ppar[k] = ppar[ppar[k]]; k = ppar[k]; } return k; };
  for (const e of edges) if (e.A >= 0 && !e.cand && blockKind[e.A] === blockKind[e.B]) { const a = pfind(e.A), b = pfind(e.B); if (a !== b) ppar[a] = b; }
  const pieceOf = new Int32Array(nx * ny).fill(-1), pmap = new Map(), pieces = [];
  for (let k = 0; k < nx * ny; k++) { if (!active[k]) continue; const r0 = pfind(k); let p = pmap.get(r0);
    if (p === undefined) { p = pieces.length; pmap.set(r0, p); pieces.push({ cells: [], vol: 0, unit: unitOf[k] }); }
    pieceOf[k] = p; pieces[p].cells.push(k); pieces[p].vol += cellVol[k]; }
  const why = { mid: 0, jn: 0, cant: 0, wall: 0, open: 0 }; let okN = 0, ngN = 0;
  for (const e of edges) if (e.cand) { if (e.ok) okN++; else { ngN++; if (why[e.why] !== undefined) why[e.why]++; } }
  const maxUnit = units.reduce((a, u, i) => u.vol > units[a].vol ? i : a, 0);
  // 조각마다 모서리 꼭짓점 목록 (꺾임 검사용)
  for (const u of units) {
    const set = new Set();
    for (const k of u.cells) { const i = k % nx, j = (k - i) / nx; set.add(j * (nx + 1) + i); set.add(j * (nx + 1) + i + 1); set.add((j + 1) * (nx + 1) + i); set.add((j + 1) * (nx + 1) + i + 1); }
    u.nodes = Array.from(set);
  }
  const onBeam = (x, y) => beams.some(b => b.o === 'h'
    ? Math.abs(b.c - y) <= TOL && x >= b.a - TOL && x <= b.b + TOL
    : Math.abs(b.c - x) <= TOL && y >= b.a - TOL && y <= b.b + TOL);
  return {
    E, W, poly, polys, xs, ys, cs, beams, gtol, lines, cutX, cutY, X, Y, nx, ny, inPoly, active, blockKind, cantCell, edges, unitOf, units, comps, linked,
    totalArea, C: Ctot, Cslab, beamTot, cellVol, pieceOf, pieces, Cgiven: inp.C > 0, Nmin: Math.max(Math.ceil(Ctot / inp.P - 1e-9), units.filter(u => u.vol > inp.P / 2 + 1e-9).length), maxUnit, onBeam,
    stats: { okN, ngN, why }, walls, openings, P: inp.P
  };
}

// ----- 구역 배정: 씨앗 확장 (규칙 6) -----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function pickSeeds(M, N, rnd) {
  const U = M.units; if (M.comps.length > N) return null;
  const seeds = [];
  for (const c of M.comps) seeds.push(c[Math.floor(rnd() * c.length)]);
  while (seeds.length < N) {
    let best = -1, bs = -1;
    for (let u = 0; u < U.length; u++) {
      if (seeds.includes(u)) continue;
      let d = Infinity; for (const s of seeds) d = Math.min(d, Math.hypot(U[u].cx - U[s].cx, U[u].cy - U[s].cy));
      const sc = d * (0.55 + 0.45 * rnd());
      if (sc > bs) { bs = sc; best = u; }
    }
    if (best < 0) return null;
    seeds.push(best);
  }
  return seeds;
}

function grow(U, seeds, P) {
  const z = new Int32Array(U.length).fill(-1);
  const Z = seeds.map((s, k) => { z[s] = k; return { vol: U[s].vol, ax: U[s].cx * U[s].area, ay: U[s].cy * U[s].area, ar: U[s].area, list: [s] }; });
  let left = U.length - seeds.length;
  while (left > 0) {
    const order = Z.map((_, k) => k).sort((a, b) => Z[a].vol - Z[b].vol);
    let pick = -1, pz = -1;
    for (const k of order) {
      const zk = Z[k], gx = zk.ax / zk.ar, gy = zk.ay / zk.ar, cand = new Map();
      for (const u of zk.list) for (const [v, len] of U[u].nb) {
        if (z[v] !== -1 || zk.vol + U[v].vol > P + 1e-9) continue;
        cand.set(v, (cand.get(v) || 0) + len);
      }
      let best = Infinity;
      for (const [v, len] of cand) { const s = Math.hypot(U[v].cx - gx, U[v].cy - gy) - 0.5 * len; if (s < best) { best = s; pick = v; } }
      if (pick >= 0) { pz = k; break; }
    }
    if (pick < 0) return null;
    z[pick] = pz; const zk = Z[pz], u = U[pick];
    zk.vol += u.vol; zk.ax += u.cx * u.area; zk.ay += u.cy * u.area; zk.ar += u.area; zk.list.push(pick); left--;
  }
  return z;
}

function stillConnected(U, z, A, skip) {
  let start = -1, total = 0;
  for (let u = 0; u < U.length; u++) if (z[u] === A && u !== skip) { total++; if (start < 0) start = u; }
  if (start < 0) return false;
  const seen = new Set([start]), st = [start];
  while (st.length) { const u = st.pop(); for (const [v] of U[u].nb) if (v !== skip && z[v] === A && !seen.has(v)) { seen.add(v); st.push(v); } }
  return seen.size === total;
}

function improve(U, z, N, P, T, guard) {
  const vol = new Float64Array(N), cnt = new Int32Array(N);
  U.forEach((u, i) => { vol[z[i]] += u.vol; cnt[z[i]]++; });
  for (let pass = 0; pass < 300; pass++) {
    let moved = false;
    for (let u = 0; u < U.length && !moved; u++) {
      const A = z[u]; if (cnt[A] <= 1) continue;
      for (const [v] of U[u].nb) {
        const B = z[v]; if (B === A) continue;
        const vu = U[u].vol; if (vol[B] + vu > P + 1e-9) continue;
        const before = (vol[A] - T) ** 2 + (vol[B] - T) ** 2, after = (vol[A] - vu - T) ** 2 + (vol[B] + vu - T) ** 2;
        if (after < before - 1e-9 && (!guard || guard(u, B)) && stillConnected(U, z, A, u)) { z[u] = B; vol[A] -= vu; vol[B] += vu; cnt[A]--; cnt[B]++; moved = true; break; }
      }
    }
    if (!moved) break;
  }
}


// 가장 큰 구역의 가장자리 조각을 이웃 구역으로 넘겨 최대 물량을 낮춤 (하루 한도 맞추기)
function shaveMax(U, z, N) {
  const vol = new Float64Array(N), cnt = new Int32Array(N);
  U.forEach((u, i) => { vol[z[i]] += u.vol; cnt[z[i]]++; });
  for (let it = 0; it < 400; it++) {
    let A = 0; for (let k = 1; k < N; k++) if (vol[k] > vol[A]) A = k;
    if (cnt[A] <= 1) break;
    let best = null;
    for (let u = 0; u < U.length; u++) {
      if (z[u] !== A) continue;
      const vu = U[u].vol;
      for (const [v] of U[u].nb) {
        const B = z[v]; if (B === A) continue;
        const newMax = Math.max(vol[A] - vu, vol[B] + vu);
        if (newMax < vol[A] - 1e-9 && (!best || newMax < best.m - 1e-9)) best = { u, B, m: newMax };
      }
    }
    if (!best) break;
    // 연결 유지 확인 (안 되면 다음 후보를 찾기 위해 그 조각을 제외하고 재시도)
    if (!stillConnected(U, z, A, best.u)) {
      let ok = false;
      const cands = [];
      for (let u = 0; u < U.length; u++) if (z[u] === A) for (const [v] of U[u].nb) { const B = z[v]; if (B !== A) { const m = Math.max(vol[A] - U[u].vol, vol[B] + U[u].vol); if (m < vol[A] - 1e-9) cands.push({ u, B, m }); } }
      cands.sort((a, b) => a.m - b.m);
      for (const c of cands) if (stillConnected(U, z, A, c.u)) { best = c; ok = true; break; }
      if (!ok) break;
    }
    const vu = U[best.u].vol;
    z[best.u] = best.B; vol[A] -= vu; vol[best.B] += vu; cnt[A]--; cnt[best.B]++;
  }
}


function maxOf(U, z, N) { const v = new Float64Array(N); U.forEach((u, i) => { v[z[i]] += u.vol; }); return Math.max(...v); }
function improveCapped(U, z, N, P, T) { improve(U, z, N, P, T); }
// 한도 초과가 남으면: 무작위 이동을 조금씩 허용하며(담금질) 한도 안으로 끌어들임
function anneal(U, z, N, P, T, rnd) {
  const vol = new Float64Array(N), cnt = new Int32Array(N);
  U.forEach((u, i) => { vol[z[i]] += u.vol; cnt[z[i]]++; });
  const c1 = v => 8 * Math.max(0, v - P) / T + ((v - T) / T) ** 2;
  const iters = Math.min(20000, 60 * U.length);
  let temp = 0.3;
  const cool = Math.pow(0.002 / temp, 1 / iters);
  for (let it = 0; it < iters; it++, temp *= cool) {
    const u = Math.floor(rnd() * U.length), A = z[u];
    if (cnt[A] <= 1) continue;
    const nbs = []; for (const [v] of U[u].nb) if (z[v] !== A && !nbs.includes(z[v])) nbs.push(z[v]);
    if (!nbs.length) continue;
    const B = nbs[Math.floor(rnd() * nbs.length)], vu = U[u].vol;
    const d = c1(vol[A] - vu) + c1(vol[B] + vu) - c1(vol[A]) - c1(vol[B]);
    if (d > 0 && rnd() >= Math.exp(-d / temp)) continue;
    if (!stillConnected(U, z, A, u)) continue;
    z[u] = B; vol[A] -= vu; vol[B] += vu; cnt[A]--; cnt[B]++;
    if (Math.max(...vol) <= P + 1e-6 && temp < 0.02) break;
  }
}


// 규칙 3: 한 꼭짓점에서 경계가 꺾였는데 그 점이 보·기둥 위가 아니면 위반
function bendAtNode(M, z, nid) {
  const { nx, ny, active, unitOf, blockKind } = M, i = nid % (nx + 1), j = (nid - i) / (nx + 1);
  if (i < 1 || j < 1 || i >= nx || j >= ny) return 0;
  // 벽은 스톱엔드를 받쳐 주므로 지지부로 보고 검사 제외. 개구부·슬래브 밖은 지지부가 아니므로 검사한다
  const zc = (a, b) => { const k = b * nx + a; return active[k] ? z[unitOf[k]] : (blockKind[k] === 1 ? -3 : -2); };
  const sw = zc(i - 1, j - 1), se = zc(i, j - 1), nw = zc(i - 1, j), ne = zc(i, j);
  if (sw === -3 || se === -3 || nw === -3 || ne === -3) return 0;
  const cut = (p, q) => (p >= 0 && q >= 0 && p !== q);
  const n = cut(nw, ne), s = cut(sw, se), w = cut(sw, nw), e = cut(se, ne);
  return (n + s + w + e === 2 && !(n && s) && !(w && e) && !M.onBeam(M.X[i], M.Y[j])) ? 1 : 0;
}
function bendDelta(M, z, u, B) {
  const A = z[u]; let before = 0, after = 0;
  for (const nd of M.units[u].nodes) before += bendAtNode(M, z, nd);
  z[u] = B; for (const nd of M.units[u].nodes) after += bendAtNode(M, z, nd); z[u] = A;
  return after - before;
}
function repairBends(M, z, N, P, rnd) {
  const U = M.units, vol = new Float64Array(N), cnt = new Int32Array(N);
  U.forEach((u, i) => { vol[z[i]] += u.vol; cnt[z[i]]++; });
  const { nx, ny } = M;
  for (let it = 0; it < 300; it++) {
    const bad = [];
    for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) { const nd = j * (nx + 1) + i; if (bendAtNode(M, z, nd)) bad.push([i, j]); }
    if (!bad.length) return true;
    for (let q = bad.length - 1; q > 0; q--) { const w = Math.floor(rnd() * (q + 1)); [bad[q], bad[w]] = [bad[w], bad[q]]; }
    let moved = false;
    for (const [i, j] of bad) {
      const us = new Set();
      for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) { const k = b * nx + a; if (M.active[k]) us.add(M.unitOf[k]); }
      for (const u of us) {
        const A = z[u]; if (cnt[A] <= 1) continue;
        for (const [v] of U[u].nb) {
          const B = z[v]; if (B === A || vol[B] + U[u].vol > P + 1e-9) continue;
          if (bendDelta(M, z, u, B) < 0 && stillConnected(U, z, A, u)) { z[u] = B; vol[A] -= U[u].vol; vol[B] += U[u].vol; cnt[A]--; cnt[B]++; moved = true; break; }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) return false;
  }
  return false;
}

// 규칙 3 점검: 슬래브 한가운데(보 위가 아닌 곳)에서 꺾인 지점
function computeBends(M, z) {
  // 보정 단계(repairBends)와 똑같은 판정을 쓴다. 개구부 모서리 옆의 꺾임도 잡는다
  const { X, Y, nx, ny } = M, pts = [];
  for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) if (bendAtNode(M, z, j * (nx + 1) + i)) pts.push([X[i], Y[j]]);
  return pts;
}

function evaluate(M, z, N, T) {
  const vol = Array(N).fill(0), area = Array(N).fill(0), joint = Array(N).fill(0);
  M.units.forEach((u, i) => { vol[z[i]] += u.vol; area[z[i]] += u.area; });
  let total = 0;
  for (const e of M.edges) {
    if (e.A < 0) continue;
    const a = z[M.unitOf[e.A]], b = z[M.unitOf[e.B]];
    if (a !== b) { total += e.len; joint[a] += e.len; joint[b] += e.len; }
  }
  const bends = computeBends(M, z);
  const maxDev = Math.max(...vol.map(v => Math.abs(v - T))) / T;
  const score = maxDev + 0.01 * total / Math.sqrt(M.totalArea);
  return { vol, area, joint, total, bends, maxDev, score, maxVol: Math.max(...vol), minVol: Math.min(...vol) };
}


// 이어진 바닥을 잘라 너무 작은 구역(평균의 10% 미만 또는 1㎥ 미만)을 만든 안인지.
// 본 바닥과 떨어진 조각(출입구 바닥 등) 하나로 된 구역은 규칙 6상 따로 칠 수밖에 없으므로 작아도 허용한다.
function hasTinyCut(M, z, vol, T) {
  const lim = Math.max(1, 0.1 * T);
  if (Math.min(...vol) >= lim) return false;
  if (!M._compOf) { M._compOf = new Int32Array(M.units.length); M.comps.forEach((c, i) => { for (const u of c) M._compOf[u] = i; }); }
  for (let k = 0; k < vol.length; k++) {
    if (vol[k] >= lim) continue;
    const comps = new Set(); let n = 0;
    for (let u = 0; u < z.length; u++) if (z[u] === k) { comps.add(M._compOf[u]); n++; }
    const whole = comps.size === 1 && M.comps[[...comps][0]].length === n;
    if (!whole) return true;
  }
  return false;
}

function solve(M, N, P, restarts, seed, deadline) {
  const rnd = mulberry32(seed || 20261010), T = M.C / N, raw = []; let overP = 0, bentN = 0, tinyN = 0;
  const stop = deadline || (Date.now() + 4000);
  // (a) 절단선 조합에서 바로 만든 배정
  // 결정적 이등분 탐색 — 가능한 안이 있으면 반드시 하나 이상 넣는다
  // 불가능한 조건에서 예산을 다 쓰지 않도록 남은 시간의 20%만 (세 가지 순서에 나눠)
  const exStop = Date.now() + Math.max(150, (stop - Date.now()) * 0.2);
  for (const ord of [0, 1, 2]) {
    if (Date.now() > exStop) break;
    const r = gExact(M, N, P, Math.min(exStop, Date.now() + Math.max(50, (exStop - Date.now()) / (3 - ord))), null, ord); if (!r.z) continue;
    const ev = evaluate(M, r.z, N, T); if (ev.maxVol <= P + 1e-6 && !ev.bends.length && !hasTinyCut(M, r.z, ev.vol, T)) raw.push({ z: Array.from(r.z), ...ev });
  }
  // (문서 v2 1.9) 씨앗 확장 — 네 방향 시도
  // 큰 모델에서는 걸어간 거리 계산이 무거워 시간 예산 안에서만 시도
  if (M.units.length * N <= 8000) for (const p of docPlans(M, N, P)) { if (!hasTinyCut(M, p.z, p.vol, T)) raw.push(p); }
  // (0) 재귀 이등분: 꺾임 없는 안을 빠르게 만든다 (남은 시간의 40%까지)
  const gStop = Math.min(stop, Date.now() + Math.max(400, (stop - Date.now()) * 0.4));
  for (const z of guillotine(M, N, P, rnd, 400, gStop)) {
    const ev = evaluate(M, z, N, T);
    if (ev.maxVol > P + 1e-6) { overP++; continue; }
    if (ev.bends.length) { bentN++; continue; }
    if (hasTinyCut(M, z, ev.vol, T)) { tinyN++; continue; }
    raw.push({ z: Array.from(z), ...ev });
  }
  // 이등분 단계에서 충분히 모였으면 나머지 단계는 생략한다
  const enough = raw.length >= 30;
  const lineStop = enough ? Date.now() : Math.min(stop, Date.now() + Math.max(500, (stop - Date.now()) * 0.6));
  for (const z of lineCandidates(M, N, P, rnd, 120, lineStop)) {
    const ev = evaluate(M, z, N, T);
    if (ev.maxVol > P + 1e-6) { overP++; continue; }
    if (ev.bends.length) { bentN++; continue; }
    if (hasTinyCut(M, z, ev.vol, T)) { tinyN++; continue; }
    raw.push({ z: Array.from(z), ...ev });
  }
  // (b) 씨앗 확장 + 보정 — 선 조합으로 이미 충분하면 적게, 큰 모델이면 횟수를 줄인다
  const budget = enough ? 0 : raw.length >= 12 ? Math.min(restarts, 20) : Math.max(15, Math.min(restarts, Math.round(6000 / Math.max(10, M.units.length))));
  for (let r = 0; r < budget; r++) {
    if (Date.now() > stop) break;
    const seeds = pickSeeds(M, N, rnd); if (!seeds) break;
    const z = grow(M.units, seeds, Infinity); if (!z) continue;
    improve(M.units, z, N, Infinity, T);
    shaveMax(M.units, z, N);
    improve(M.units, z, N, Infinity, T);
    shaveMax(M.units, z, N);
    if (maxOf(M.units, z, N) > P + 1e-6) anneal(M.units, z, N, P, T, rnd);
    if (maxOf(M.units, z, N) > P + 1e-6) { overP++; continue; }
    // 규칙 3(꺾임은 보·기둥 위) 맞추기 → 꺾임을 늘리지 않는 범위에서 다시 물량 균형
    repairBends(M, z, N, P, rnd);
    improve(M.units, z, N, P, T, (u, B) => bendDelta(M, z, u, B) <= 0);
    const ev = evaluate(M, z, N, T);
    if (ev.maxVol > P + 1e-6) { overP++; continue; }
    if (ev.bends.length) { bentN++; continue; }
    if (hasTinyCut(M, z, ev.vol, T)) { tinyN++; continue; } // 규칙 3 위반 → 후보에서 제외
    raw.push({ z: Array.from(z), ...ev });
  }
  // 구역 번호만 다른 같은 배정 제거 → 점수순
  const seen = new Set(), uniq = [];
  for (const s of raw) {
    const map = new Map();
    const key = s.z.map(k => { if (!map.has(k)) map.set(k, map.size); return map.get(k); }).join(',');
    if (!seen.has(key)) { seen.add(key); s.N = N; s.T = T; uniq.push(s); }
  }
  uniq.sort((a, b) => a.score - b.score);
  return { sols: uniq, tried: restarts, found: raw.length, overP, bentN, tinyN, T };
}


// 절단선을 먼저 고르고 그 선으로만 나눠지는 덩어리(블록)를 만든다.
// 규칙 3을 지키는 배정은 대부분 "선을 통째로 긋는" 형태라, 이 방식이 훨씬 잘 찾는다
function blocksFromLines(M, S) {
  const U = M.units, n = U.length, par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = k => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  for (let u = 0; u < n; u++) for (const [v, ids] of U[u].nbl) {
    let allCut = true;
    for (const id of ids) if (!S.has(id)) { allCut = false; break; }
    if (!allCut) { const a = find(u), b = find(v); if (a !== b) par[a] = b; }
  }
  const map = new Map(), blockOf = new Int32Array(n), blocks = [];
  for (let u = 0; u < n; u++) {
    const rt = find(u);
    if (!map.has(rt)) { map.set(rt, blocks.length); blocks.push({ area: 0, vol: 0, sx: 0, sy: 0, members: [], nb: new Map() }); }
    const bi = map.get(rt); blockOf[u] = bi;
    const B = blocks[bi]; B.area += U[u].area; B.vol += U[u].vol; B.sx += U[u].cx * U[u].area; B.sy += U[u].cy * U[u].area; B.members.push(u);
  }
  for (const B of blocks) { B.cx = B.sx / B.area; B.cy = B.sy / B.area; }
  for (let u = 0; u < n; u++) for (const [v, len] of U[u].nb) {
    const a = blockOf[u], b = blockOf[v]; if (a === b) continue;
    blocks[a].nb.set(b, (blocks[a].nb.get(b) || 0) + len);
  }
  return { blocks, blockOf };
}

// 재귀 이등분(길로틴) 생성기: 영역을 곧은 절단선 하나로 끝까지 갈라 두 영역으로 나누고, 각 영역을 다시 가른다.
// 새 선은 항상 기존 경계에 닿아 끝나므로(T자) 슬래브 한가운데서 꺾이는 경계가 생기지 않는다(규칙 3을 구조적으로 만족).
function guillotine(M, N, P, rnd, tries, stop, compsIn) {
  const COMPS = compsIn || M.comps;
  const U = M.units, out = [], seenKey = new Set();
  const volOf = reg => { let v = 0; for (const u of reg) v += U[u].vol; return v; };
  const comps = (reg, set, line) => {
    const lab = new Map(); let c = 0;
    for (const s0 of reg) {
      if (lab.has(s0)) continue;
      lab.set(s0, c); const st = [s0];
      while (st.length) { const u = st.pop(); for (const [v, ids] of U[u].nbl) { if (!set.has(v) || lab.has(v) || ids.has(line)) continue; lab.set(v, c); st.push(v); } }
      c++;
      if (c > 2) break;
    }
    return { c, lab };
  };
  function rec(reg, n, z, next, depth) {
    const vol = volOf(reg);
    if (n === 1) { if (vol > P + 1e-6) return -1; for (const u of reg) z[u] = next; return next + 1; }
    if (vol > n * P + 1e-6 || reg.length < n) return -1;
    const set = new Set(reg), lines = new Set();
    for (const u of reg) for (const [v, ids] of U[u].nbl) if (set.has(v)) for (const id of ids) lines.add(id);
    const opts = [];
    for (const line of lines) {
      const { c, lab } = comps(reg, set, line); if (c !== 2) continue;
      const A = [], B = []; for (const u of reg) (lab.get(u) === 0 ? A : B).push(u);
      const vA = volOf(A), vB = vol - vA;
      const base = Math.round(n * vA / vol);
      for (const nA of new Set([base, base - 1, base + 1])) {
        if (nA < 1 || nA > n - 1) continue;
        const nB = n - nA;
        if (vA > nA * P + 1e-6 || vB > nB * P + 1e-6 || A.length < nA || B.length < nB) continue;
        opts.push({ A, B, nA, nB, sc: Math.abs(vA / nA - vB / nB) / (vol / n) });
      }
    }
    if (!opts.length) return -1;
    opts.sort((a, b) => a.sc - b.sc);
    const top = Math.min(opts.length, 5);
    const order = []; for (let i = 0; i < top; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) { if (rnd() < 0.6) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    for (const oi of order.slice(0, 3)) {
      if (stop && Date.now() > stop) return -1;
      const o = opts[oi], snap = Array.from(z);
      const k = rec(o.A, o.nA, z, next, depth + 1);
      if (k >= 0) { const k2 = rec(o.B, o.nB, z, k, depth + 1); if (k2 >= 0) return k2; }
      for (let i = 0; i < z.length; i++) z[i] = snap[i];
    }
    return -1;
  }
  for (let t = 0; t < tries && out.length < 60; t++) {
    if (stop && Date.now() > stop) break;
    for (const comp of COMPS) {
      // 떨어진 덩어리가 여러 개면 물량 비례로 구역 수를 나눠 준다
      if (COMPS.length > 1) break;
    }
    const z = new Array(U.length).fill(-1);
    let ok = true, next = 0;
    if (COMPS.length === 1) { next = rec(COMPS[0].slice(), N, z, 0, 0); ok = next === N; }
    else {
      const tot = M.C; let left = N; const cs = COMPS.slice().sort((a, b) => volOf(b) - volOf(a));
      for (let i = 0; i < cs.length && ok; i++) {
        const n = i === cs.length - 1 ? left : Math.max(1, Math.min(left - (cs.length - 1 - i), Math.round(N * volOf(cs[i]) / tot)));
        const k = rec(cs[i].slice(), n, z, next, 0); if (k < 0) ok = false; else { next = k; left -= n; }
      }
      ok = ok && next === N;
    }
    if (!ok || COMPS.some(cc => cc.some(u => z[u] < 0))) continue;
    const key = z.join(',');
    if (seenKey.has(key)) continue; seenKey.add(key); out.push(z);
  }
  return out;
}

function lineCandidates(M, N, P, rnd, limit, stop) {
  const L = M.lines.length, out = [], seen = new Set();
  if (!L) return out;
  const tryS = (arr) => {
    if (out.length >= limit || (stop && Date.now() > stop)) return;
    const key = arr.slice().sort((p, q) => p - q).join(',');
    if (seen.has(key)) return; seen.add(key);
    const S = new Set(arr), { blocks, blockOf } = blocksFromLines(M, S);
    if (blocks.length < N || blocks.length > Math.max(N + 6, 3 * N)) return;
    const zs = [];
    if (blocks.length === N) zs.push(Array.from(blockOf));
    else {
      // 블록이 남으면 여러 번(다른 시작점) 묶어 서로 다른 안을 만든다
      for (let t = 0; t < 4; t++) {
        const seeds = pickSeedsG(blocks, N, rnd); if (!seeds) continue;
        const bz = grow(blocks, seeds); if (!bz) continue;
        improve(blocks, bz, N, P, M.C / N);
        zs.push(Array.from(blockOf, q => bz[q]));
      }
    }
    for (const z of zs) {
      const vol = new Float64Array(N); M.units.forEach((u, i) => { vol[z[i]] += u.vol; });
      if (Math.max(...vol) > P + 1e-6 || Math.min(...vol) <= 0) continue;
      out.push(z);
      if (out.length >= limit) return;
    }
  };
  // 선 1~2개 조합은 전부, 그 이상은 무작위 표본
  for (let i = 0; i < L; i++) tryS([i]);
  for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) tryS([i, j]);
  const kMin = Math.max(1, Math.min(L, Math.floor(2 * Math.sqrt(N)) - 2)), kMax = Math.min(L, N + 4);
  for (let t = 0; t < limit * 80 && out.length < limit; t++) {
    if (stop && Date.now() > stop) break;
    const k = kMin + Math.floor(rnd() * (kMax - kMin + 1));
    const pool = []; for (let i = 0; i < L; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) { const q = Math.floor(rnd() * (i + 1)); [pool[i], pool[q]] = [pool[q], pool[i]]; }
    tryS(pool.slice(0, k));
  }
  return out;
}
function pickSeedsG(items, N, rnd) {
  if (items.length < N) return null;
  const seeds = [Math.floor(rnd() * items.length)];
  while (seeds.length < N) {
    let best = -1, bs = -1;
    for (let u = 0; u < items.length; u++) {
      if (seeds.includes(u)) continue;
      let d = Infinity; for (const s of seeds) d = Math.min(d, Math.hypot(items[u].cx - items[s].cx, items[u].cy - items[s].cy));
      const sc = d * (0.55 + 0.45 * rnd());
      if (sc > bs) { bs = sc; best = u; }
    }
    if (best < 0) return null;
    seeds.push(best);
  }
  return seeds;
}

// 타설 방법 후보 추천: 사용자가 정한 N구역 안에서, 규칙을 모두 지키면서 서로 충분히 다른 배정을 want개까지

// ===== 문서 v2 1.9 — 씨앗 확장 =====
// 걸어간 거리: 이웃한 단위를 따라 (중심 사이 거리 합)
function walkDist(M, srcs, allowed) {
  const U = M.units, d = new Float64Array(U.length).fill(Infinity), done = new Uint8Array(U.length);
  for (const s of srcs) d[s] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < U.length; i++) if (!done[i] && d[i] < best && (!allowed || allowed[i])) { best = d[i]; u = i; }
    if (u < 0) break; done[u] = 1;
    for (const [v] of U[u].nb) { if (allowed && !allowed[v]) continue; const w = Math.hypot(U[u].cx - U[v].cx, U[u].cy - U[v].cy); if (d[u] + w < d[v]) d[v] = d[u] + w; }
  }
  return d;
}
function docGrow(M, N, P, dir, allowed) {
  const U = M.units, n = U.length, z = new Int32Array(n).fill(-1);
  const ids = []; for (let i = 0; i < n; i++) if (!allowed || allowed[i]) ids.push(i);
  if (ids.length < N) return null;
  const key = { 'X-': u => U[u].cx, 'X+': u => -U[u].cx, 'Y-': u => U[u].cy, 'Y+': u => -U[u].cy }[dir];
  // 씨앗: 첫 씨앗은 그 방향 가장 끝 단위, 이후는 기존 씨앗들에서 걸어간 거리가 가장 먼 단위
  const seeds = [ids.reduce((a, b) => key(b) < key(a) ? b : a)];
  let dmin = walkDist(M, [seeds[0]], allowed);
  while (seeds.length < N) {
    let far = -1, fd = -1; for (const u of ids) { if (seeds.includes(u)) continue; const dv = dmin[u] === Infinity ? 1e18 : dmin[u]; if (dv > fd) { fd = dv; far = u; } }
    if (far < 0) return null; seeds.push(far);
    const d2 = walkDist(M, [far], allowed); for (let i = 0; i < n; i++) dmin[i] = Math.min(dmin[i], d2[i]);
  }
  const vol = new Float64Array(N), seedD = seeds.map(s => walkDist(M, [s], allowed));
  seeds.forEach((s, k) => { z[s] = k; vol[k] = U[s].vol; });
  if (seeds.some(s => U[s].vol > P + 1e-9)) return null;
  let left = ids.length - N;
  while (left > 0) {
    // 물량이 가장 작은 구역부터, 흡수할 수 있는 단위가 있는 구역을 찾는다
    const order = [...Array(N).keys()].sort((a, b) => vol[a] - vol[b]);
    let picked = null;
    for (const k of order) {
      let best = null;
      for (let u = 0; u < n; u++) {
        if (z[u] !== k) continue;
        for (const [v] of U[u].nb) {
          if (z[v] !== -1 || (allowed && !allowed[v]) || vol[k] + U[v].vol > P + 1e-9) continue;
          // 경계 증가량 = 구역 밖과 맞닿은 길이 − 구역과 맞닿은 길이 (슬래브 바깥선 제외)
          let inL = 0, outL = 0; for (const [w, len] of U[v].nb) { if (allowed && !allowed[w]) continue; if (z[w] === k) inL += len; else outL += len; }
          const inc = outL - inL, sd = seedD[k][v];
          if (!best || inc < best.inc - 1e-9 || (Math.abs(inc - best.inc) <= 1e-9 && sd < best.sd)) best = { v, inc, sd };
        }
      }
      if (best) { picked = { k, v: best.v }; break; }
    }
    if (!picked) return null; // 막힘
    z[picked.v] = picked.k; vol[picked.k] += U[picked.v].vol; left--;
  }
  return z;
}
// 네 방향에서 시작해 규칙 3(꺾임)을 만족하는 안만 남긴다
function docPlans(M, N, P) {
  const out = [];
  for (const dir of ['X-', 'X+', 'Y-', 'Y+']) {
    const z = docGrow(M, N, P, dir); if (!z) continue;
    const ev = evaluate(M, z, N, M.C / N);
    if (ev.maxVol > P + 1e-6 || ev.bends.length) continue;
    out.push({ z: Array.from(z), ...ev, doc: dir });
  }
  return out.sort((a, b) => a.total - b.total);
}


// ===== 문서 v2 2장 — 비상 중단선 (A~F) =====
// 구역 k 의 단위들을 진행 방향으로 쌓는 순서(A), 멈출 수 있는 자리(B), 차량 구간(C), 커버(D), 대표 선(E), 판정(F)
function beamCrossR(M, x, y, vertical) {
  // 경계선이 보를 지나는 점에서 중앙 이탈 r = |x − L/2| ÷ (L/6)
  for (const b of M.beams) {
    if (vertical ? b.o !== 'h' : b.o !== 'v') continue;
    const perp = vertical ? y : x, along = vertical ? x : y;
    if (Math.abs(perp - b.c) > 1e-6) continue;
    const fa = b.fa !== undefined ? b.fa : b.a, fb = b.fb !== undefined ? b.fb : b.b;
    if (along <= fa || along >= fb) continue;
    const L = fb - fa; return Math.abs(along - (fa + L / 2)) / (L / 6);
  }
  return null;
}
function stopAnalysis(M, z, k, dir, cap, tieTol, bendFree) {
  const U = M.units, mem = []; for (let u = 0; u < z.length; u++) if (z[u] === k) mem.push(u);
  const inZ = new Set(mem), V = mem.reduce((a, u) => a + U[u].vol, 0);
  const key = { 'X+': u => U[u].cx, 'X-': u => -U[u].cx, 'Y+': u => U[u].cy, 'Y-': u => -U[u].cy }[dir];
  const connected = set => { if (set.size <= 1) return true; const s0 = set.values().next().value, seen = new Set([s0]), st = [s0];
    while (st.length) { const u = st.pop(); for (const [v] of U[u].nb) if (set.has(v) && !seen.has(v)) { seen.add(v); st.push(v); } } return seen.size === set.size; };
  // A: 순서
  const order = [], poured = new Set(), rest = new Set(mem);
  let first = mem.reduce((a, b) => key(b) < key(a) ? b : a); order.push(first); poured.add(first); rest.delete(first);
  while (rest.size) {
    const cand = [...rest].filter(u => [...U[u].nb.keys()].some(v => poured.has(v)));
    if (!cand.length) { const u = [...rest].reduce((a, b) => key(b) < key(a) ? b : a); order.push(u); poured.add(u); rest.delete(u); continue; }
    cand.sort((a, b) => key(a) - key(b));
    let pick = cand.find(u => { rest.delete(u); const ok = connected(rest); rest.add(u); return ok; });
    if (pick === undefined) pick = cand[0];
    order.push(pick); poured.add(pick); rest.delete(pick);
  }
  // B: 멈출 수 있는 자리
  const nodes = new Set(); for (const u of mem) for (const nd of U[u].nodes) nodes.add(nd);
  const z2 = Array.from(z), NEW = 1e6, stops = []; let cum = 0;
  const done = new Set(), left = new Set(mem);
  for (let s = 0; s < order.length - 1; s++) {
    const u = order[s]; done.add(u); left.delete(u); cum += U[u].vol;
    if (!connected(left)) continue;
    for (const v of left) z2[v] = NEW; for (const v of done) z2[v] = k;
    let bent = false; if (!bendFree) for (const nd of nodes) if (bendAtNode(M, z2, nd)) { bent = true; break; }
    if (bent) continue;
    // 스톱엔드 길이·경계 선분·지나는 보의 r
    let len = 0; const segs = [], rs = [];
    for (const a of done) for (const [v, l] of U[a].nb) if (left.has(v)) len += l;
    for (const e of M.edges) { if (e.A < 0) continue; const ua = M.unitOf[e.A], ub = M.unitOf[e.B];
      if ((done.has(ua) && left.has(ub)) || (done.has(ub) && left.has(ua))) { segs.push([e.x1, e.y1, e.x2, e.y2]);
        const vert = Math.abs(e.x1 - e.x2) < 1e-9; for (const [px, py] of [[e.x1, e.y1], [e.x2, e.y2]]) { const r = beamCrossR(M, px, py, vert); if (r !== null) rs.push(r); } } }
    stops.push({ step: s + 1, cum, len, r: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, segs });
  }
  // C~F
  const trucks = Math.max(1, Math.ceil(V / cap - 1e-9)), need = trucks - 1, segments = [];
  for (let t = 0; t < need; t++) {
    const lo = t * cap, hi = (t + 1) * cap;
    const inSeg = stops.filter(p => p.cum > lo + 1e-9 && p.cum <= hi + 1e-9);
    let rep = null, cause = null;
    if (inSeg.length) {
      const dmin = Math.min(...inSeg.map(p => hi - p.cum));
      const tie = inSeg.filter(p => hi - p.cum <= dmin + tieTol + 1e-9);
      tie.sort((a, b) => a.r - b.r || a.len - b.len); rep = tie[0];
    } else {
      // 원인: 구간 안에 단위 경계가 아예 없음(큰 단위) / 경계는 있지만 모두 탈락
      let c0 = 0, anyEdge = false, bigU = null;
      for (const u of order) { const c1 = c0 + U[u].vol; if (c1 > lo + 1e-9 && c1 <= hi + 1e-9) anyEdge = true; if (c0 <= lo + 1e-9 && c1 >= hi - 1e-9) bigU = u; c0 = c1; }
      cause = anyEdge ? { type: 'blocked' } : { type: 'big', unit: bigU, vol: bigU !== null ? U[bigU].vol : null };
    }
    segments.push({ lo, hi, rep, cause });
  }
  const covered = segments.filter(s => s.rep).length;
  return { k, dir, V, order, stops, trucks, need, segments, covered, safe: covered === need,
    repLen: segments.reduce((a, s) => a + (s.rep ? s.rep.len : 0), 0) };
}
function stopPlan(M, z, k, dirMode, cap, tieTol) {
  const dirs = dirMode && dirMode !== 'auto' ? [dirMode] : ['X+', 'X-', 'Y+', 'Y-'];
  const all = dirs.map(d => stopAnalysis(M, z, k, d, cap, tieTol));
  all.sort((a, b) => b.covered - a.covered || a.repLen - b.repLen);
  return { best: all[0], all };
}

// ===== 문서 v2 3장 — 시공 중 재분할 (G~K) =====
function rzEval(M, z, done) {
  // 남은 영역의 구역 물량·이음 길이 (이미 친 곳과의 경계는 이음에 넣지 않음)
  const U = M.units, vol = {}, pairs = new Map(); let joint = 0;
  for (let u = 0; u < U.length; u++) { if (done[u]) continue; vol[z[u]] = (vol[z[u]] || 0) + U[u].vol;
    for (const [v, l] of U[u].nb) if (!done[v] && v > u && z[v] !== z[u]) { joint += l; pairs.set(u + '-' + v, l); } }
  return { vol, joint, pairs };
}
function rzConnected(M, set) {
  if (set.size <= 1) return true; const s0 = set.values().next().value, seen = new Set([s0]), st = [s0];
  while (st.length) { const u = st.pop(); for (const [v] of M.units[u].nb) if (set.has(v) && !seen.has(v)) { seen.add(v); st.push(v); } }
  return seen.size === set.size;
}
// I: 최소 변경 — 오늘 구역 = 원래 오늘 칠 구역의 남은 부분. 넘치면 뒤쪽 단위를 다음 구역으로, 여유가 크면 흡수 후보를 돌려준다
function rzBends(M, z, u, k, done) {
  // 단위 u 를 구역 k 로 옮겼을 때 u 주변 꼭짓점에서 슬래브 한가운데 꺾임이 생기는지 (이미 친 곳은 경계로 보지 않음)
  const z2 = z.map((q, i) => done[i] ? -9 : q); z2[u] = k;
  for (const nd of M.units[u].nodes) if (bendAtNode(M, z2, nd)) return true;
  return false;
}
function rezoneMinimal(M, z0, done, Ptoday, P, cap, orderOf) {
  const U = M.units, z = Array.from(z0), ks = [...new Set(z.filter((k, u) => !done[u]))].sort((a, b) => a - b);
  if (!ks.length) return { z, today: null, note: '남은 영역이 없습니다.' };
  const t = ks[0], msgs = [];
  const members = k => { const s = new Set(); for (let u = 0; u < z.length; u++) if (!done[u] && z[u] === k) s.add(u); return s; };
  const volOf = s => [...s].reduce((a, u) => a + U[u].vol, 0);
  let today = members(t);
  if (!rzConnected(M, today)) msgs.push('오늘 구역의 남은 부분이 두 덩어리 이상으로 갈라졌습니다(규칙 6). 전체 재분할을 권장합니다.');
  // 넘치면 진행 방향 뒤쪽부터 떼어 다음 구역에
  const ord = (orderOf && orderOf(t)) || [...today];
  let idx = ks.indexOf(t);
  for (let guard = 0; volOf(today) > Ptoday + 1e-9 && guard < U.length; guard++) {
    const canMove = u => { if (!today.has(u)) return false; today.delete(u); const ok = rzConnected(M, today); today.add(u); return ok; };
    const nbZ = u => [...M.units[u].nb.keys()].filter(v => !done[v] && z[v] !== t).map(v => z[v]);
    const back = [...ord].reverse().find(u => canMove(u) && !nbZ(u).every(q => rzBends(M, z, u, q, done))) ?? [...ord].reverse().find(canMove);
    if (back === undefined) { msgs.push('오늘 구역을 한 덩어리로 유지하면서 더 줄일 수 없습니다.'); break; }
    const nbZones = [...U[back].nb.keys()].filter(v => !done[v] && z[v] !== t).map(v => z[v]);
    const to = ks.slice(idx + 1).find(k => nbZones.includes(k));
    const dest = to !== undefined ? to : Math.max(...ks) + 1;
    today.delete(back); z[back] = dest; if (!ks.includes(dest)) ks.push(dest);
  }
  // 이어지는 구역이 원래 한도를 넘으면 같은 방식으로 뒤로 민다
  for (let i = idx + 1; i < ks.length; i++) {
    const k = ks[i]; let s = members(k);
    for (let guard = 0; volOf(s) > P + 1e-9 && guard < U.length; guard++) {
      const back = [...s].sort((a, b) => U[b].cx + U[b].cy - U[a].cx - U[a].cy).find(u => { s.delete(u); const ok = rzConnected(M, s); s.add(u); return ok; });
      if (back === undefined) break;
      const nbZones = [...U[back].nb.keys()].filter(v => !done[v] && z[v] !== k).map(v => z[v]);
      const to = ks.slice(i + 1).find(q => nbZones.includes(q)); const dest = to !== undefined ? to : Math.max(...ks) + 1;
      s.delete(back); z[back] = dest; if (!ks.includes(dest)) ks.push(dest);
    }
  }
  const slack = Ptoday - volOf(today);
  // 흡수 후보: 여유가 트럭 한 대분 이상이면, 오늘 구역에 이웃한 다음 구역 단위
  let absorb = null;
  if (slack >= cap - 1e-9) {
    const nxt = ks[idx + 1];
    if (nxt !== undefined) {
      const pick = []; let add = 0; const nset = members(nxt);
      for (let guard = 0; guard < U.length; guard++) {
        const c = [...nset].filter(u => [...U[u].nb.keys()].some(v => today.has(v) || pick.includes(v)) && add + U[u].vol <= slack + 1e-9)
          .find(u => { nset.delete(u); const ok = rzConnected(M, nset) && !rzBends(M, z, u, t, done); nset.add(u); return ok; });
        if (c === undefined) break; pick.push(c); add += U[c].vol; nset.delete(c); z[c] = t;
      }
      for (const u of pick) z[u] = nxt; // 제안만 하고 실제 적용은 사용자가 고른 뒤
      if (pick.length) absorb = { from: nxt, units: pick, vol: add };
    }
  }
  return { z, today: t, todayVol: volOf(today), slack, absorb, msgs };
}
// J: 전체 재분할 — 남은 단위만으로 처음부터 (구역 수 하한부터 늘려 가며)
function rezoneFull(M, done, P, stopAt, Pday) {
  // P = 오늘 타설 가능량(오늘 구역), Pday = 이후 날의 원래 한도
  const Pn = Pday > 0 ? Math.max(Pday, P) : P;
  const U = M.units, left = []; for (let u = 0; u < U.length; u++) if (!done[u]) left.push(u);
  const set = new Set(left), comps = [];
  const seen = new Set(); for (const s of left) { if (seen.has(s)) continue; const list = [s]; seen.add(s);
    for (let q = 0; q < list.length; q++) for (const [v] of U[list[q]].nb) if (set.has(v) && !seen.has(v)) { seen.add(v); list.push(v); } comps.push(list); }
  const V = left.reduce((a, u) => a + U[u].vol, 0);
  const big = left.filter(u => U[u].vol > Pn + 1e-9);
  if (big.length) return { z: null, need: Math.max(...big.map(u => U[u].vol)), msg: '하루 한도보다 큰 최소 타설 단위가 남아 있습니다.' };
  const nLo = Math.max(comps.length, Math.ceil(V / Pn - 1e-9), left.filter(u => U[u].vol > Pn / 2 + 1e-9).length);
  const rnd = mulberry32(20261201);
  for (let N = nLo; N <= nLo + 8; N++) {
    // 구역 수마다 시간을 나눠 준다 (불가능한 구역 수에서 예산을 다 쓰지 않게)
    const zs = guillotine(M, N, Pn, rnd, 300, Math.min(stopAt, Date.now() + 1500), comps);
    const good = [];
    for (const zz of zs) {
      const z = Array.from(zz); for (let u = 0; u < U.length; u++) if (done[u]) z[u] = -5;
      // 꺾임은 이미 친 곳과 닿지 않은 점에서만 본다
      let bent = 0; const nodes = new Set(); for (const u of left) for (const nd of U[u].nodes) nodes.add(nd);
      for (const nd of nodes) if (bendAtNode(M, z, nd)) { bent++; break; }
      if (bent) continue;
      // 오늘 칠 구역: 이미 친 곳에 붙어 있고 오늘 한도 안인 구역 중 가장 큰 것
      const vols = {}; for (const u of left) vols[z[u]] = (vols[z[u]] || 0) + U[u].vol;
      const touch = new Set(); for (const u of left) for (const [v] of U[u].nb) if (done[v]) touch.add(z[u]);
      const cand = Object.keys(vols).map(Number).filter(k => vols[k] <= P + 1e-9);
      const pref = cand.filter(k => touch.has(k)); const pool = pref.length ? pref : cand;
      if (!pool.length) continue;
      const today = pool.reduce((a, b) => vols[b] > vols[a] ? b : a);
      for (const u of left) z[u] = z[u] === today ? -1 : z[u]; // 오늘 구역을 맨 앞 번호로
      for (const u of left) if (z[u] === -1) z[u] = -0.5;
      good.push(z);
    }
    if (good.length) {
      good.sort((a, b) => rzEval(M, a, done).joint - rzEval(M, b, done).joint);
      return { z: good[0], N };
    }
  }
  return { z: null, msg: '남은 영역을 규칙대로 나눌 방법을 찾지 못했습니다.' };
}


// ===== 결정적 이등분 탐색 =====
// 유효한 분할(곧은 이음, T자 허용)은 '곧은 선으로 영역을 끝까지 가르기'의 반복이다.
// 영역·구역 수 쌍마다 한 번만 계산(기억)하며 가능한 가르기를 모두 따져, 있으면 반드시 찾는다(시간 제한 안에서).
function gExact(M, N, P, stop, compsIn, order) {
  const U = M.units, COMPS = compsIn || M.comps, memo = new Map();
  // 너무 작은 구역(평균의 10% 미만, 1㎥ 미만)은 만들지 않는다 — 떨어진 덩어리 전체는 예외
  const totV = COMPS.reduce((a, c) => a + c.reduce((s, u) => s + U[u].vol, 0), 0), minV = Math.max(1, 0.1 * totV / N);
  const whole = new Set(COMPS.map(c => c.slice().sort((a, b) => a - b).join(',')));
  const volOf = reg => { let v = 0; for (const u of reg) v += U[u].vol; return v; };
  let timedOut = false;
  // 선 하나로 영역을 가른 결과: 두 덩어리 이상 (코어·개구부 때문에 셋 이상으로 갈릴 수 있음)
  const splitK = (reg, set, line) => {
    const lab = new Map(), parts = [];
    for (const s0 of reg) { if (lab.has(s0)) continue; const idx = parts.length; lab.set(s0, idx); const st = [s0], part = [s0];
      while (st.length) { const u = st.pop(); for (const [v, ids] of U[u].nbl) { if (!set.has(v) || lab.has(v) || ids.has(line)) continue; lab.set(v, idx); st.push(v); part.push(v); } }
      parts.push(part); if (parts.length > 6) return null; }
    return parts.length >= 2 ? parts : null;
  };
  // 덩어리들에 구역 수를 나눠 주는 모든 방법을 (필요 최소부터) 차례로
  function* allocs(vols, n) {
    const need = vols.map(v => Math.max(1, Math.ceil(v / P - 1e-9)));
    let extra = n - need.reduce((a, b) => a + b, 0); if (extra < 0) return;
    const cur = need.slice();
    function* go(i, left) {
      if (i === vols.length - 1) { cur[i] = need[i] + left; yield cur.slice(); return; }
      for (let e = 0; e <= left; e++) { cur[i] = need[i] + e; yield* go(i + 1, left - e); }
    }
    yield* go(0, extra);
  }
  function rec(reg, n) {
    const vol = volOf(reg);
    const skey = reg.slice().sort((a, b) => a - b).join(',');
    if (n === 1) return vol <= P + 1e-6 && (vol >= minV - 1e-9 || whole.has(skey)) ? [reg] : null;
    if (vol > n * P + 1e-6 || vol < n * minV - 1e-9 || reg.length < n) return null;
    const key = n + '|' + skey;
    if (memo.has(key)) return memo.get(key);
    if (Date.now() > stop) { timedOut = true; return null; }
    const set = new Set(reg), lines = new Set();
    for (const u of reg) for (const [v, ids] of U[u].nbl) if (set.has(v)) for (const id of ids) lines.add(id);
    const opts = [];
    for (const line of lines) {
      const parts = splitK(reg, set, line); if (!parts) continue;
      const pv = parts.map(volOf);
      for (const al of allocs(pv, n)) opts.push({ parts, al, sc: Math.max(...pv.map((v, q) => v / al[q])), line });
    }
    opts.sort(order === 1 ? (a, b) => a.line - b.line || a.sc - b.sc : order === 2 ? (a, b) => b.line - a.line || a.sc - b.sc : (a, b) => a.sc - b.sc);
    for (const o of opts) {
      let res = [];
      for (let q = 0; q < o.parts.length; q++) { const r = rec(o.parts[q], o.al[q]); if (!r) { res = null; break; } res = res.concat(r); }
      if (res) { memo.set(key, res); return res; }
      if (timedOut) return null;
    }
    if (!timedOut) memo.set(key, null);
    return null;
  }
  const comps = COMPS.map(c => c.slice()), cv = comps.map(volOf);
  for (const al of allocs(cv, N)) {
    const z = new Int32Array(U.length).fill(-1); let k = 0, ok = true;
    for (let i = 0; i < comps.length && ok; i++) { const r = rec(comps[i], al[i]); if (!r) { ok = false; break; } for (const g of r) { for (const u of g) z[u] = k; k++; } }
    if (ok) return { z, timedOut };
    if (timedOut) break;
  }
  return { z: null, timedOut };
}

// 한도 P로 나눌 수 있는지 (구역 수 nFrom부터 몇 개 늘려 보며). 찾은 안을 돌려준다
function exactFeasible(M, P, nFrom, span, tEach) {
  const n0 = Math.max(nFrom, M.comps.length, Math.ceil(M.C / P - 1e-9), M.units.filter(u => u.vol > P / 2 + 1e-9).length);
  if (M.units.some(u => u.vol > P + 1e-9)) return { plan: null, timedOut: false };
  let anyTO = false;
  for (let n = n0; n <= Math.min(M.units.length, n0 + span); n++) {
    const r = gExact(M, n, P, Date.now() + tEach); if (r.timedOut) anyTO = true;
    if (r.z) { const ev = evaluate(M, r.z, n, M.C / n); if (!ev.bends.length && !hasTinyCut(M, r.z, ev.vol, M.C / n)) return { plan: { n, z: Array.from(r.z), ...ev }, timedOut: false }; }
  }
  return { plan: null, timedOut: anyTO };
}
// 실제로 가능한 가장 낮은 하루 한도 (이분 탐색, 찾은 안으로 뒷받침)
function minFeasibleP(M, hiHint, budgetMs) {
  const stop = Date.now() + budgetMs;
  let lo = Math.max(...M.units.map(u => u.vol)), hi = hiHint > 0 ? hiHint : M.C, best = null;
  const top = exactFeasible(M, hi, 1, 6, 800).plan; if (top) best = { P: hi, plan: top }; else return null;
  for (let it = 0; it < 12 && hi - lo > 0.5 && Date.now() < stop; it++) {
    const mid = (lo + hi) / 2, r = exactFeasible(M, mid, 1, 4, 400).plan;
    if (r) { hi = mid; best = { P: mid, plan: r }; } else lo = mid;
  }
  return best;
}

function feasibilityScan(M, nFrom, nTo, tEach) {
  const out = [];
  for (let n = Math.max(1, nFrom); n <= Math.min(M.units.length, nTo); n++) {
    if (n < M.comps.length) { out.push({ n, best: null }); continue; }
    const R = recommend(M, n, 1e12, 60, 5, tEach);
    out.push({ n, best: R.sols.length ? Math.min(...R.sols.map(s => s.maxVol)) : null, sols: R.sols });
  }
  return out;
}
function recommend(M, N, P, restarts, want, timeMs) {
  want = want || 10;
  const pairs = [];
  M.units.forEach((u, i) => { for (const [v] of u.nb) if (i < v) pairs.push([i, v]); });
  const diff = (a, b) => { let d = 0; for (const [i, v] of pairs) if ((a.z[i] === a.z[v]) !== (b.z[i] === b.z[v])) d++; return d; };
  let pool = [], overP = 0, bentN = 0, tinyN = 0, found = 0, tried = 0;
  const seen = new Set();
  const stop = Date.now() + (timeMs > 0 ? timeMs : 10000);
  for (let round = 0; round < 4; round++) {
    if (Date.now() > stop) break;
    const R = solve(M, N, P, restarts, 20261010 + N + round * 977, stop);
    overP += R.overP; bentN += R.bentN; tinyN += R.tinyN || 0; found += R.found; tried += R.tried;
    for (const s of R.sols) {
      const map = new Map();
      const key = s.z.map(k => { if (!map.has(k)) map.set(k, map.size); return map.get(k); }).join(',');
      if (!seen.has(key)) { seen.add(key); pool.push(s); }
    }
    if (pool.length >= want * 2) break;
  }
  pool.sort((a, b) => a.score - b.score);
  const picked = [];
  for (const minD of [3, 1]) for (const s of pool) {
    if (picked.length >= want) break;
    if (!picked.includes(s) && picked.every(p => diff(p, s) >= minD)) picked.push(s);
  }
  picked.sort((a, b) => a.score - b.score);
  if (picked.length > 1) {
    const tag = (fn, label) => { let b = null; for (const s of picked) if (!b || fn(s) < fn(b) - 1e-9) b = s; if (b) (b.tags = b.tags || []).push(label); };
    tag(s => s.maxDev + 1e-5 * s.total, '물량 균형 최고');
    tag(s => s.total + 1e-3 * s.maxDev, '이음 최소');
  }
  picked.forEach(s => { s.tags = s.tags || []; });
  const timedOut = Date.now() >= stop - 50 && picked.length < want;
  return { sols: picked, T: M.C / N, tried, overP, bentN, tinyN, found, timedOut };
}
// ===== CORE-END =====
if (typeof module !== 'undefined') module.exports = { gExact, exactFeasible, minFeasibleP, feasibilityScan, stopAnalysis, stopPlan, rezoneMinimal, rezoneFull, rzEval, docGrow, docPlans, walkDist, bendAtNode, evaluate, analyze, solve, recommend, normRect };
