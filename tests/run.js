// 사용법:  node tests/run.js                 → 예제 모델 + 무작위 평면 12개 검사
//          node tests/run.js 30              → 무작위 평면 30개
//          node tests/run.js 모델.ifc "지상 3층" 120   → 내 IFC의 한 층을 하루 120㎥로 검사
const fs = require('fs'), path = require('path');
const C = require('../js/core.js'), { IFCReader } = require('../js/ifc.js'), { gen } = require('./plans.js');
const { checkModel, checkPlan, plan } = require('./check.js');
const base = { ratio: 1 / 3, mult: 2, defW: 0.4, cantExt: false, truck: 6, tieTol: 0.5, pourDir: 'auto' };
let fail = 0, total = 0;
function test(name, inp) {
  const t = Date.now(); total++;
  const M = C.analyze({ ...inp, walls: (inp.walls || []).map(C.normRect), openings: (inp.openings || []).map(C.normRect) });
  if (M.E.length) { console.log(`- ${name}: 입력 오류 → ${M.E[0]}`); return; }
  const E = checkModel(M, inp), R = plan(M, inp.P);
  for (const s of R.sols.slice(0, 4)) E.push(...checkPlan(M, inp, s));
  let note = R.sols.length ? `${R.sols[0].vol.length}구역 ${R.sols.length}안` : '구획안 못 찾음';
  if (!R.sols.length && !M.units.some(u => u.vol > inp.P)) { // 제안 한도로 다시 하면 반드시 나와야 한다
    const sg = C.minFeasibleP(M, M.C, 9000);
    if (sg) { const Ps = Math.ceil(sg.P), M2 = C.analyze({ ...inp, P: Ps, walls: (inp.walls || []).map(C.normRect), openings: (inp.openings || []).map(C.normRect) }), R2 = plan(M2, Ps);
      if (!R2.sols.length) E.push(`제안 한도 ${Ps}㎥로 다시 계산했는데 실패`); else { note += ` → 제안 ${Ps}㎥에서 ${R2.sols[0].vol.length}구역`; for (const s of R2.sols.slice(0, 2)) E.push(...checkPlan(M2, { ...inp, P: Ps }, s)); } }
  }
  const ok = !E.length; if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: ${note} (${((Date.now() - t) / 1000).toFixed(1)}s)${ok ? '' : '\n    ' + [...new Set(E)].slice(0, 5).join('\n    ')}`);
}
const args = process.argv.slice(2);
if (args[0] && /\.ifc$/i.test(args[0])) {
  const m = IFCReader.parse(new TextDecoder().decode(fs.readFileSync(args[0])));
  const st = m.storeys.find(s => s.name === args[1]); if (!st) { console.log('층 이름을 찾지 못했습니다. 있는 층:', m.storeys.map(s => s.name).join(', ')); process.exit(1); }
  const r = m.extract(st.id); test(`${path.basename(args[0])} ${args[1]}`, { ...r, ...base, P: +args[2] || 120 });
} else {
  // 1) 예제 IFC
  const sample = new Function(fs.readFileSync(path.join(__dirname, '../js/sample.js'), 'utf8') + ';return SAMPLE_IFC;')();
  const m = IFCReader.parse(sample), st = m.storeys.find(s => s.count.slab); test('예제 IFC', { ...m.extract(st.id), ...base, P: 35 });
  // 2) 무작위 비정형 평면
  const n = +args[0] || 12; for (let sd = 1; sd <= n; sd++) test(`무작위 평면 #${sd}`, gen(sd));
}
console.log(`\n검사 ${total}건 중 실패 ${fail}건`); process.exit(fail ? 1 : 0);
