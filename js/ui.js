// 화면: 단계 전환, 입력 읽기, 결과·도면 그리기, 시공 기록 (core.js·ifc.js·sample.js 다음에 불러옴)
// ===== 화면 =====
const $ = s => document.querySelector(s);
const ZC = ['#F4C58A','#B9DDB0','#F2B3C6','#A6C8EE','#D5C0EE','#EFDF92','#B3E0DA','#F2B596','#C8D3A0','#C4C4E8','#E9C9A8','#A9D6C0'];
const zColor = k => ZC[k % ZC.length];
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const EXAMPLE = (() => {
  const cols = [];
  for (const x of [0, 8, 16]) for (const y of [0, 7, 14, 21]) cols.push([x, y]);
  for (const y of [0, 7, 14]) cols.push([24, y]);
  return {
    project: '예제 — 보 구조 업무시설', floor: '6F',
    slab: [[0, -1.5], [16, -1.5], [16, 0], [24, 0], [24, 14], [16, 14], [16, 21], [0, 21]],
    t: 0.2, C: 125, columns: cols,
    beams: [[4, 0, 4, 7, 0.4], [4, 7, 4, 14, 0.4], [4, 14, 4, 21, 0.4], [12, 0, 12, 7, 0.4], [12, 7, 12, 14, 0.4], [12, 14, 12, 21, 0.4], [20, 0, 20, 7, 0.4], [20, 7, 20, 14, 0.4]],
    walls: [[8, 14, 12, 14.25], [8, 18.25, 12, 18.5], [8, 14, 8.25, 18.5], [11.75, 14, 12, 18.5]],
    openings: [[8.25, 14.25, 11.75, 18.25], [12.3, 15, 15.3, 18.25]],
    P: 35, N: 0, ratio: '1/3', mult: 2, defW: 0.4, cantExt: false
  };
})();

const rowsText = rows => (rows || []).map(r => r.join(', ')).join('\n');
function fill(o) {
  const set = (id, v) => { if (v !== undefined && v !== null) $('#' + id).value = v; };
  set('project', o.project); set('floor', o.floor);
  $('#slab').value = (o.slabs && o.slabs.length > 1 ? o.slabs : [o.slab]).map(rowsText).join('\n\n'); $('#columns').value = rowsText(o.columns);
  $('#beams').value = rowsText(o.beams); $('#walls').value = rowsText(o.walls); $('#openings').value = rowsText(o.openings);
  set('t', o.t); $('#C').value = o.C > 0 ? o.C : ''; set('P', o.P); if (o.N !== undefined) $('#N').value = o.N > 0 ? o.N : '';
  if (o.ratio !== undefined) $('#ratio').value = o.ratio; set('mult', o.mult); set('defW', o.defW); set('minCut', o.minCut); set('cantMin', o.cantMin); set('gridTol', o.gridTol); set('minWallT', o.minWallT);
  if (o.cantExt !== undefined) $('#cantExt').checked = !!o.cantExt;
}
function parseRows(text, n, label, errs) {
  const rows = [], bad = [];
  text.split(/\n/).forEach((line, i) => {
    const s = line.replace(/#.*/, '').replace(/[()\[\]]/g, ' ').trim(); if (!s) return;
    const v = s.split(/[\s,;\t]+/).filter(Boolean).map(Number);
    if (v.length < n || v.slice(0, n).some(x => !isFinite(x))) bad.push(i + 1); else rows.push(v);
  });
  if (bad.length) errs.push(`${label}: ${bad.join(', ')}번째 줄을 읽지 못했습니다. 숫자를 쉼표로 구분해 입력하세요.`);
  return rows;
}
function parseRings(text, label, errs) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const rings = blocks.map(b => parseRows(b, 2, label, errs)).filter(r => r.length >= 3);
  return rings;
}
function parseRatio(s) { s = String(s).trim(); if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return a / b; } return Number(s); }
const num = id => { const v = $('#' + id).value.trim(); return v === '' ? NaN : Number(v); };

function readInputs() {
  const errs = [];
  const inp = {
    project: $('#project').value.trim(), floor: $('#floor').value.trim(),
    slabs: parseRings($('#slab').value, '슬래브 외곽선', errs),
    columns: parseRows($('#columns').value, 2, '기둥', errs),
    beams: parseRows($('#beams').value, 4, '보', errs),
    walls: parseRows($('#walls').value, 4, '벽', errs).map(normRect),
    openings: parseRows($('#openings').value, 4, '개구부', errs).map(normRect),
    t: num('t'), C: num('C'), P: num('P'), N: num('N'),
    ratio: parseRatio($('#ratio').value), mult: num('mult'), defW: num('defW'), minCut: num('minCut'), cantMin: num('cantMin'), gridTol: num('gridTol'), minWallT: num('minWallT'),
    restarts: Math.max(10, Math.min(500, num('restarts') || 120)), cantExt: $('#cantExt').checked,
    Cslab: state.ifcCslab || 0, truck: num('truck') > 0 ? num('truck') : 6, tieTol: num('tieTol') >= 0 ? num('tieTol') : 0.5, pourDir: $('#pourDir').value, linkDetached: $('#linkDetached').checked
  };
  inp.slab = inp.slabs[0] || [];
  if (!(inp.P > 0)) errs.push('1일 최대 타설량 P를 0보다 큰 값으로 입력하세요.');
  if (!(inp.C > 0) && !(inp.t > 0)) errs.push('슬래브 두께 t 또는 총 타설량 C 중 하나는 입력해야 합니다.');
  if (!(inp.ratio > 0 && inp.ratio <= 1)) errs.push('가운데 구간 비율은 0보다 크고 1 이하여야 합니다 (예: 1/3).');
  if (!(inp.mult >= 0)) errs.push('작은보 이격 배수는 0 이상이어야 합니다.');
  if (!(inp.defW > 0)) errs.push('기본 작은보 폭을 입력하세요.');
  if (!(inp.minCut >= 0)) inp.minCut = 0.05;
  if (!(inp.cantMin >= 0)) inp.cantMin = 0.6;
  if (!(inp.gridTol >= 0)) inp.gridTol = 0.3;
  if (!(inp.minWallT >= 0)) inp.minWallT = 0.2;
  if (!(inp.t > 0)) inp.t = 0;
  return { inp, errs };
}

const state = { M: null, R: null, sel: 0, inp: null, N: 0, fail: false };

const MSG_TAG = { err: '오류', warn: '주의', ok: '완료' };
function showMsgs(list) {
  const one = ([k, t]) => `<div class="msg ${k}"><span class="tag">${MSG_TAG[k] || '안내'}</span><p>${t}</p></div>`;
  const ok = list.filter(([k]) => k === 'ok');
  const quiet = list.filter(([k, t]) => k === 'warn' && t.indexOf('<button') < 0);
  const loud = list.filter(x => !ok.includes(x) && !quiet.includes(x));
  state.okText = ok.map(([, t]) => t).join(' ');
  state.quiet = quiet.map(([, t]) => t);
  $('#msgs').innerHTML = loud.map(one).join('');
  $('#msgs').hidden = !loud.length;
}

function requireP() {
  const el = $('#P');
  if (num('P') > 0) { el.classList.remove('invalid'); $('#pErr').hidden = true; return true; }
  el.classList.add('invalid'); $('#pErr').hidden = false;
  el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return false;
}
function run() {
  if (!requireP()) return;
  closeDrawer();
  const btn = $('#run'), btn2 = $('#ifcRun'); btn.dataset.label = btn.dataset.label || btn.textContent; btn2.dataset.label = btn2.dataset.label || btn2.textContent; btn.disabled = true; btn2.disabled = true; btn.textContent = btn2.textContent = num('N') > 0 ? '계산 중…' : '가장 빠른 계획 찾는 중…';
  setTimeout(() => {
    try { compute(); } catch (e) { $('#empty').hidden = true; $('#out').hidden = false; showMsgs([['err', '계산 중 오류: ' + esc(e.message)]]); console.error(e); }
    btn.disabled = false; btn.textContent = btn.dataset.label; btn2.disabled = false; btn2.textContent = btn2.dataset.label;
  }, 30);
}

function suggestP(M) {
  const sig = JSON.stringify({ ...state.inp, P: 0, N: 0 });
  if (state.sugCache && state.sugCache.sig === sig) return state.sugCache.v;
  const r = minFeasibleP(M, M.C, 9000);
  const v = r ? { P: Math.ceil(r.P * 10 - 1e-9) / 10, N: r.plan.n } : null;
  if (v) v.P = Math.ceil(v.P); // 보기 쉽게 올림한 정수 ㎥
  state.sugCache = { sig, v }; return v;
}
function suggestTxt(sg) {
  if (!sg) return ' 규칙을 지키며 나누는 방법을 찾지 못했습니다. 모델의 보·벽 배치를 확인해 주세요.';
  return ` 하루 ${sg.P} ㎥이면 규칙을 모두 지키는 구획안이 있습니다(실제로 찾은 안 기준). <button type="button" class="inline-btn" data-p="${sg.P}">한도 ${sg.P} ㎥로 다시 계산</button>`;
}
function compute() {
  const { inp, errs } = readInputs();
  setStage('result'); $('#empty').hidden = true; $('#out').hidden = false;
  if (errs.length) { showMsgs(errs.map(e => ['err', esc(e)])); $('#sheet').hidden = true; $('#zoneBlock').hidden = $('#altBlock').hidden = true; return; }
  const M = analyze(inp);
  if (M.E.length) { showMsgs(M.E.map(e => ['err', esc(e)])); $('#sheet').hidden = true; $('#zoneBlock').hidden = $('#altBlock').hidden = true; return; }
  state.M = M; state.inp = inp; state.R = null; state.sel = 0; state.fail = false; state.view = null; state.rec = null;
  const msgs = M.W.map(w => ['warn', esc(w)]);
  const auto = !(isFinite(inp.N) && inp.N > 0);
  let N = auto ? Math.max(M.Nmin, M.comps.length) : Math.round(inp.N); state.N = N;
  state.auto = auto;
  $('#nHint').textContent = `물량상 최소 ${M.Nmin}일. 비워 두면 규칙까지 지키는 최단 일수로 자동 계산합니다.`;
  const big = M.units[M.maxUnit];
  if (big.vol > inp.P + 1e-6) {
    state.fail = true;
    const sg = suggestP(M);
    msgs.unshift(['err', `한 번에 쳐야 하는 가장 큰 덩어리가 ${f1(big.vol)} ㎥라, 하루 한도 ${inp.P} ㎥로는 나눌 수 없습니다(도면의 빨간 빗금).` + suggestTxt(sg)]);
  } else if (N < M.Nmin) {
    state.fail = true;
    msgs.unshift(['err', `구역 수 N=${N}은 하한 ${M.Nmin}보다 작습니다. 총 ${f1(M.C)} ㎥를 하루 ${inp.P} ㎥로 치려면 최소 ${M.Nmin}구역이 필요합니다.`]);
  } else if (N > M.units.length) {
    state.fail = true;
    msgs.unshift(['err', `나눌 수 있는 최소 타설 단위가 ${M.units.length}개뿐이라 ${N}구역을 만들 수 없습니다. N을 ${M.units.length} 이하로 줄이세요.`]);
  } else if (M.comps.length > N) {
    state.fail = true;
    msgs.unshift(['err', `벽·개구부로 완전히 떨어진 덩어리가 ${M.comps.length}개라 최소 ${M.comps.length}구역이 필요합니다.`]);
  } else {
    const tm = state.searchTime || 10000; state.searchTime = 0;
    let R, tried = [];
    if (auto) {
      // 1) 하한 구역 수로 먼저 시도 (대부분 여기서 끝남)
      R = recommend(M, N, inp.P, inp.restarts, 10, Math.min(3000, tm)); tried.push(N);
      if (!R.sols.length) {
        // 2) 결정적 이등분 탐색으로 규칙을 지키는 가장 적은 구역 수를 찾는다
        const f = exactFeasible(M, inp.P, N + 1, 8, 1200);
        state.exactTO = f.timedOut;
        if (f.plan) {
          const r2 = recommend(M, f.plan.n, inp.P, inp.restarts, 10, Math.min(tm, 5000)); tried.push(f.plan.n);
          N = f.plan.n; R = r2.sols.length ? r2 : { ...r2, sols: [f.plan], timedOut: false };
          if (!R.sols.some(s => s.z.join() === f.plan.z.join())) R.sols.push(f.plan);
        }
      }
      if (R.sols.length && R.sols.length < 10) { const r3 = recommend(M, N, inp.P, inp.restarts, 10, tm); if (r3.sols.length > R.sols.length) R = r3; }
      state.N = N;
    } else R = recommend(M, N, inp.P, inp.restarts, 10, tm);
    state.auto = auto; state.autoTried = tried;
    state.Rinfo = R;
    if (!R.sols.length) {
      state.fail = true;
      const why = [];
      if (R.overP) why.push(`${R.overP}개는 하루 한도(${inp.P} ㎥)를 넘었고`);
      if (R.tinyN) why.push(`${R.tinyN}개는 너무 작은 구역(평균의 10% 미만)이 생겨 제외됐고`);
      if (R.bentN) why.push(`${R.bentN}개는 경계가 보·기둥이 아닌 곳에서 꺾였습니다(규칙 3)`);
      const whyTxt = why.length ? ` 검토한 안 가운데 ${why.join(', ')}.` : '';
      const more = R.timedOut ? ` <button type="button" class="inline-btn" data-time="40000">더 오래 찾기 (최대 40초)</button>` : '';
      const lead = auto
        ? `하루 한도 ${inp.P} ㎥로는 규칙을 모두 지키는 구획안을 찾지 못했습니다.${state.exactTO ? ' 층이 복잡해 모든 경우를 확인하지는 못했습니다.' : ''}`
        : R.timedOut ? `제한 시간(${tm / 1000}초) 안에 ${N}구역으로 규칙을 모두 지키는 구획안을 찾지 못했습니다. 층이 커서 모든 경우를 확인하지 못한 것이라, 시간을 더 주면 나올 수 있습니다.` : `${N}구역으로는 규칙을 모두 지키는 구획안을 찾지 못했습니다.${whyTxt}`;
      if (auto) { const sg = suggestP(M); msgs.unshift(['err', lead + suggestTxt(sg)]); }
      else msgs.unshift(['err', `${lead} 구역 수를 늘려도 선택지가 넓어집니다.${more} <button type="button" class="inline-btn" data-n="${N + 1}">${N + 1}구역으로 다시 계산</button>`]);
    } else {
      state.R = R; sortSols(null);
      const s = R.sols[0];
      const lead = auto
        ? (N > M.Nmin
          ? `규칙을 모두 지키면서 가장 빨리 끝나는 계획은 ${N}구역(${N}일)입니다. 물량만 보면 ${M.Nmin}일이면 되지만, 곧은 절단선·코어 관통 금지 같은 규칙 때문에 ${M.Nmin === N - 1 ? M.Nmin + '일' : M.Nmin + '~' + (N - 1) + '일'}로는 나눌 수 없었습니다.`
          : `규칙을 모두 지키면서 가장 빨리 끝나는 계획은 ${N}구역(${N}일)으로, 물량상 최소 일수와 같습니다.`)
        : `${N}구역(${N}일) 기준으로 계산했습니다.`;
      msgs.unshift(['ok', `${lead} 구획안 ${R.sols.length}개 중 추천안은 가장 큰 구역이 ${f1(s.maxVol)} ㎥(하루 한도 ${inp.P} ㎥)이고, 물량 불균형은 ${(s.maxDev * 100).toFixed(0)}%(가장 치우친 구역이 평균과 이만큼 차이)입니다.`]);
      if (R.sols.length < 10) msgs.push(['warn', R.timedOut
        ? `제한 시간(${tm / 1000}초) 안에 찾은 구획안이 ${R.sols.length}개입니다. 층이 커서 모든 경우를 확인하지는 못했으니, 시간을 더 주면 더 나올 수 있습니다. <button type="button" class="inline-btn" data-time="40000">더 오래 찾기 (최대 40초)</button> <button type="button" class="inline-btn" data-n="${N + 1}">${N + 1}구역으로 다시 계산</button>`
        : `이 조건에서는 규칙을 모두 지키는 구획안이 ${R.sols.length}개뿐이라, ${R.sols.length === 1 ? '그 1개만' : `가능한 ${R.sols.length}개를 모두`} 보여드립니다. 구역 수를 늘리면 선택지가 넓어집니다. <button type="button" class="inline-btn" data-n="${N + 1}">${N + 1}구역으로 다시 계산</button>`]);
    }
  }
  if (!M.Cgiven) msgs.push(['warn', `총 타설량 C를 비워 슬래브 면적 × 두께(${f1(M.totalArea)} ㎡ × ${inp.t} m = ${f1(M.C)} ㎥)로 계산했습니다. 보 물량은 빠져 있습니다.`]);
  showMsgs(msgs);
  $('#sheet').hidden = false;
  // 실패하면 원인을 볼 수 있게 절단 위치·최소 타설 단위를 켜 주고, 다시 성공하면 자동으로 켰던 것만 끈다
  const lu = document.querySelector('[data-layer=units]'), lc = document.querySelector('[data-layer=cand]');
  if (state.fail) {
    if (!lu.checked) { lu.checked = true; state.autoOn = (state.autoOn || []).concat('units'); }
    if (!lc.checked) { lc.checked = true; state.autoOn = (state.autoOn || []).concat('cand'); }
  } else if (state.autoOn && state.autoOn.length) {
    for (const k of state.autoOn) document.querySelector(`[data-layer=${k}]`).checked = false;
    state.autoOn = [];
  }
  renderAll(true);
  setStage('result');
  if (window.matchMedia('(max-width:980px)').matches) $('#result').scrollIntoView({ behavior: 'smooth' }); else window.scrollTo({ top: 0, behavior: 'smooth' });
}

function layerOn(n) { return document.querySelector(`[data-layer=${n}]`).checked; }

function setStage(s) { document.body.dataset.stage = s; }
const altName = i => String.fromCharCode(65 + i) + '안';
// 정렬: ① 가장 작은 구역 물량이 큰 순 ② 시공이음 길이 합이 작은 순 (동률이면 서로를 보조 기준으로)
state.sortKey = 'min';
function sortSols(keep) {
  if (!state.R || !state.R.sols.length) return;
  const cur = keep || state.R.sols[state.sel];
  const f = state.sortKey === 'joint'
    ? (a, b) => a.total - b.total || b.minVol - a.minVol
    : (a, b) => b.minVol - a.minVol || a.total - b.total;
  state.R.sols.sort(f);
  state.sel = keep ? Math.max(0, state.R.sols.indexOf(cur)) : 0;
}
function renderHead() {
  const M = state.M, inp = state.inp, sol = state.R ? state.R.sols[state.sel] : null;
  if (!M || !inp) { $('#resHead').innerHTML = ''; return; }
  const cond = [inp.floor || '층', `1일 ${inp.P} ㎥`, state.auto ? '구역 수 자동' : `${state.N}개 구역 지정`].map(esc).join('<i>·</i>');
  let badge = '';
  if (sol && state.auto) badge = sol.N > M.Nmin ? `<span class="rh-badge warn">규칙 때문에 최소보다 ${sol.N - M.Nmin}일 더</span>` : '<span class="rh-badge ok">물량상 최소 일수</span>';
  const q = state.quiet || [];
  const warns = q.length ? `<details class="warns"><summary>주의 ${q.length}</summary><ul>${q.map(t => `<li>${t}</li>`).join('')}</ul></details>` : '';
  const kpi = sol ? [['총 타설량', f1(M.C), '㎥'], ['가장 큰 구역', f1(sol.maxVol), '㎥'], ['물량 불균형', (sol.maxDev * 100).toFixed(0), '%']] : [['총 타설량', f1(M.C), '㎥']];
  $('#resHead').innerHTML = `
    <div class="rh-top"><div class="rh-cond">${cond}</div>
      <div class="rh-act">${warns}<button type="button" class="rb-btn" id="openDrawer">조건 바꾸기</button></div></div>
    <div class="rh-main">
      <div class="rh-title">${sol ? `<div class="rh-days"><b>${sol.N}</b><span>일</span></div><div class="rh-sub"><span class="rh-lbl">타설 계획</span><span class="rh-zones">${sol.N}개 구역 · 하루 1구역</span>${badge}</div>` : '<div class="rh-sub"><span class="rh-fail">구획할 수 없음</span><span class="rh-zones">아래 안내의 버튼으로 조건을 바꿔 보세요.</span></div>'}</div>
      <dl class="res-kpis">${kpi.map(([a, b, c]) => `<div${a === '물량 불균형' ? ` title="가장 치우친 구역이 평균보다 ${b}% 차이 남 (0%면 모든 날 물량이 같음)"` : ''}><dt>${a}</dt><dd>${b}<small>${c}</small></dd></div>`).join('')}</dl>
    </div>`;
}
function rebarPts(M, sol) {
  const out = new Map();
  for (const e of M.edges) {
    if (e.A < 0) continue; const ua = M.unitOf[e.A], ub = M.unitOf[e.B]; if (sol.z[ua] === sol.z[ub]) continue;
    const vert = Math.abs(e.x1 - e.x2) < 1e-9;
    for (const [px, py] of [[e.x1, e.y1], [e.x2, e.y2]]) for (const b of M.beams) {
      if (!b.j.length || (vert ? b.o !== 'h' : b.o !== 'v')) continue;
      const perp = vert ? py : px, al = vert ? px : py;
      if (Math.abs(perp - b.c) < 1e-6 && al > b.a && al < b.b) out.set(px.toFixed(3) + ',' + py.toFixed(3), [px, py]);
    }
  }
  return [...out.values()];
}
function stopsFor(sol) {
  if (!sol) return null;
  const inp = state.inp, key = [inp.truck, inp.tieTol, inp.pourDir].join('|');
  if (sol._stopKey !== key) {
    sol._stop = sol.vol.map((v, k) => stopPlan(state.M, sol.z, k, inp.pourDir, inp.truck, inp.tieTol).best);
    sol._stopKey = key;
  }
  return sol._stop;
}
function renderModelCard() {
  const M = state.M, inp = state.inp; if (!M || !inp) { $('#modelCard').hidden = true; return; }
  const I = state.ifcInfo;
  const cols = I ? I.cols : (inp.columns || []).length, beams = I ? I.beams : (inp.beams || []).length;
  const walls = I ? I.walls : (inp.walls || []).length, open = I ? I.open : (inp.openings || []).length;
  let bar = '';
  if (I && I.slabVol + I.beamVol > 0) {
    const a = I.slabVol / (I.slabVol + I.beamVol) * 100;
    bar = `<div class="mc-bar"><i style="width:${a}%;background:var(--accent)"></i><i style="width:${100 - a}%;background:var(--beam)"></i></div>
      <div class="mc-legend"><span style="color:var(--accent)">슬래브 ${f1(I.slabVol)} ㎥</span><span style="color:var(--beam)">슬래브 아래 보 ${f1(I.beamVol)} ㎥</span></div>`;
  }
  const notes = [];
  for (const w of (I && I.W) || []) {
    let m;
    if ((m = w.match(/X·Y축에서 (-?[\d.]+)°/))) notes.push(`건물이 ${Math.abs(+m[1])}° 돌아가 있어 그리드에 맞게 보정`);
    else if ((m = w.match(/슬래브 (\d+)개를 한 바닥으로/))) notes.push(`바닥 슬래브 ${m[1]}개를 한 층 바닥으로 합침`);
    else if ((m = w.match(/칸막이벽 (\d+)개/))) notes.push(`얇은 칸막이벽 ${m[1]}개는 제외, 구조벽만 반영`);
    else if ((m = w.match(/높이가 다른 슬래브 (\d+)개/))) notes.push(`높이가 다른 슬래브 ${m[1]}개(계단참 등) 제외`);
    else if ((m = w.match(/사선·곡선 (보|벽) (\d+)개/))) notes.push(`사선·곡선 ${m[1]} ${m[2]}개 제외`);
    else if ((m = w.match(/작은 슬래브 조각 (\d+)개\(합계 ([\d.]+) ㎡\)/))) notes.push(`떨어진 작은 조각 ${m[1]}개(${m[2]} ㎡)는 구획에서 제외`);
  }
  for (const w of M.W) { const m = w.match(/구간 (\d+)곳은 큰보가 있다고 가정/); if (m) notes.push(`보가 빠진 기둥 사이 ${m[1]}곳은 큰보로 가정`); }
  if (I) notes.push(state.ifcGrids && state.ifcGrids.length ? `그리드 ${state.ifcGrids.length}개를 레빗 이름 그대로 표시` : 'IFC에 그리드가 없어 기둥 줄 순서로 번호를 붙임(레빗 그리드 이름과 다를 수 있음)');
  $('#mcBody').innerHTML = `
    <div class="mc-hero"><b>${f1(M.C)}</b><span>㎥ · 이 층 콘크리트 총량</span></div>${bar}
    <dl class="mc-grid">
      <div><dt>슬래브 면적</dt><dd>${Math.round(M.totalArea).toLocaleString()}<small>㎡</small></dd></div>
      <div><dt>슬래브 두께</dt><dd>${Math.round(inp.t * 1000)}<small>mm</small></dd></div>
      <div><dt>기둥</dt><dd>${cols}<small>개</small></dd></div>
      <div><dt>보</dt><dd>${beams}<small>개</small></dd></div>
      <div><dt>구조벽</dt><dd>${walls}<small>개</small></dd></div>
      <div><dt>개구부</dt><dd>${open}<small>개</small></dd></div>
    </dl>${notes.length ? `<ul class="mc-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  $('#modelCard').hidden = false;
}
function renderAll(fresh) {
  const M = state.M; if (!M) return;
  const sol = state.R ? state.R.sols[state.sel] : null;
  $('#drawing').innerHTML = drawSVG(M, sol);
  attachZoom($('#drawing').querySelector('svg'));
  const zchk = document.querySelector('[data-layer=zones]');
  zchk.disabled = !sol; zchk.closest('label').classList.toggle('off', !sol);
  zchk.closest('label').title = sol ? '' : '구획 결과가 나왔을 때만 켤 수 있습니다';
  $('#layerNote').textContent = sol ? '' : '구획안이 없어 구획 표시는 꺼져 있습니다.';
  const sh = $('#sheet'); if (fresh) { sh.classList.remove('fresh'); void sh.offsetWidth; sh.classList.add('fresh'); }
  $('#legend').innerHTML = [
    ['var(--girder)', '큰보'], ['var(--beam)', '작은보'], ['var(--wall)', '벽·코어'],
    layerOn('stops') ? ['#1F5FBF', '비상 중단선', 'dashed'] : null, sol && layerOn('struct') ? ['#E8590C', '▲ 보강 필요 이음'] : null, layerOn('cand') ? ['var(--ok)', '절단 가능'] : null, layerOn('cand') ? ['#E03131', '절단 불가', 'dashed'] : null,
    sol ? ['var(--ink)', '타설 이음(구역 경계)'] : null
  ].filter(Boolean).map(([c, t, d]) => `<span><i style="border-color:${c};${d ? 'border-top-style:dashed;border-top-width:3px;width:22px' : ''}"></i>${t}</span>`).join('');
  const inp = state.inp;
  $('#tbTitle').textContent = `${inp.floor || '기준층'} 타설구획도`;
  $('#tbSub').textContent = `${inp.project || '프로젝트 미입력'} · ${new Date().toLocaleDateString('ko-KR')}`;
  const facts = [
    ['총 타설량 C', `${f1(M.C)} ㎥`], ['1일 한도 P', `${inp.P} ㎥`],
    ['구역 수', sol ? `${sol.N} (하한 ${M.Nmin})` : `하한 ${M.Nmin}`], ['최소 타설 단위', `${M.units.length}개`],
    ['절단 후보 가능/불가', `${M.stats.okN} / ${M.stats.ngN}`], ['총 이음 길이', sol ? `${f1(sol.total)} m` : '—']
  ];
  $('#tbFacts').innerHTML = facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
  $('#zoneBlock').hidden = !sol; $('#altBlock').hidden = !sol;
  document.querySelector('.md').classList.toggle('no-list', !sol);
  if (sol) {
    const SP = stopsFor(sol), rec = state.rec, DIRN = { 'X+': 'X+ →', 'X-': 'X− ←', 'Y+': 'Y+ ↑', 'Y-': 'Y− ↓' };
    const doneZone = k => rec && sol.z.every((z, u) => z !== k || rec.done[u]);
    $('#zoneTable').innerHTML = `<thead><tr><th>구역</th><th>타설량</th><th>한도 대비</th><th title="레미콘 대수 = 구역 물량 ÷ 트럭 적재량(올림)">레미콘</th><th title="트럭 한 대분마다 멈출 수 있는 자리가 있는지 (필요 = 차량 − 1)">비상 중단선</th><th title="타설 진행 방향">방향</th></tr></thead><tbody>` +
      sol.vol.map((v, k) => {
        const sp = SP[k]; const empty = sp.segments.filter(s => !s.rep);
        const why = empty.map(s => `${s.lo}~${s.hi}㎥: ${s.cause.type === 'big' ? `큰 단위(${f1(s.cause.vol)} ㎥)가 구간을 덮음` : '멈출 수 있는 자리 없음(남은 쪽 갈라짐·꺾임)'}`).join('\n');
        const tag = sp.need === 0 ? '<span class="sf ok">필요 없음</span>' : sp.safe ? '<span class="sf ok">안전</span>' : `<span class="sf weak" title="${esc(why)}">취약</span>`;
        if (doneZone(k)) return `<tr class="donerow"><td><span class="sw" style="background:#C5CBD1"></span>C${k + 1} <small class="day">완료</small></td><td>${f1(v)} ㎥</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
        return `<tr class="${doneZone(k) ? 'donerow' : ''}"><td><span class="sw" style="background:${zColor(k)}"></span>C${k + 1}${doneZone(k) ? ' <small class="day">완료</small>' : ''}</td><td>${f1(v)} ㎥</td><td class="${v > inp.P ? 'over' : ''}"><span class="gauge"><i style="width:${Math.min(100, v / inp.P * 100)}%"></i></span>${(v / inp.P * 100).toFixed(0)}%</td><td>${sp.trucks}대</td><td>${sp.covered}/${sp.need} ${tag}</td><td>${DIRN[sp.dir]}</td></tr>`;
      }).join('') +
      `<tr class="sum"><td>합계</td><td>${f1(sol.vol.reduce((a, b) => a + b, 0))} ㎥</td><td colspan="4">이음 ${f1(sol.total)} m · 슬래브 + 슬래브 아래 보</td></tr></tbody>`;
    const rp = rebarPts(M, sol).length;
    $('#rebarNote').textContent = rp ? `▲ 작은보가 붙은 큰보를 자르는 이음 ${rp}곳 — 시공이음을 지나는 경사 인장철근으로 전단 보강이 필요합니다 (KCS 14 20 10 3.6.5(1)).` : '';
    $('#candCount').textContent = `${state.R.sols.length}`;
    $('#cands').innerHTML = state.R.sols.map((s, i) => `<button type="button" class="cand" data-i="${i}" aria-pressed="${i === state.sel}">
        <span class="ct">${altName(i)}${i === 0 ? '<i class="rec">1순위</i>' : ''}${state.auto ? '' : `<small>${s.N}구역</small>`}</span>
        ${drawMini(M, s)}
        <span class="cm"><span title="가장 작은 구역의 물량"><em>최소 구역</em><strong>${Math.round(s.minVol)}<u>㎥</u></strong></span><span title="시공이음(스톱엔드) 길이 합"><em>이음 합</em><strong>${Math.round(s.total)}<u>m</u></strong></span></span>
      </button>`).join('');
    $('#altTable').innerHTML = `<thead><tr><th>후보</th><th>구역(일)</th><th>물량 불균형</th><th>최대 구역 (㎥)</th><th>최소 구역 (㎥)</th><th>총 이음 (m)</th></tr></thead><tbody>` +
      state.R.sols.map((s, i) => `<tr data-i="${i}" class="${i === state.sel ? 'sel' : ''}" tabindex="0"><td>${altName(i)}${i === 0 ? ' 추천' : ''}</td><td>${s.N}</td><td>${(s.maxDev * 100).toFixed(1)}%</td><td>${f1(s.maxVol)}</td><td>${f1(s.minVol)}</td><td>${f1(s.total)}</td></tr>`).join('') + '</tbody>';
    $('#detailTitle').innerHTML = `${altName(state.sel)}${state.sel === 0 ? '<i class="rec">1순위</i>' : ''}`;
  }
  $('#detailTitle').hidden = !sol;
  renderBasis(M);
  renderHead();
  renderModelCard();
  recRender();
  $('#exportText').value = csvText();
}

function drawSVG(M, sol) {
  const P = (M.polys || [M.poly]).flat(), xs0 = Math.min(...P.map(p => p[0])), xs1 = Math.max(...P.map(p => p[0])), ys0 = Math.min(...P.map(p => p[1])), ys1 = Math.max(...P.map(p => p[1]));
  const span = Math.max(xs1 - xs0, ys1 - ys0), pad = span * 0.09 + 1.2, fs = Math.max(0.35, span / 42);
  const ex = fs * 2.4; // 비켜 놓은 그리드 동그라미 자리
  const base = [xs0 - pad - ex, -(ys1 + pad + ex), xs1 - xs0 + 2 * pad + ex, ys1 - ys0 + 2 * pad + ex];
  state.baseVB = base;
  const vb = state.view || base;
  const Y = y => -y, o = [];
  const nsw = 'vector-effect="non-scaling-stroke"';
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(v => v.toFixed(3)).join(' ')}" role="img" aria-label="타설 구획 평면도" letter-spacing="0" font-family="Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif">`);
  o.push(`<defs><pattern id="hatch" width="${fs}" height="${fs}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${fs}" height="${fs}" fill="#F6D2CF"/><line x1="0" y1="0" x2="0" y2="${fs}" stroke="#C8423B" stroke-width="${fs * 0.25}"/></pattern></defs>`);
  // 그리드 축: IFC에 레빗 그리드가 있으면 이름·위치 그대로, 없으면 기둥 줄에서 만든 번호
  const G = state.ifcGrids && state.ifcGrids.length ? state.ifcGrids : null;
  const ax = G ? G.filter(g => g.o === 'v').map(g => [g.c, g.tag]) : M.xs.map((x, i) => [x, 'X' + (i + 1)]);
  const ay = G ? G.filter(g => g.o === 'h').map(g => [g.c, g.tag]) : M.ys.map((y, i) => [y, 'Y' + (i + 1)]);
  ax.sort((a, b) => a[0] - b[0]); ay.sort((a, b) => a[0] - b[0]);
  const gapX = fs * 2.1, gapY = fs * 2.1;
  // 붙어 있는 그리드는 이름을 지우지 않고 동그라미를 한 칸 바깥으로 비켜 놓는다
  let lastX = -Infinity, rowX = 0, lastY = -Infinity, rowY = 0;
  const bub = (cx, cy, t) => `<circle cx="${cx}" cy="${cy}" r="${fs * 0.95}" fill="var(--sheet)" stroke="var(--ink)" stroke-width="1" ${nsw}/><text x="${cx}" y="${cy}" font-size="${fs * (t.length > 3 ? 0.72 : 1)}" text-anchor="middle" dominant-baseline="central" fill="var(--ink)">${esc(t)}</text>`;
  for (const [x, t] of ax) {
    rowX = x - lastX < gapX ? (rowX + 1) % 2 : 0; lastX = x;
    const cy = Y(ys1 + pad * 0.72) - rowX * fs * 2.2;
    o.push(`<line x1="${x}" y1="${cy + fs * 0.95}" x2="${x}" y2="${Y(ys0 - pad * 0.3)}" stroke="var(--muted)" stroke-width="0.6" stroke-dasharray="6 3 1 3" ${nsw} opacity=".55"/>`);
    o.push(bub(x, cy, t));
  }
  for (const [y, t] of ay) {
    rowY = y - lastY < gapY ? (rowY + 1) % 2 : 0; lastY = y;
    const cx = xs0 - pad * 0.72 - rowY * fs * 2.2;
    o.push(`<line x1="${cx + fs * 0.95}" y1="${Y(y)}" x2="${xs1 + pad * 0.3}" y2="${Y(y)}" stroke="var(--muted)" stroke-width="0.6" stroke-dasharray="6 3 1 3" ${nsw} opacity=".55"/>`);
    o.push(bub(cx, Y(y), t));
  }
  // 셀 채우기 (가로 방향으로 같은 색 묶음)
  const { X, Y: YY, nx, ny, active, unitOf, units } = M;
  const bigBad = new Set(); units.forEach((u, i) => { if (u.vol > M.P + 1e-6) bigBad.add(i); });
  const colorOf = k => {
    const u = unitOf[k];
    if (bigBad.has(u) && (!sol || !layerOn('zones'))) return 'url(#hatch)';
    if (state.rec && state.rec.pdone[M.pieceOf[k]]) return '#C5CBD1';
    if (state.rec && state.rec.psel.has(M.pieceOf[k])) return '#7E8B97';
    if (sol && layerOn('zones')) return zColor(sol.z[u]);
    return 'var(--cell)';
  };
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      const k = j * nx + i; if (!active[k]) { i++; continue; }
      const c = colorOf(k); let e = i + 1;
      while (e < nx && active[j * nx + e] && colorOf(j * nx + e) === c) e++;
      o.push(`<rect x="${X[i]}" y="${Y(YY[j + 1])}" width="${X[e] - X[i]}" height="${YY[j + 1] - YY[j]}" fill="${c}" stroke="${c.startsWith('url') ? 'none' : c}" stroke-width="0.6" ${nsw}/>`);
      i = e;
    }
  }
  // 개구부·벽
  for (const r of M.openings) o.push(`<rect x="${r[0]}" y="${Y(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="var(--sheet)" stroke="var(--ink)" stroke-width="1" ${nsw}/><path d="M${r[0]} ${Y(r[1])}L${r[2]} ${Y(r[3])}M${r[0]} ${Y(r[3])}L${r[2]} ${Y(r[1])}" stroke="var(--muted)" stroke-width="0.7" ${nsw}/>`);
  for (const r of M.walls) o.push(`<rect x="${r[0]}" y="${Y(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="var(--wall)" stroke="var(--wall)" stroke-width="1" ${nsw}/>`);
  // 슬래브 외곽
  for (const ring of (M.polys || [M.poly])) o.push(`<polygon points="${ring.map(p => p[0] + ',' + Y(p[1])).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="1.6" ${nsw}/>`);
  // 최소 타설 단위 경계
  if (layerOn('units')) for (const e of M.edges) if (e.A >= 0 && unitOf[e.A] !== unitOf[e.B])
    o.push(`<line x1="${e.x1}" y1="${Y(e.y1)}" x2="${e.x2}" y2="${Y(e.y2)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 2" ${nsw}/>`);
  // 보·기둥
  if (layerOn('struct')) {
    for (const b of M.beams) {
      const w = b.kind === 'G' ? 4 : 2.6, col = b.kind === 'G' ? 'var(--girder)' : 'var(--beam)';
      const [x1, y1, x2, y2] = b.o === 'h' ? [b.a, b.c, b.b, b.c] : [b.c, b.a, b.c, b.b];
      o.push(`<line x1="${x1}" y1="${Y(y1)}" x2="${x2}" y2="${Y(y2)}" stroke="${col}" stroke-width="${w}" ${nsw} opacity=".9"/>`);
    }
    const cw = Math.max(0.45, span / 60);
    for (const c of M.cs) o.push(`<rect x="${c[0] - cw / 2}" y="${Y(c[1]) - cw / 2}" width="${cw}" height="${cw}" fill="var(--col)"/>`);
  }
  // 절단 후보
  if (layerOn('cand')) {
    // 같은 선 위에서 이어지는 같은 판정 구간을 하나로 합쳐 그린다 (점선이 조각나 점처럼 보이지 않게)
    const WHY = { mid: '보 가운데 1/3 밖', jn: '작은보 접합부와 너무 가까움', cant: '캔틸레버', wall: '구조벽 관통', open: '개구부 관통' };
    const keyOf = e => (Math.abs(e.x1 - e.x2) < 1e-9 ? 'v' + e.x1.toFixed(3) : 'h' + e.y1.toFixed(3));
    const groups = new Map();
    for (const e of M.edges) if (e.cand) { const k = keyOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const runs = { ok: [], ng: [] };
    for (const [k, es] of groups) {
      const vert = k[0] === 'v';
      es.sort((a, b) => vert ? Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2) : Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
      let cur = null;
      for (const e of es) {
        const s = vert ? Math.min(e.y1, e.y2) : Math.min(e.x1, e.x2), t = vert ? Math.max(e.y1, e.y2) : Math.max(e.x1, e.x2);
        const st = e.ok ? 'ok' : 'ng', why = e.ok ? '' : (WHY[e.why] || '절단 불가');
        if (cur && cur.st === st && cur.why === why && Math.abs(cur.t - s) < 1e-6) cur.t = t;
        else { if (cur) runs[cur.st].push(cur); cur = { st, why, s, t, vert, c: vert ? e.x1 : e.y1 }; }
      }
      if (cur) runs[cur.st].push(cur);
    }
    const seg = r => r.vert ? `x1="${r.c}" y1="${Y(r.s)}" x2="${r.c}" y2="${Y(r.t)}"` : `x1="${r.s}" y1="${Y(r.c)}" x2="${r.t}" y2="${Y(r.c)}"`;
    for (const r of runs.ok) o.push(`<line ${seg(r)} stroke="var(--ok)" stroke-width="1.3" stroke-opacity=".75" ${nsw}><title>절단 가능 — ${SRC.ok}</title></line>`);
    for (const r of runs.ng) o.push(`<line ${seg(r)} stroke="#E03131" stroke-width="2.6" stroke-dasharray="7 5" stroke-linecap="butt" ${nsw}><title>절단 불가 — ${r.why}</title></line>`);
  }
  // 타설 이음 (구역 경계)
  if (sol) {
    for (const e of M.edges) if (e.A >= 0 && sol.z[unitOf[e.A]] !== sol.z[unitOf[e.B]])
      o.push(`<line x1="${e.x1}" y1="${Y(e.y1)}" x2="${e.x2}" y2="${Y(e.y2)}" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="square" ${nsw}/>`);
    for (const [x, y] of sol.bends) o.push(`<circle cx="${x}" cy="${Y(y)}" r="${fs * 0.7}" fill="none" stroke="var(--ng)" stroke-width="2" ${nsw}><title>보 위가 아닌 꺾임</title></circle>`);
    // 라벨
    const N = sol.vol.length;
    for (let k = 0; k < N; k++) {
      let ax2 = 0, ay2 = 0, ar = 0; const cells = [];
      units.forEach((u, i) => { if (sol.z[i] === k) { ax2 += u.cx * u.area; ay2 += u.cy * u.area; ar += u.area; cells.push(...u.cells); } });
      const gx = ax2 / ar, gy = ay2 / ar; let best = null, bd = Infinity;
      for (const c of cells) { const i = c % nx, j = Math.floor(c / nx), cx = (X[i] + X[i + 1]) / 2, cy = (YY[j] + YY[j + 1]) / 2, a = (X[i + 1] - X[i]) * (YY[j + 1] - YY[j]); const d = Math.hypot(cx - gx, cy - gy) - Math.sqrt(a) * 0.6; if (d < bd) { bd = d; best = [cx, cy]; } }
      if (!best) continue;
      const halo = `paint-order="stroke" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="${fs * 0.12}" stroke-linejoin="round"`;
      o.push(`<text x="${best[0]}" y="${Y(best[1]) - fs * 0.15}" font-size="${fs * 1.45}" font-weight="700" text-anchor="middle" fill="#16191C" ${halo}>C${k + 1}</text>`);
      o.push(`<text x="${best[0]}" y="${Y(best[1]) + fs * 1.3}" font-size="${fs * 1.0}" font-weight="600" text-anchor="middle" fill="#16191C" ${halo}>${f1(sol.vol[k])} ㎥</text>`);
    }
  }
  if (sol && layerOn('stops')) {
    const SP = stopsFor(sol);
    const doneK = k => state.rec && sol.z.every((z, q) => z !== k || state.rec.done[q]);
    SP.forEach((sp, k) => sp.segments.forEach((sg, t) => {
      if (!sg.rep || doneK(k)) return;
      for (const s of sg.rep.segs) o.push(`<line x1="${s[0]}" y1="${Y(s[1])}" x2="${s[2]}" y2="${Y(s[3])}" stroke="#1F5FBF" stroke-width="2.6" stroke-dasharray="6 4" ${nsw}><title>C${k + 1} 비상 중단선 ${t + 1} — ${t + 1}번째 차까지 약 ${f1(sg.rep.cum)} ㎥, 스톱엔드 ${f1(sg.rep.len)} m</title></line>`);
      const s0 = sg.rep.segs[Math.floor(sg.rep.segs.length / 2)]; if (!s0) return;
      const cx = (s0[0] + s0[2]) / 2, cy = (s0[1] + s0[3]) / 2;
      o.push(`<circle cx="${cx}" cy="${Y(cy)}" r="${fs * 0.62}" fill="#1F5FBF"/><text x="${cx}" y="${Y(cy)}" font-size="${fs * 0.72}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#fff">${t + 1}</text>`);
    }));
  }
  // 콜드조인트: 같은 최소 타설 단위 안에서 친 조각과 안 친 조각의 경계
  if (state.rec) for (const e of M.edges) {
    if (e.A < 0) continue; const pa = M.pieceOf[e.A], pb = M.pieceOf[e.B];
    if (pa === pb || M.unitOf[e.A] !== M.unitOf[e.B] || state.rec.pdone[pa] === state.rec.pdone[pb]) continue;
    o.push(`<line x1="${e.x1}" y1="${Y(e.y1)}" x2="${e.x2}" y2="${Y(e.y2)}" stroke="#D0021B" stroke-width="3.2" ${nsw}><title>콜드조인트 — 계획하지 않은 이음, 책임기술자 검토</title></line>`);
  }
  // 경사 인장철근 보강 필요 지점
  if (sol && layerOn('struct')) for (const [px, py] of rebarPts(M, sol)) {
    const s = fs * 0.55; o.push(`<path d="M${px} ${Y(py) - s} L${px + s} ${Y(py) + s * 0.7} L${px - s} ${Y(py) + s * 0.7} Z" fill="#E8590C" stroke="#fff" stroke-width="0.6" ${nsw}><title>작은보가 붙은 큰보를 자르는 이음 — 경사 인장철근으로 전단 보강 필요 (KCS 14 20 10 3.6.5(1))</title></path>`);
  }
  if (sol && M.linked && M.linked.length) for (const L of M.linked) {
    const halo = `paint-order="stroke" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="${fs * 0.12}" stroke-linejoin="round"`;
    let a = 0, sx = 0, sy = 0; for (const u of L.units) { const U0 = M.units[u]; a += U0.area; sx += U0.cx * U0.area; sy += U0.cy * U0.area; }
    const k = sol.z[L.units[0]], cx = sx / a, cy = sy / a;
    o.push(`<text x="${cx}" y="${Y(cy)}" font-size="${fs * 0.9}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#16191C" ${halo}><title>떨어진 바닥 — C${k + 1}과 같은 날 함께 타설</title>C${k + 1}</text>`);
  }
  o.push('</svg>');
  return o.join('');
}

// 판정 근거 (규칙 문서의 기준표 그대로)
const SRC = {
  ok: 'KCS 14 20 10 3.6.5(1) — 가운데 구간 수치는 ACI 318-14 26.5.6.2(b) 참조',
  mid: 'KCS 14 20 10 3.6.5(1), 3.6.1(1) — 가운데 1/3 수치는 ACI 318-14 26.5.6.2(b) 참조',
  jn: 'KCS 14 20 10 3.6.5(1) 단서',
  wall: '물리적 제약',
  cant: 'KCS 14 20 10 3.6.4(1)',
  bend: '시공성 (스톱엔드 지지)',
  line: 'KCS 14 20 10 3.6.2(1), 3.7.1(3) + 시공성',
  conn: 'KCS 14 20 10 3.7.1(2) — 인접 그래프 씨앗 확장으로 강제'
};
function basisRows(M) {
  const w = M.stats.why, R = state.Rinfo;
  return [
    ['절단 가능 (규칙 1·2 충족)', M.stats.okN, SRC.ok],
    ['불가: 가운데 구간 밖 (규칙 1)', w.mid, SRC.mid],
    ['불가: 작은보 접합부 이격 부족 (규칙 2)', w.jn, SRC.jn],
    ['불가: 구조벽 통과 (규칙 3)', w.wall, SRC.wall],
    ['불가: 개구부 통과 (규칙 3)', w.open || 0, SRC.wall],
    ['불가: 캔틸레버 (규칙 4)', w.cant, SRC.cant],
    ['제외된 배정: 보 위가 아닌 꺾임 (규칙 3)', R ? R.bentN : 0, SRC.bend],
    ['절단선: 그리드와 나란한 직선만 (규칙 5)', '전체 적용', SRC.line],
    ['구역: 하나로 연결 (규칙 6)', '전체 적용', SRC.conn]
  ];
}
function renderBasis(M) {
  $('#basis').innerHTML = `<table><thead><tr><th>판정</th><th>개수</th><th>근거</th></tr></thead><tbody>` +
    basisRows(M).map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="src">${r[2]}</td></tr>`).join('') + '</tbody></table>';
}

function drawMini(M, sol) {
  const P = (M.polys || [M.poly]).flat(), x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), y0 = Math.min(...P.map(p => p[1])), y1 = Math.max(...P.map(p => p[1]));
  const w = x1 - x0, h = y1 - y0, pad = Math.max(w, h) * 0.04;
  // 4:3 틀 안에 가운데 정렬
  let vw = w + 2 * pad, vh = h + 2 * pad; if (vw / vh > 4 / 3) vh = vw * 3 / 4; else vw = vh * 4 / 3;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const o = [`<svg viewBox="${cx - vw / 2} ${-(cy + vh / 2)} ${vw} ${vh}" aria-hidden="true">`];
  const { X, Y, nx, ny, active, unitOf } = M, nsw = 'vector-effect="non-scaling-stroke"';
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      const k = j * nx + i; if (!active[k]) { i++; continue; }
      const zk = sol.z[unitOf[k]]; let e = i + 1;
      while (e < nx && active[j * nx + e] && sol.z[unitOf[j * nx + e]] === zk) e++;
      const c = zColor(zk);
      o.push(`<rect x="${X[i]}" y="${-Y[j + 1]}" width="${X[e] - X[i]}" height="${Y[j + 1] - Y[j]}" fill="${c}" stroke="${c}" stroke-width="0.5" ${nsw}/>`);
      i = e;
    }
  }
  for (const r of M.walls) o.push(`<rect x="${r[0]}" y="${-r[3]}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="var(--wall)"/>`);
  let d = '';
  for (const e of M.edges) if (e.A >= 0 && sol.z[unitOf[e.A]] !== sol.z[unitOf[e.B]]) d += `M${e.x1} ${-e.y1}L${e.x2} ${-e.y2}`;
  o.push(`<path d="${d}" stroke="#1D2A30" stroke-width="1.8" fill="none" stroke-linecap="square" ${nsw}/>`);
  for (const ring of (M.polys || [M.poly])) o.push(`<polygon points="${ring.map(p => p[0] + ',' + (-p[1])).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="1" ${nsw}/>`);
  o.push('</svg>');
  return o.join('');
}

// ----- 도면 확대·축소·이동 -----
function setVB(v) {
  const svg = $('#drawing').querySelector('svg'); if (!svg) return;
  state.view = v; svg.setAttribute('viewBox', v.map(n => n.toFixed(4)).join(' '));
}
function zoomBy(k, fx, fy) {
  const b = state.baseVB; if (!b) return;
  const v = (state.view || b).slice();
  const nw = Math.min(b[2] * 1.5, Math.max(b[2] / 60, v[2] * k)), s = nw / v[2], nh = v[3] * s;
  setVB([v[0] + (v[2] - nw) * (fx === undefined ? 0.5 : fx), v[1] + (v[3] - nh) * (fy === undefined ? 0.5 : fy), nw, nh]);
}
function attachZoom(svg) {
  if (!svg || svg.dataset.zoom) return;
  svg.dataset.zoom = '1';
  const box = $('#drawing');
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomBy(Math.exp(e.deltaY * 0.0018), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  const pts = new Map(); let start = null;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    start = { v: (state.view || state.baseVB).slice(), list: Array.from(pts.values()), rect: svg.getBoundingClientRect() };
    box.classList.add('drag');
  });
  svg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const now = Array.from(pts.values()), v = start.v, r = start.rect;
    if (now.length === 1 && start.list.length === 1) {
      setVB([v[0] - (now[0][0] - start.list[0][0]) / r.width * v[2], v[1] - (now[0][1] - start.list[0][1]) / r.height * v[3], v[2], v[3]]);
    } else if (now.length >= 2 && start.list.length >= 2) {
      const d0 = Math.hypot(start.list[0][0] - start.list[1][0], start.list[0][1] - start.list[1][1]) || 1;
      const d1 = Math.hypot(now[0][0] - now[1][0], now[0][1] - now[1][1]) || 1;
      const b = state.baseVB;
      const nw = Math.min(b[2] * 1.5, Math.max(b[2] / 60, v[2] * d0 / d1)), nh = v[3] * nw / v[2];
      const fx = ((now[0][0] + now[1][0]) / 2 - r.left) / r.width, fy = ((now[0][1] + now[1][1]) / 2 - r.top) / r.height;
      setVB([v[0] + (v[2] - nw) * fx, v[1] + (v[3] - nh) * fy, nw, nh]);
    }
  });
  const up = e => { pts.delete(e.pointerId); start = pts.size ? null : null; if (!pts.size) box.classList.remove('drag'); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}
$('#zIn').addEventListener('click', () => zoomBy(1 / 1.4));
$('#zOut').addEventListener('click', () => zoomBy(1.4));
$('#zFit').addEventListener('click', () => { if (state.baseVB) setVB(state.baseVB.slice()); });

function csvText() {
  const sol = state.R ? state.R.sols[state.sel] : null; if (!sol) return '';
  const lines = ['구역,타설량(m3),면적(m2),한도대비(%),구역둘레이음(m)'];
  sol.vol.forEach((v, k) => lines.push(`C${k + 1},${f1(v)},${f1(sol.area[k])},${(v / state.inp.P * 100).toFixed(0)},${f1(sol.joint[k])}`));
  lines.push(`합계,${f1(sol.vol.reduce((a, b) => a + b, 0))},${f1(state.M.totalArea)},,${f1(sol.total)}`);
  lines.unshift(`선택한 안,${altName(state.sel)}`);
  lines.push('', '안,구역수(일),물량불균형(%),최대구역(m3),최소구역(m3),총이음(m),특징');
  state.R.sols.forEach((s, i) => lines.push(`${altName(i)},${s.N},${(s.maxDev * 100).toFixed(1)},${f1(s.maxVol)},${f1(s.minVol)},${f1(s.total)},${(s.tags || []).join(' / ')}`));
  lines.push('', '판정,개수,근거');
  basisRows(state.M).forEach(r => lines.push(`${r[0]},${r[1]},"${r[2]}"`));
  return lines.join('\n');
}
function inputJSON() {
  const { inp } = readInputs();
  const o = { project: inp.project, floor: inp.floor, slab: inp.slab, slabs: inp.slabs, t: inp.t, C: isFinite(inp.C) ? inp.C : null, columns: inp.columns, beams: inp.beams, walls: inp.walls, openings: inp.openings, P: inp.P, N: isFinite(inp.N) ? inp.N : null, ratio: $('#ratio').value, mult: inp.mult, defW: inp.defW, minCut: inp.minCut, cantMin: inp.cantMin, gridTol: inp.gridTol, minWallT: inp.minWallT, cantExt: inp.cantExt };
  return JSON.stringify(o, null, 1);
}
function download(name, text, type) {
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { /* 저장이 막힌 환경 */ }
  $('#exportText').value = text; $('#exportText').select();
}

const openDrawer = () => document.body.classList.add('drawer-open');
const closeDrawer = () => document.body.classList.remove('drawer-open');
document.addEventListener('click', e => { if (e.target.closest('#openDrawer')) openDrawer(); });
$('#closeDrawer').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
document.addEventListener('click', e => {
  if (!document.body.classList.contains('drawer-open')) return;
  if (e.target.closest('#panel') || e.target.closest('#openDrawer')) return;
  closeDrawer();
});

// ===== 3장 — 시공 중 기록·재분할 (G~K) =====
// 기록은 '조각' 단위(후보선·벽·개구부·슬래브 끝으로 나뉜 칸). 최소 타설 단위 안에서 멈추면 계획하지 않은 이음 = 콜드조인트
const recKey = () => 'pz:' + (state.inp ? (state.inp.project || '') + '|' + (state.inp.floor || '') : '');
function recOn() {
  const M = state.M, sol = state.R && state.R.sols[state.sel]; if (!M || !sol) return;
  state.rec = { day: 1, pdone: new Uint8Array(M.pieces.length), psel: new Set(), done: new Uint8Array(M.units.length), log: [], warn: [], result: null,
    versions: [{ label: 'v1 원래 계획 (' + altName(state.sel) + ')', z: Array.from(sol.z), at: new Date().toLocaleString('ko-KR') }] };
}
function recSync() {
  // 조각 기록 → 단위 상태: 전부 친 단위(done), 일부만 친 단위(partial, 남은 물량)
  const M = state.M, R0 = state.rec, n = M.units.length, left = new Float64Array(n), tot = new Uint8Array(n), got = new Uint8Array(n);
  M.pieces.forEach((p, i) => { tot[p.unit]++; if (R0.pdone[i]) got[p.unit]++; else left[p.unit] += p.vol; });
  R0.done = new Uint8Array(n); R0.partial = new Map();
  for (let u = 0; u < n; u++) { if (got[u] === tot[u]) R0.done[u] = 1; else if (got[u] > 0) R0.partial.set(u, left[u]); }
}
function recWithVol(fn) {
  // 일부만 친 단위는 남은 물량으로 계산한 뒤 되돌린다
  const U = state.M.units, keep = []; for (const [u, v] of state.rec.partial || []) { keep.push([u, U[u].vol]); U[u].vol = v; }
  try { return fn(); } finally { for (const [u, v] of keep) U[u].vol = v; }
}
function recRender() {
  const P = $('#recPanel'), R0 = state.rec; $('#recToggle').setAttribute('aria-pressed', String(!!R0)); P.hidden = !R0;
  $('#drawing').classList.toggle('recmode', !!R0); $('#recHint').hidden = !!R0;
  if (!R0) return;
  const pc = state.M.pieces, selV = [...R0.psel].reduce((a, p) => a + pc[p].vol, 0), res = R0.result;
  P.innerHTML = `
    <div class="rp-row"><b>${R0.day}일차 기록</b><span>도면에서 오늘 친 구역을 누르세요. 다시 누르면 조각을 하나씩 빼거나 더합니다.</span></div>
    <div class="rp-row">선택 조각 ${R0.psel.size}개 · ${f1(selV)} ㎥
      <button type="button" id="recSave" ${R0.psel.size ? '' : 'disabled'}>오늘 친 범위 저장</button>
      <button type="button" id="recClear" ${R0.psel.size ? '' : 'disabled'}>선택 비우기</button></div>
    ${R0.warn.length ? `<div class="rp-warn">${R0.warn.map(esc).join('<br>')}</div>` : ''}
    ${R0.log.length ? `<div class="rp-row">오늘 타설 가능량 <input type="number" id="recP" min="1" step="1" value="${state.inp.P}"> ㎥
      <button type="button" id="recMin">최소 변경으로 다시 나누기</button><button type="button" id="recFull">전체 다시 나누기</button></div>` : ''}
    ${res ? `<div class="rp-result">${res.html}</div>` : ''}
    <div class="rp-log">기록: ${R0.log.length ? R0.log.map(l => `${l.day}일차 ${f1(l.vol)} ㎥${l.cold ? ' (콜드조인트)' : ''}`).join(' · ') : '아직 없음'}<br>버전: ${R0.versions.map(v => esc(v.label)).join(' · ')}</div>
    <div class="rp-row"><button type="button" id="recExport">기록 파일로 내보내기</button><button type="button" id="recImport">기록 파일 불러오기</button>
      <span class="rp-note">공급이 끊겨 이어치기 허용시간(외기 25 ℃ 초과 2.0시간, 이하 2.5시간)을 넘길 것 같으면 가장 가까운 비상 중단선에서 멈추세요.</span></div>`;
}
function pieceAt(e) {
  const svg = $('#drawing svg'); if (!svg) return -1;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse()), x = p.x, y = -p.y, M = state.M;
  const find = (A, v) => { if (v < A[0] || v > A[A.length - 1]) return -1; let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const i = find(M.X, x), j = find(M.Y, y); if (i < 0 || j < 0) return -1;
  const k = j * M.nx + i; return M.active[k] ? M.pieceOf[k] : -1;
}
let recDown = null;
$('#drawing').addEventListener('pointerdown', e => { recDown = [e.clientX, e.clientY]; });
$('#drawing').addEventListener('click', e => {
  const R0 = state.rec; if (!R0 || !recDown || Math.hypot(e.clientX - recDown[0], e.clientY - recDown[1]) > 5) return;
  const p = pieceAt(e); if (p < 0 || R0.pdone[p]) return;
  const M = state.M, sol = state.R.sols[state.sel], k = sol.z[M.pieces[p].unit];
  const zoneSel = [...R0.psel].some(q => sol.z[M.pieces[q].unit] === k);
  if (!zoneSel) M.pieces.forEach((pc, q) => { if (sol.z[pc.unit] === k && !R0.pdone[q]) R0.psel.add(q); });
  else if (R0.psel.has(p)) R0.psel.delete(p); else R0.psel.add(p);
  renderAll(false);
});
function recSave() {
  const R0 = state.rec, M = state.M, U = M.units, sol = state.R.sols[state.sel];
  const ps = [...R0.psel], vol = ps.reduce((a, p) => a + M.pieces[p].vol, 0);
  for (const p of ps) R0.pdone[p] = 1;
  recSync(); R0.warn = [];
  if (R0.partial.size) R0.warn.push(`콜드조인트: 최소 타설 단위 ${R0.partial.size}곳을 중간에서 멈췄습니다. 계획하지 않은 이음이므로 책임기술자 검토가 필요합니다(KCS 14 20 10 콜드조인트). 이후 재분할에서는 이 자리를 실제 경계로 봅니다.`);
  const zones = [...new Set(ps.map(p => sol.z[M.pieces[p].unit]))];
  for (const k of zones) {
    const left = new Set(); sol.z.forEach((z, v) => { if (z === k && !R0.done[v]) left.add(v); });
    if (!left.size) continue;
    let bad = !rzConnected(M, left);
    if (!bad) { const z2 = sol.z.map((z, v) => R0.done[v] ? -9 : z); for (const v of left) z2[v] = 1e6; const nodes = new Set(); sol.z.forEach((z, v) => { if (z === k) for (const nd of U[v].nodes) nodes.add(nd); }); for (const nd of nodes) if (bendAtNode(M, z2, nd)) { bad = true; break; } }
    if (bad) R0.warn.push(`C${k + 1}: 비상 중단선이 아닌 곳에서 멈췄습니다 (남은 쪽이 갈라지거나 슬래브 한가운데서 꺾임) — 검토 필요`);
  }
  R0.log.push({ day: R0.day, pieces: ps, vol, zones, cold: R0.partial.size > 0 }); R0.day++; R0.psel.clear(); R0.result = null;
}
function recNormalize(z) { const ids = [...new Set(z)].sort((a, b) => a - b), map = new Map(ids.map((k, i) => [k, i])); return z.map(k => map.get(k)); }
function recDiff(M, oldZ, newZ, done) {
  const a = rzEval(M, oldZ, done), b = rzEval(M, newZ, done);
  let added = 0, removed = 0; for (const [p, l] of b.pairs) if (!a.pairs.has(p)) added += l; for (const [p, l] of a.pairs) if (!b.pairs.has(p)) removed += l;
  const setsOf = z => { const m = new Map(); z.forEach((k, u) => { if (done[u]) return; if (!m.has(k)) m.set(k, []); m.get(k).push(u); }); return [...m.values()].map(x => x.join(',')); };
  const A = new Set(setsOf(oldZ)); return { changed: setsOf(newZ).filter(s => !A.has(s)).length, added, removed };
}
function recPropose(kind, absorb) {
  const R0 = state.rec, M = state.M, sol = state.R.sols[state.sel], inp = state.inp;
  const Pt = num('recP') > 0 ? num('recP') : inp.P; let z = null, msgs = [], extra = '';
  recWithVol(() => {
    if (kind === 'min') {
      const r = rezoneMinimal(M, sol.z, R0.done, Pt, inp.P, inp.truck, k => stopsFor(sol)[k].order);
      z = r.z.map((k, u) => R0.done[u] ? sol.z[u] - 100000 : k); msgs = r.msgs;
      if (r.absorb && absorb === undefined) extra = `<div>오늘 여유가 ${f1(r.slack)} ㎥(트럭 한 대분 이상)입니다. C${r.absorb.from + 1}의 단위 ${r.absorb.units.length}개(${f1(r.absorb.vol)} ㎥)를 오늘 구역에 흡수할까요?
        <button type="button" id="recAbsYes">흡수</button> <button type="button" id="recAbsNo">그대로</button></div>`;
      if (r.absorb && absorb) for (const u of r.absorb.units) z[u] = r.today;
    } else {
      const r = rezoneFull(M, R0.done, Pt, Date.now() + 14000, inp.P);
      if (!r.z) { R0.result = { html: `<div class="rp-warn">${esc(r.msg)}${r.need ? ` 필요한 최소 타설량 ${f1(r.need)} ㎥` : ''}</div>` }; return; }
      z = r.z.map((k, u) => R0.done[u] ? sol.z[u] - 100000 : k);
    }
  });
  if (!z) return;
  const nz = recNormalize(z), d = recDiff(M, recNormalize(sol.z), nz, R0.done);
  let bent = false; const nodes = new Set(); nz.forEach((k, u) => { if (!R0.done[u]) for (const nd of M.units[u].nodes) nodes.add(nd); });
  const zb = nz.map((k, u) => R0.done[u] ? -9 : k); for (const nd of nodes) if (bendAtNode(M, zb, nd)) { bent = true; break; }
  if (bent) msgs.push('새 경계가 슬래브 한가운데서 꺾입니다(규칙 3). 전체 재분할을 권장합니다.');
  R0.result = { z: nz, kind, html: `<b>${kind === 'min' ? '최소 변경' : '전체 재분할'} 결과</b>
    <div>바뀐 구역 ${d.changed}개 · 새로 생긴 이음 ${f1(d.added)} m · 사라진 이음 ${f1(d.removed)} m</div>
    ${msgs.length ? `<div class="rp-warn">${msgs.map(esc).join('<br>')}</div>` : ''}${extra}
    <div class="rp-row"><button type="button" id="recApply" class="primary">이 계획으로 바꾸고 새 버전 저장</button></div>` };
}
function recApply() {
  const R0 = state.rec, M = state.M, res = R0.result; if (!res || !res.z) return;
  const K = Math.max(...res.z) + 1;
  // 일부만 친 단위는 남은 물량만 남은 구역에, 이미 친 부분은 가장 최근 완료 구역에 넣어 총량을 보존한다
  const ev = recWithVol(() => evaluate(M, res.z, K, M.C / K));
  let poured = 0; for (const [u, left] of R0.partial || []) poured += M.units[u].vol - left;
  if (poured > 1e-9) { const doneKs = [...new Set(res.z.filter((k, u) => R0.done[u]))]; if (doneKs.length) ev.vol[Math.max(...doneKs)] += poured; }
  state.R.sols.splice(state.sel, 1, { z: res.z, ...ev, N: K, tags: [] });
  R0.versions.push({ label: `v${R0.versions.length + 1} ${R0.day - 1}일차 후 ${res.kind === 'min' ? '최소 변경' : '전체 재분할'}`, z: Array.from(res.z), at: new Date().toLocaleString('ko-KR') });
  R0.result = null;
  try { localStorage.setItem(recKey(), JSON.stringify(recDump())); } catch (e) {}
}
function recDump() {
  const R0 = state.rec, M = state.M;
  return { kind: 'pour-zoning-record', v: 1, project: state.inp.project, floor: state.inp.floor, P: state.inp.P, units: M.units.length, pieces: M.pieces.length,
    day: R0.day, pdone: Array.from(R0.pdone), log: R0.log, versions: R0.versions, savedAt: new Date().toISOString() };
}
function recDownload(name, text, type) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
  $('#exportText').value = text;
}
function recExport() {
  const d = recDump(), base = `타설기록_${(d.project || '프로젝트').replace(/[\\/:*?"<>|\s]+/g, '_')}_${(d.floor || '층').replace(/\s+/g, '')}`;
  recDownload(base + '.json', JSON.stringify(d, null, 1), 'application/json');
  const rows = ['일차,타설량(m3),구역,콜드조인트'].concat(d.log.map(l => `${l.day},${f1(l.vol)},${l.zones.map(k => 'C' + (k + 1)).join(' ')},${l.cold ? '예' : ''}`));
  recDownload(base + '.csv', '\ufeff' + rows.join('\n'), 'text/csv');
}
function recImport(text) {
  const d = JSON.parse(text), M = state.M;
  if (d.kind !== 'pour-zoning-record') throw new Error('타설 기록 파일이 아닙니다.');
  if (d.units !== M.units.length || d.pieces !== M.pieces.length) throw new Error('지금 모델·층·규칙 설정과 맞지 않는 기록입니다. 같은 파일과 조건으로 구획한 뒤 불러오세요.');
  if (!state.rec) recOn();
  const R0 = state.rec; R0.pdone = Uint8Array.from(d.pdone); R0.log = d.log; R0.versions = d.versions; R0.day = d.day; R0.psel.clear(); R0.result = null; recSync();
  const last = d.versions[d.versions.length - 1]; if (last) { const K = Math.max(...last.z) + 1; state.R.sols.splice(state.sel, 1, { z: last.z, ...evaluate(M, last.z, K, M.C / K), N: K, tags: [] }); }
}
$('#recToggle').addEventListener('click', () => { if (state.rec) state.rec = null; else { recOn(); recSync(); } renderAll(false); });
$('#recFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try { recImport(r.result); } catch (err) { alert(err.message); } renderAll(false); e.target.value = ''; }; r.readAsText(f, 'utf-8'); });
$('#recPanel').addEventListener('click', e => {
  const id = e.target.id; if (!id) return;
  if (id === 'recSave') recSave(); else if (id === 'recClear') state.rec.psel.clear();
  else if (id === 'recExport') { recExport(); return; } else if (id === 'recImport') { $('#recFile').click(); return; }
  else if (id === 'recMin') recPropose('min'); else if (id === 'recFull') recPropose('full');
  else if (id === 'recAbsYes') recPropose('min', true); else if (id === 'recAbsNo') recPropose('min', false);
  else if (id === 'recApply') recApply(); else return;
  renderAll(false);
});

$('#run').addEventListener('click', run);
$('#P').addEventListener('input', () => { if (num('P') > 0) { $('#P').classList.remove('invalid'); $('#pErr').hidden = true; } });
$('#msgs').addEventListener('click', e => { const b = e.target.closest('.inline-btn'); if (!b) return; if (b.dataset.time) state.searchTime = +b.dataset.time; else if (b.dataset.p) $('#P').value = b.dataset.p; else $('#N').value = b.dataset.n; run(); });
$('#example').addEventListener('click', () => { state.ifcInfo = null; state.ifcGrids = null; state.ifcCslab = 0; fill(EXAMPLE); $('#formNote').textContent = '예제 값(가상의 보 구조 건물)입니다.'; run(); });
document.querySelectorAll('[data-layer]').forEach(c => c.addEventListener('change', () => renderAll(false)));
$('#cands').addEventListener('click', e => {
  const b = e.target.closest('.cand'); if (!b) return;
  if (state.rec) { if (!confirm('시공 기록 중입니다. 다른 안으로 바꾸면 기록이 사라집니다. 바꿀까요?')) return; state.rec = null; }
  state.sel = +b.dataset.i; renderAll(false);
  if (window.matchMedia('(max-width:980px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('click', e => {
  const b = e.target.closest('.sortseg button'); if (!b) return;
  state.sortKey = b.dataset.sort;
  document.querySelectorAll('.sortseg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  sortSols(state.R ? state.R.sols[state.sel] : null); renderAll(false);
});
$('#altTable').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; state.sel = +tr.dataset.i; renderAll(false); });
$('#altTable').addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr[data-i]'); if (!tr) return; e.preventDefault(); state.sel = +tr.dataset.i; renderAll(false); });
$('#dlCsv').addEventListener('click', () => download(`타설구획_${state.inp?.floor || ''}.csv`, '\uFEFF' + csvText(), 'text/csv'));
$('#dlSvg').addEventListener('click', () => { const svg = $('#drawing').innerHTML; download(`타설구획_${state.inp?.floor || ''}.svg`, svg, 'image/svg+xml'); });
$('#dlJson').addEventListener('click', () => download('입력값.json', inputJSON(), 'application/json'));
function applyJSON(text) {
  try { const o = JSON.parse(text); fill(o); showLoaded(); }
  catch (e) { $('#empty').hidden = true; $('#out').hidden = false; $('#sheet').hidden = true; showMsgs([['err', 'JSON을 읽지 못했습니다: ' + esc(e.message)]]); }
}
function showLoaded() { $('#jsonText').value = ''; $('#run').focus(); }
$('#jsonLoad').addEventListener('click', () => applyJSON($('#jsonText').value));
$('#jsonFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => applyJSON(r.result); r.readAsText(f, 'utf-8'); });

// ----- IFC 업로드 -----
// SAMPLE_IFC 는 js/sample.js 에 있습니다.
let IFCM = null;
function ifcStatus(html, kind) { const el = $('#ifcStatus'); el.className = 'ifc-status ' + (kind || ''); el.innerHTML = html; }
// 모델 값 입력칸을 비운다(하루 한도·규칙 설정은 그대로 둠)
function clearModelFields(msg) {
  for (const id of ['project', 'floor', 't', 'C']) $('#' + id).value = '';
  for (const id of ['slab', 'columns', 'beams', 'walls', 'openings']) { $('#' + id).value = ''; }
  $('#slab').placeholder = msg || '';
  $('#columns').placeholder = msg || '';
  $('#formNote').textContent = msg || '';
}
function loadIFCText(text, name) {
  ifcStatus('모델을 읽는 중…');
  $('#ifcPick').hidden = true;
  setTimeout(() => {
    try {
      const t0 = performance.now();
      IFCM = IFCReader.parse(text);
      const cand = IFCM.storeys.filter(s => s.count.slab > 0);
      if (!IFCM.storeys.length) throw new Error('층(IfcBuildingStorey) 정보가 없습니다.');
      if (!cand.length) throw new Error('슬래브(바닥)가 있는 층이 없습니다. IFC 내보내기에서 바닥이 포함됐는지 확인하세요.');
      const sel = $('#storey');
      sel.innerHTML = IFCM.storeys.map(s => `<option value="${s.id}" ${s.count.slab ? '' : 'disabled'}>${esc(s.name)} (슬래브 ${s.count.slab}, 기둥 ${s.count.column}, 보 ${s.count.beam})${s.count.found ? ' · 기초판' : ''}</option>`).join('');
      const best = cand.slice().sort((a, b) => (b.count.beam - a.count.beam) || (b.elev - a.elev))[0];
      sel.value = best.id;
      $('#ifcPick').hidden = false;
      $('#fileName').textContent = name; state.fileName = name; $('#fileChip').hidden = false; $('#modelCard').hidden = true; state.ifcInfo = null; state.ifcGrids = null;
      setStage('pick');
      clearModelFields(`${name} — 층을 고르고 [이 층 구획하기]를 누르면 여기에 채워집니다.`);
      ifcStatus(`<span class="sum-chips"><span>층 ${IFCM.storeys.length}개</span><span>객체 ${IFCM.count.toLocaleString()}개</span></span>`, 'ok');
    } catch (e) { IFCM = null; ifcStatus('모델을 읽지 못했습니다: ' + esc(e.message), 'err'); }
  }, 30);
}
function handleFile(f) {
  if (!f) return;
  if (/\.rvt$/i.test(f.name) || /\.rfa$/i.test(f.name)) {
    ifcStatus(`Revit 원본 파일(.rvt)은 Autodesk 전용 형식이라 브라우저에서 열 수 없습니다. Revit에서 IFC로 한 번 저장해 올려주세요.<ol><li>Revit에서 모델 열기</li><li>파일 → 내보내기 → IFC</li><li>IFC 버전은 기본값(IFC 2x3 또는 IFC4) 그대로 → 내보내기</li><li>저장된 .ifc 파일을 여기에 올리기</li></ol>`, 'err');
    return;
  }
  if (/\.(ifczip|zip)$/i.test(f.name)) {
    ifcStatus('압축된 IFC(.ifczip/.zip)는 바로 읽을 수 없습니다. 압축을 풀어 나온 .ifc 파일을 올려주세요. Revit에서 내보낼 때 "IFC 압축" 옵션을 끄면 처음부터 .ifc로 저장됩니다.', 'err');
    return;
  }
  if (/\.ifcxml$/i.test(f.name)) { ifcStatus('ifcXML 형식은 지원하지 않습니다. 일반 .ifc(STEP) 형식으로 내보내 주세요.', 'err'); return; }
  if (f.size > 400 * 1024 * 1024) { ifcStatus(`파일이 너무 큽니다(${(f.size / 1048576).toFixed(0)} MB). 구획할 층만 보이게 한 뷰로 IFC를 내보내면 크기가 크게 줄어듭니다.`, 'err'); return; }
  const r = new FileReader();
  r.onload = () => {
    // UTF-8로 먼저 읽고, 깨지는 글자가 나오면 ISO-8859-1(IFC 표준 인코딩)로 다시 읽는다
    let text = new TextDecoder('utf-8').decode(r.result);
    if (text.indexOf('\uFFFD') >= 0) text = new TextDecoder('iso-8859-1').decode(r.result);
    loadIFCText(text, f.name);
  };
  r.onerror = () => ifcStatus('파일을 읽지 못했습니다.', 'err');
  ifcStatus('파일을 여는 중…');
  r.readAsArrayBuffer(f);
}
$('#ifcFile').addEventListener('change', e => handleFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
// 화면 어디에 끌어다 놓아도 파일을 읽는다 (결과 화면 제외)
let dragDepth = 0;
const canDrop = () => document.body.dataset.stage !== 'result';
document.addEventListener('dragenter', e => { if (!canDrop() || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', e => { if (canDrop()) e.preventDefault(); });
document.addEventListener('drop', e => {
  dragDepth = 0; document.body.classList.remove('dragging');
  if (!canDrop() || e.target.closest('#drop')) return;
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f);
});
$('#heroSample').addEventListener('click', () => $('#ifcSample').click());
$('#heroOpen').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#ifcFile').click(); } });
$('#ifcSample').addEventListener('click', () => { if (!(num('P') > 0)) { $('#P').value = 35; } loadIFCText(SAMPLE_IFC, '예제_RC_업무시설.ifc'); });
$('#ifcRun').addEventListener('click', () => {
  if (!requireP()) return;
  if (!IFCM || $('#ifcPick').hidden) { run(); return; }
  try {
    const r = IFCM.extract(+$('#storey').value, { minWallT: num('minWallT') > 0 ? num('minWallT') : 0.2 });
    if (r.foundation) {
      ifcStatus(`<b>${esc(r.floor)}</b> 바닥은 두께 ${Math.round(r.t * 1000)} mm의 <b>기초판(매트기초)</b>입니다. 이 프로그램의 규칙은 보가 받치는 슬래브용이라 기초판에는 적용하지 않습니다. 기초판은 매스콘크리트 타설계획으로 따로 검토하세요. 위층(지하 1층 이상)을 골라 주세요.`, 'err');
      return;
    }
    state.ifcGrids = r.grids || []; state.ifcCslab = r.Cslab || 0;
    state.ifcInfo = { cols: r.columns.length, beams: r.beams.length, walls: r.walls.length, open: r.openings.length, W: r.W, slabVol: r.info.slabVol, beamVol: r.info.beamVol };
    fill({ project: r.project, floor: r.floor, slab: r.slab, slabs: r.slabs, t: r.t, C: r.C, columns: r.columns, beams: r.beams, walls: r.walls, openings: r.openings });
    ifcStatus(`<span class="sum-chips"><b>${esc(r.floor)}</b><span>기둥 ${r.columns.length}</span><span>보 ${r.beams.length}</span><span>구조벽 ${r.walls.length}</span><span>개구부 ${r.openings.length}</span><span>${f1(r.C)} ㎥</span></span>`, 'ok');
    $('#formNote').textContent = `${r.floor} 모델 값을 불러왔습니다.`;
    run();
  } catch (e) { ifcStatus(esc(e.message), 'err'); }
});
