// IFC(STEP) 파일 읽기: 층 목록, 슬래브·기둥·보·벽·개구부·그리드 추출, 회전 보정
// ===== IFC-START : Revit에서 내보낸 IFC 읽기 (외부 라이브러리 없이 직접 해석) =====
const IFCReader = (() => {
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };
  const I3 = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], o: [0, 0, 0] };
  const apply = (F, p) => [F.o[0] + F.x[0] * p[0] + F.y[0] * p[1] + F.z[0] * p[2], F.o[1] + F.x[1] * p[0] + F.y[1] * p[1] + F.z[1] * p[2], F.o[2] + F.x[2] * p[0] + F.y[2] * p[1] + F.z[2] * p[2]];
  const applyDir = (F, d) => [F.x[0] * d[0] + F.y[0] * d[1] + F.z[0] * d[2], F.x[1] * d[0] + F.y[1] * d[1] + F.z[1] * d[2], F.x[2] * d[0] + F.y[2] * d[1] + F.z[2] * d[2]];
  const compose = (A, B) => ({ x: applyDir(A, B.x), y: applyDir(A, B.y), z: applyDir(A, B.z), o: apply(A, B.o) });

  function decodeStr(s) {
    return s.replace(/''/g, "'")
      .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (m, h) => { let o = ''; for (let i = 0; i + 8 <= h.length; i += 8) o += String.fromCodePoint(parseInt(h.substr(i, 8), 16)); return o; })
      .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (m, h) => { let o = ''; for (let i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; })
      .replace(/\\X\\([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
  }

  function parse(text) {
    const ents = new Map(), byType = new Map();
    let i = text.indexOf('DATA;');
    if (i < 0) throw new Error('IFC 파일 형식이 아닙니다 (DATA 구역 없음).');
    i += 5; const n = text.length;
    while (i < n) {
      const h = text.indexOf('#', i); if (h < 0) break;
      let j = h + 1, id = 0;
      while (j < n) { const c = text.charCodeAt(j); if (c < 48 || c > 57) break; id = id * 10 + c - 48; j++; }
      while (j < n && text.charCodeAt(j) <= 32) j++;
      if (text[j] !== '=') { i = j; continue; }
      j++; while (j < n && text.charCodeAt(j) <= 32) j++;
      const ts = j; while (j < n && text[j] !== '(') j++;
      const type = text.slice(ts, j).trim().toUpperCase();
      const as = j; let inStr = false;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (inStr) { if (c === 39) { if (text.charCodeAt(j + 1) === 39) j++; else inStr = false; } }
        else if (c === 39) inStr = true;
        else if (c === 59) break;
        j++;
      }
      ents.set(id, { t: type, s: as, e: j, a: null });
      let l = byType.get(type); if (!l) byType.set(type, l = []); l.push(id);
      i = j + 1;
    }
    if (!ents.size) throw new Error('IFC 파일에서 객체를 찾지 못했습니다.');

    function parseArgs(str) {
      let p = 0; const L = str.length;
      const ws = () => { while (p < L && str.charCodeAt(p) <= 32) p++; };
      function val() {
        ws(); const c = str[p];
        if (c === '(') {
          p++; const arr = [];
          for (;;) { ws(); if (p >= L) break; if (str[p] === ')') { p++; break; } arr.push(val()); ws(); if (str[p] === ',') { p++; continue; } if (str[p] === ')') { p++; break; } p++; }
          return arr;
        }
        if (c === "'") {
          p++; const st = p;
          for (;;) { if (p >= L) break; if (str[p] === "'") { if (str[p + 1] === "'") { p += 2; continue; } break; } p++; }
          const s = str.slice(st, p); p++; return decodeStr(s);
        }
        if (c === '#') { p++; let v = 0; while (p < L) { const d = str.charCodeAt(p); if (d < 48 || d > 57) break; v = v * 10 + d - 48; p++; } return { r: v }; }
        if (c === '$' || c === '*') { p++; return null; }
        if (c === '.') { const e = str.indexOf('.', p + 1); const v = str.slice(p + 1, e); p = e + 1; return { e: v }; }
        if (/[A-Za-z]/.test(c)) { const st = p; while (p < L && /[A-Za-z0-9_]/.test(str[p])) p++; const nm = str.slice(st, p); ws(); if (str[p] === '(') { const inner = val(); return inner.length === 1 ? inner[0] : inner; } return { e: nm }; }
        const st = p; while (p < L && '+-0123456789.Ee'.indexOf(str[p]) >= 0) p++;
        return parseFloat(str.slice(st, p));
      }
      return val();
    }
    const A = id => { const e = ents.get(id); if (!e) return null; if (!e.a) e.a = parseArgs(text.slice(e.s, e.e)); return e.a; };
    const T = id => { const e = ents.get(id); return e ? e.t : null; };
    const R = v => (v && typeof v === 'object' && 'r' in v) ? v.r : null;
    const list = t => byType.get(t) || [];

    // 단위
    let lenScale = 1, angScale = 1; // 파일 단위 → m, rad
    const siPrefix = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6 };
    function unitScale(uid) {
      const t = T(uid), a = A(uid); if (!a) return null;
      if (t === 'IFCSIUNIT') return a[2] && a[2].e ? (siPrefix[a[2].e] || 1) : 1;
      if (t === 'IFCCONVERSIONBASEDUNIT' || t === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
        const mw = A(R(a[3])); if (!mw) return null;
        const v = Array.isArray(mw[0]) ? mw[0][0] : mw[0]; const base = unitScale(R(mw[1]));
        return v * (base || 1);
      }
      return null;
    }
    const proj = list('IFCPROJECT')[0];
    const projName = proj ? (A(proj)[2] || A(proj)[7] || '') : '';
    if (proj) {
      const ua = A(R(A(proj)[8]));
      if (ua) for (const u of ua[0] || []) {
        const uid = R(u), a = A(uid); if (!a) continue;
        const ut = a[1] && a[1].e;
        if (ut === 'LENGTHUNIT') { const s = unitScale(uid); if (s) lenScale = s; }
        if (ut === 'PLANEANGLEUNIT') { const s = unitScale(uid); if (s) angScale = s; }
      }
    }

    // 좌표계
    const pt = id => { const a = A(id); const c = (a && a[0]) || [0, 0, 0]; return [c[0] || 0, c[1] || 0, c[2] || 0]; };
    const dir = id => { const a = A(id); const c = (a && a[0]) || [1, 0, 0]; return [c[0] || 0, c[1] || 0, c[2] || 0]; };
    function frame3(id) {
      const a = A(id); if (!a) return I3;
      if (T(id) === 'IFCAXIS2PLACEMENT2D') return frame2(id);
      const o = R(a[0]) ? pt(R(a[0])) : [0, 0, 0];
      const z = R(a[1]) ? V.norm(dir(R(a[1]))) : [0, 0, 1];
      let x0 = R(a[2]) ? dir(R(a[2])) : [1, 0, 0];
      let x = V.sub(x0, V.mul(z, V.dot(x0, z)));
      if (Math.hypot(...x) < 1e-9) x = Math.abs(z[0]) < 0.9 ? V.sub([1, 0, 0], V.mul(z, z[0])) : V.sub([0, 1, 0], V.mul(z, z[1]));
      x = V.norm(x);
      return { x, y: V.cross(z, x), z, o };
    }
    function frame2(id) {
      const a = A(id); if (!a) return I3;
      const o = R(a[0]) ? pt(R(a[0])) : [0, 0, 0];
      let x = R(a[1]) ? dir(R(a[1])) : [1, 0, 0]; x = V.norm([x[0], x[1], 0]);
      return { x, y: [-x[1], x[0], 0], z: [0, 0, 1], o: [o[0], o[1], 0] };
    }
    const plCache = new Map();
    function placement(id) {
      if (!id) return I3;
      if (plCache.has(id)) return plCache.get(id);
      plCache.set(id, I3);
      const a = A(id); let F = I3;
      if (T(id) === 'IFCLOCALPLACEMENT' && a) F = compose(placement(R(a[0])), frame3(R(a[1])));
      plCache.set(id, F); return F;
    }
    function ctop(id) { // IfcCartesianTransformationOperator
      const a = A(id); if (!a) return I3;
      const t = T(id), is2 = t.indexOf('2D') >= 0;
      const o = R(a[2]) ? pt(R(a[2])) : [0, 0, 0]; const s = typeof a[3] === 'number' ? a[3] : 1;
      let x = R(a[0]) ? V.norm(dir(R(a[0]))) : [1, 0, 0], y = R(a[1]) ? V.norm(dir(R(a[1]))) : [-x[1], x[0], 0];
      let z = !is2 && R(a[4]) ? V.norm(dir(R(a[4]))) : V.norm(V.cross(x, y));
      const sx = s, sy = (t.indexOf('NONUNIFORM') >= 0 && typeof a[is2 ? 4 : 5] === 'number') ? a[is2 ? 4 : 5] : s;
      const sz = (t.indexOf('NONUNIFORM') >= 0 && !is2 && typeof a[6] === 'number') ? a[6] : s;
      return { x: V.mul(x, sx), y: V.mul(y, sy), z: V.mul(z, sz), o: [o[0], o[1], o[2] || 0] };
    }

    // 곡선 → 2D 점
    function curvePts(id) {
      const t = T(id), a = A(id); if (!a) return [];
      if (t === 'IFCPOLYLINE') return (a[0] || []).map(r => pt(R(r)));
      if (t === 'IFCINDEXEDPOLYCURVE') { const pl = A(R(a[0])); return pl ? (pl[0] || []).map(c => [c[0], c[1], c[2] || 0]) : []; }
      if (t === 'IFCCOMPOSITECURVE' || t === 'IFCCOMPOSITECURVEONSURFACE') {
        let out = [];
        for (const s of a[0] || []) {
          const sa = A(R(s)); if (!sa) continue;
          let p = curvePts(R(sa[2])); if (sa[1] && sa[1].e === 'F') p = p.slice().reverse();
          if (out.length && p.length && Math.hypot(out[out.length - 1][0] - p[0][0], out[out.length - 1][1] - p[0][1]) < 1e-6) p = p.slice(1);
          out = out.concat(p);
        }
        return out;
      }
      if (t === 'IFCTRIMMEDCURVE') {
        const bt = T(R(a[0])), ba = A(R(a[0])); const sense = !(a[3] && a[3].e === 'F');
        const trimPt = tr => { for (const v of tr || []) if (R(v) && T(R(v)) === 'IFCCARTESIANPOINT') return pt(R(v)); return null; };
        const trimPar = tr => { for (const v of tr || []) if (typeof v === 'number') return v; return null; };
        if (bt === 'IFCCIRCLE' || bt === 'IFCELLIPSE') {
          const F = frame3(R(ba[0])), r1 = ba[1], r2 = bt === 'IFCELLIPSE' ? ba[2] : ba[1];
          const angOf = (tr) => {
            const q = trimPt(tr);
            if (q) { const d = V.sub(q, F.o); return Math.atan2(V.dot(d, F.y) / r2, V.dot(d, F.x) / r1); }
            const pv = trimPar(tr); return pv === null ? 0 : pv * angScale;
          };
          let t1 = angOf(a[1]), t2 = angOf(a[2]);
          if (sense) { while (t2 <= t1) t2 += 2 * Math.PI; } else { while (t2 >= t1) t2 -= 2 * Math.PI; }
          const out = [], k = 6;
          for (let s = 0; s <= k; s++) { const th = t1 + (t2 - t1) * s / k; out.push(apply(F, [r1 * Math.cos(th), r2 * Math.sin(th), 0])); }
          return out;
        }
        const p1 = trimPt(a[1]), p2 = trimPt(a[2]);
        if (p1 && p2) return sense ? [p1, p2] : [p2, p1];
        if (bt === 'IFCLINE') {
          const lp = pt(R(ba[0])), vv = A(R(ba[1])), d = V.norm(dir(R(vv[0]))), mag = vv[1] || 1;
          const q = s => V.add(lp, V.mul(d, s * mag));
          const s1 = trimPar(a[1]) || 0, s2 = trimPar(a[2]) || 0;
          return sense ? [q(s1), q(s2)] : [q(s2), q(s1)];
        }
        return [];
      }
      if (t === 'IFCCIRCLE' || t === 'IFCELLIPSE') {
        const F = frame3(R(a[0])), r1 = a[1], r2 = t === 'IFCELLIPSE' ? a[2] : a[1], out = [];
        for (let s = 0; s < 16; s++) { const th = 2 * Math.PI * s / 16; out.push(apply(F, [r1 * Math.cos(th), r2 * Math.sin(th), 0])); }
        return out;
      }
      return [];
    }
    const rectPts = (w, h) => [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
    function profile(id) { // {outer:[[x,y,0]], inner:[[...]]} 프로파일 좌표계
      const t = T(id), a = A(id); if (!a) return null;
      const pos = () => R(a[2]) ? frame3(R(a[2])) : I3;
      const map = (F, ps) => ps.map(p => apply(F, p));
      if (t === 'IFCRECTANGLEPROFILEDEF' || t === 'IFCRECTANGLEHOLLOWPROFILEDEF' || t === 'IFCROUNDEDRECTANGLEPROFILEDEF') return { outer: map(pos(), rectPts(a[3], a[4])), inner: [] };
      if (t === 'IFCISHAPEPROFILEDEF' || t === 'IFCASYMMETRICISHAPEPROFILEDEF') return { outer: map(pos(), rectPts(a[3], a[4])), inner: [] };
      if (['IFCUSHAPEPROFILEDEF', 'IFCCSHAPEPROFILEDEF', 'IFCTSHAPEPROFILEDEF', 'IFCLSHAPEPROFILEDEF', 'IFCZSHAPEPROFILEDEF'].includes(t)) return { outer: map(pos(), rectPts(a[4], a[3])), inner: [] };
      if (t === 'IFCCIRCLEPROFILEDEF' || t === 'IFCCIRCLEHOLLOWPROFILEDEF') { const r = a[3], ps = []; for (let s = 0; s < 12; s++) { const th = 2 * Math.PI * s / 12; ps.push([r * Math.cos(th), r * Math.sin(th), 0]); } return { outer: map(pos(), ps), inner: [] }; }
      if (t === 'IFCARBITRARYCLOSEDPROFILEDEF') return { outer: curvePts(R(a[2])), inner: [] };
      if (t === 'IFCARBITRARYPROFILEDEFWITHVOIDS') return { outer: curvePts(R(a[2])), inner: (a[3] || []).map(c => curvePts(R(c))) };
      if (t === 'IFCDERIVEDPROFILEDEF') { const p = profile(R(a[2])); if (!p) return null; const F = ctop(R(a[3])); return { outer: map(F, p.outer), inner: p.inner.map(q => map(F, q)) }; }
      if (t === 'IFCCOMPOSITEPROFILEDEF') { let o = []; for (const r of a[2] || []) { const p = profile(R(r)); if (p) o = o.concat(p.outer); } return { outer: o, inner: [] }; }
      return null;
    }
    const area2 = ps => { let s = 0; for (let i = 0; i < ps.length; i++) { const p = ps[i], q = ps[(i + 1) % ps.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; };

    // 형상 항목 → 점·압출 정보
    function items(id, F, out, depth) {
      if (depth > 12) return;
      const t = T(id), a = A(id); if (!a) return;
      if (t === 'IFCEXTRUDEDAREASOLID' || t === 'IFCEXTRUDEDAREASOLIDTAPERED') {
        const p = profile(R(a[0])); if (!p || !p.outer.length) return;
        const G = compose(F, R(a[1]) ? frame3(R(a[1])) : I3);
        const d = V.mul(V.norm(dir(R(a[2]))), a[3]);
        const bot = p.outer.map(q => apply(G, q)), top = p.outer.map(q => apply(G, V.add(q, d)));
        out.pts.push(...bot, ...top);
        const wd = applyDir(G, d), len = Math.hypot(...wd);
        const ar = area2(p.outer) - p.inner.reduce((s, q) => s + area2(q), 0);
        out.ext.push({ outer: bot, inner: p.inner.map(q => q.map(r => apply(G, r))), dirZ: len ? Math.abs(wd[2]) / len : 0, dir: len ? [wd[0] / len, wd[1] / len, wd[2] / len] : [0, 0, 1], len, area: ar, vol: ar * a[3] * Math.abs(V.norm(dir(R(a[2])))[2] || 1) });
        return;
      }
      if (t === 'IFCBOOLEANCLIPPINGRESULT' || t === 'IFCBOOLEANRESULT') {
        items(R(a[1]), F, out, depth + 1);
        if (a[0] && a[0].e === 'UNION') items(R(a[2]), F, out, depth + 1);
        return;
      }
      if (t === 'IFCMAPPEDITEM') {
        const rm = A(R(a[0])); if (!rm) return;
        const G = compose(compose(F, ctop(R(a[1]))), frame3(R(rm[0])));
        const sr = A(R(rm[1])); if (!sr) return;
        for (const it of sr[3] || []) items(R(it), G, out, depth + 1);
        return;
      }
      if (t === 'IFCFACETEDBREP' || t === 'IFCFACETEDBREPWITHVOIDS' || t === 'IFCMANIFOLDSOLIDBREP') { shell(R(a[0]), F, out); return; }
      if (t === 'IFCSHELLBASEDSURFACEMODEL') { for (const s of a[0] || []) shell(R(s), F, out); return; }
      if (t === 'IFCFACEBASEDSURFACEMODEL') { for (const s of a[0] || []) shell(R(s), F, out); return; }
      if (t === 'IFCPOLYGONALFACESET' || t === 'IFCTRIANGULATEDFACESET' || t === 'IFCTRIANGULATEDIRREGULARNETWORK') {
        const pl = A(R(a[0])); if (!pl) return;
        const P = (pl[0] || []).map(c => apply(F, [c[0], c[1], c[2] || 0]));
        out.pts.push(...P);
        if (out.faces) {
          if (t === 'IFCPOLYGONALFACESET') {
            for (const fr of a[2] || []) { const fa = A(R(fr)); if (!fa) continue; const loops = [fa[0] || []].concat(T(R(fr)) === 'IFCINDEXEDPOLYGONALFACEWITHVOIDS' ? (fa[1] || []) : []); out.faces.push(loops.map(l => l.map(i => P[i - 1]).filter(Boolean))); }
          } else {
            for (const tri of a[3] || []) out.faces.push([tri.map(i => P[i - 1]).filter(Boolean)]);
          }
        }
        return;
      }
      if (t === 'IFCBOUNDINGBOX') { const c = pt(R(a[0])); for (const dx of [0, a[1]]) for (const dy of [0, a[2]]) for (const dz of [0, a[3]]) out.pts.push(apply(F, [c[0] + dx, c[1] + dy, c[2] + dz])); return; }
    }
    function shell(id, F, out) {
      const a = A(id); if (!a) return; const seen = new Set();
      for (const f of a[0] || []) {
        const fa = A(R(f)); if (!fa) continue;
        const loops = [];
        for (const b of fa[0] || []) {
          const ba = A(R(b)); if (!ba) continue; const lp = A(R(ba[0])); if (!lp) continue;
          const loop = [];
          for (const r of lp[0] || []) { const q = R(r); if (!q) continue; const w = apply(F, pt(q)); loop.push(w); if (!seen.has(q)) { seen.add(q); out.pts.push(w); } }
          loops.push(loop);
        }
        if (out.faces && loops.length) out.faces.push(loops);
      }
    }
    // 면 집합에서 "윗면"만 골라 한 번씩만 나오는 모서리를 이어 외곽선(과 구멍)을 만든다
    function outlineFromFaces(faces, zTop, tol) {
      const key = p => Math.round(p[0] / 1e-4) + ',' + Math.round(p[1] / 1e-4);
      const cnt = new Map(), pos = new Map(), segs = [], verts = new Map();
      for (const loops of faces) {
        if (!loops.length || !loops[0].length) continue;
        if (!loops.every(l => l.every(p => Math.abs(p[2] - zTop) <= tol))) continue;
        for (const l of loops) for (let i = 0; i < l.length; i++) {
          const p = l[i], q = l[(i + 1) % l.length];
          if (key(p) === key(q)) continue;
          segs.push([p, q]); verts.set(key(p), p); verts.set(key(q), q);
        }
      }
      // 부분 겹침 처리: 다른 꼭짓점이 변 위에 놓이면 그 점에서 변을 나눈다
      const V = Array.from(verts.values());
      const split = segs.length * V.length <= 6e6;
      for (const [p, q] of segs) {
        let pts = [p, q];
        if (split) {
          const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
          const mids = [];
          if (L2 > 1e-10) for (const v of V) {
            const t = ((v[0] - p[0]) * dx + (v[1] - p[1]) * dy) / L2;
            if (t <= 1e-6 || t >= 1 - 1e-6) continue;
            const ex = p[0] + t * dx - v[0], ey = p[1] + t * dy - v[1];
            if (ex * ex + ey * ey < 1e-8) mids.push([t, v]);
          }
          if (mids.length) { mids.sort((a, b) => a[0] - b[0]); pts = [p, ...mids.map(m => m[1]), q]; }
        }
        for (let i = 0; i + 1 < pts.length; i++) {
          const kp = key(pts[i]), kq = key(pts[i + 1]); if (kp === kq) continue;
          pos.set(kp, pts[i]); pos.set(kq, pts[i + 1]);
          const e = kp < kq ? kp + '|' + kq : kq + '|' + kp;
          cnt.set(e, (cnt.get(e) || 0) + 1);
        }
      }
      const adj = new Map();
      for (const [e, c] of cnt) { if (c !== 1) continue; const [u, v] = e.split('|'); (adj.get(u) || adj.set(u, []).get(u)).push(v); (adj.get(v) || adj.set(v, []).get(v)).push(u); }
      if (!adj.size) return null;
      for (const [, l] of adj) if (l.length !== 2) return null; // 이어지지 않는 모서리 → 신뢰 불가
      const used = new Set(), rings = [];
      for (const start of adj.keys()) {
        if (used.has(start)) continue;
        const ring = [start]; used.add(start); let prev = null, cur = start;
        for (let guard = 0; guard < 100000; guard++) {
          const nx = adj.get(cur).find(v => v !== prev && !(v === start && ring.length < 3));
          if (nx === undefined || nx === start) break;
          if (used.has(nx)) return null;
          ring.push(nx); used.add(nx); prev = cur; cur = nx;
        }
        if (ring.length >= 3) rings.push(ring.map(k => pos.get(k)));
      }
      const simplify = r => r.filter((b, i) => { const a = r[(i + r.length - 1) % r.length], c = r[(i + 1) % r.length]; return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-8; });
      const ar = r => { let x = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; x += p[0] * q[1] - q[0] * p[1]; } return Math.abs(x) / 2; };
      const rs = rings.map(simplify).filter(r => r.length >= 3).sort((p, q) => ar(q) - ar(p));
      if (!rs.length) return null;
      return { outer: rs[0], inner: rs.slice(1), area: ar(rs[0]) - rs.slice(1).reduce((x, r) => x + ar(r), 0) };
    }
    function geom(pid, wantFaces) {
      const a = A(pid); if (!a) return null;
      const F = placement(R(a[5]));
      const pds = A(R(a[6])); if (!pds) return null;
      const reps = (pds[2] || []).map(R).filter(Boolean);
      const idOf = r => { const ra = A(r); return ra && typeof ra[1] === 'string' ? ra[1] : ''; };
      let use = reps.filter(r => idOf(r) === 'Body');
      if (!use.length) use = reps.filter(r => !['Axis', 'FootPrint', 'Annotation', 'Box', 'Profile'].includes(idOf(r)));
      if (!use.length) use = reps.filter(r => idOf(r) === 'Box');
      const out = { pts: [], ext: [], faces: wantFaces ? [] : null };
      for (const r of use) for (const it of (A(r)[3] || [])) items(R(it), F, out, 0);
      if (!out.pts.length) return null;
      const s = lenScale; let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const p of out.pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
      return {
        min: mn.map(v => v * s), max: mx.map(v => v * s),
        pts: out.pts.map(p => [p[0] * s, p[1] * s, p[2] * s]),
        faces: out.faces ? out.faces.map(loops => loops.map(l => l.map(p => [p[0] * s, p[1] * s, p[2] * s]))) : null,
        ext: out.ext.map(e => ({ outer: e.outer.map(p => [p[0] * s, p[1] * s, p[2] * s]), inner: e.inner.map(q => q.map(p => [p[0] * s, p[1] * s])), dirZ: e.dirZ, dir: e.dir, len: e.len * s, area: e.area * s * s, vol: e.vol * s * s * s }))
      };
    }

    // 층·포함관계
    const contained = new Map();
    for (const rid of list('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
      const a = A(rid); const st = R(a[5]); if (!st) continue;
      let l = contained.get(st); if (!l) contained.set(st, l = []);
      for (const r of a[4] || []) if (R(r)) l.push(R(r));
    }
    const voids = new Map();
    for (const rid of list('IFCRELVOIDSELEMENT')) {
      const a = A(rid); const el = R(a[4]), op = R(a[5]); if (!el || !op) continue;
      let l = voids.get(el); if (!l) voids.set(el, l = []); l.push(op);
    }
    const TYPES = {
      slab: ['IFCSLAB', 'IFCSLABSTANDARDCASE', 'IFCSLABELEMENTEDCASE'],
      column: ['IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE'],
      beam: ['IFCBEAM', 'IFCBEAMSTANDARDCASE'],
      wall: ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE']
    };
    const kindOf = id => { const t = T(id); for (const k in TYPES) if (TYPES[k].includes(t)) return k; return null; };
    // 기초판(매트기초 등): 보 구조 슬래브 규칙의 대상이 아님
    const isFoundation = id => { const a = A(id); if (!a) return false; const v = a[8]; if (v && v.e === 'BASESLAB') return true; const nm = String(a[2] || '') + ' ' + String(a[4] || ''); return /기초|매트|footing|foundation|base ?slab|\bmat\b/i.test(nm); };
    const storeys = list('IFCBUILDINGSTOREY').map(id => {
      const a = A(id), els = contained.get(id) || [], c = { slab: 0, column: 0, beam: 0, wall: 0, found: 0 };
      for (const e of els) { const k = kindOf(e); if (k) c[k]++; if (k === 'slab' && isFoundation(e)) c.found++; }
      const zw = placement(R(a[5])).o[2] * lenScale;
      return { id, name: a[2] || a[7] || ('#' + id), elev: typeof a[9] === 'number' ? a[9] * lenScale : zw, z: zw, count: c };
    }).sort((p, q) => p.elev - q.elev);
    const allOf = k => TYPES[k].flatMap(list);
    const aggr = new Map();
    for (const rid of list('IFCRELAGGREGATES')) {
      const a = A(rid); const par = R(a[4]); if (!par) continue;
      let l = aggr.get(par); if (!l) aggr.set(par, l = []);
      for (const r of a[5] || []) if (R(r)) l.push(R(r));
    }
    const mergeG = gs => {
      gs = gs.filter(Boolean); if (!gs.length) return null;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const g of gs) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.min[k]); mx[k] = Math.max(mx[k], g.max[k]); }
      return { min: mn, max: mx, pts: gs.flatMap(g => g.pts), ext: gs.flatMap(g => g.ext), faces: gs.some(g => g.faces) ? gs.flatMap(g => g.faces || []) : null, parts: gs.length };
    };
    // 본체에 형상이 없으면(Revit '부재 분할' 등) 하위 조각들의 형상을 합친다
    const geomAny = (id, wantFaces, depth) => {
      let g = null; try { g = geom(id, wantFaces); } catch (e) { g = null; }
      if (g || (depth || 0) > 3) return g;
      const kids = aggr.get(id); if (!kids || !kids.length) return null;
      return mergeG(kids.map(k => geomAny(k, wantFaces, (depth || 0) + 1)));
    };
    const gcache = new Map();
    const G = id => { if (!gcache.has(id)) gcache.set(id, geomAny(id, false)); return gcache.get(id); };
    const fcache = new Map();
    const GF = id => { if (!fcache.has(id)) fcache.set(id, geomAny(id, true)); return fcache.get(id); };
    // 슬래브 하나를 "윗면 외곽 + 두께 + 체적" 형태로 정리 (압출이든 Brep·삼각망이든)
    function slabShape(id) {
      const g = G(id); if (!g) return null;
      let best = null;
      const vex = g.ext.filter(e => e.dirZ > 0.95 && e.outer.length >= 3);
      for (const e of vex) { const a = area2(e.outer); if (!best || a > best.area) best = { outer: e.outer, inner: e.inner, t: e.len, vol: e.vol, area: a, src: 'ext' }; }
      if (vex.length > 1) {
        // 같은 높이의 압출 조각들을 한 외곽으로 합친다
        const z0 = best.outer[0][2];
        const same = vex.filter(e => Math.abs(e.outer[0][2] - z0) < 0.01);
        if (same.length > 1) {
          const o = outlineFromFaces(same.map(e => [e.outer]), z0, 0.005);
          const holes = same.flatMap(e => e.inner || []);
          if (o && o.area > best.area * 1.01) return { outer: o.outer, inner: o.inner.concat(holes), t: best.t, vol: same.reduce((x, e) => x + e.vol, 0), area: o.area, src: 'ext-merged', g };
        }
      }
      if (best) return { ...best, g };
      const gf = GF(id); if (!gf || !gf.faces || !gf.faces.length) return null;
      const t = g.max[2] - g.min[2];
      const o = outlineFromFaces(gf.faces, g.max[2], Math.max(0.003, t * 0.02));
      if (!o) return { outer: [[g.min[0], g.min[1], g.max[2]], [g.max[0], g.min[1], g.max[2]], [g.max[0], g.max[1], g.max[2]], [g.min[0], g.max[1], g.max[2]]], inner: [], t, vol: (g.max[0] - g.min[0]) * (g.max[1] - g.min[1]) * t, area: (g.max[0] - g.min[0]) * (g.max[1] - g.min[1]), src: 'bbox', g };
      return { outer: o.outer, inner: o.inner, t, vol: o.area * t, area: o.area, src: 'faces', g };
    }

    function extract(storeyId, opts) {
      const minWallT = (opts && opts.minWallT > 0) ? opts.minWallT : 0.2;
      const W = [];
      const inStorey = (contained.get(storeyId) || []);
      const st = storeys.find(s => s.id === storeyId);
      // 1) 슬래브: 이 층에 속한 바닥. 층 소속 정보가 없으면 층 높이 근처의 바닥을 찾는다
      const pred = id => { const a = A(id); const v = a && a[8]; return v && v.e ? v.e : ''; };
      const usable = list0 => { const f = list0.filter(s => !['ROOF', 'LANDING'].includes(pred(s))); return f.length ? f : list0; };
      let slabIds = usable(inStorey.filter(e => kindOf(e) === 'slab'));
      if (!slabIds.length) {
        const sz = st.z;
        slabIds = usable(allOf('slab').filter(id => { const g = G(id); return g && Math.abs(g.max[2] - sz) < 0.6; }));
        if (slabIds.length) W.push('층 소속 정보가 없는 슬래브를 층 높이로 찾아 사용했습니다.');
      }
      const shapes = slabIds.map(id => ({ id, sh: slabShape(id) })).filter(x => x.sh && x.sh.area > 0.5);
      if (!shapes.length) throw new Error(`'${st.name}' 층에서 슬래브(바닥)를 찾지 못했습니다. 다른 층을 고르거나, IFC 내보내기에 바닥이 포함됐는지 확인하세요.`);
      shapes.sort((p, q) => q.sh.area - p.sh.area);
      const main = shapes[0];
      // 윗면 높이가 같은(±0.3 m) 조각은 한 바닥으로 합친다. 계단참처럼 높이가 다른 것은 제외
      const zMain = main.sh.g.max[2];
      let parts = shapes.filter(x => Math.abs(x.sh.g.max[2] - zMain) <= 0.3);
      const dropped = shapes.length - parts.length;
      if (dropped) W.push(`높이가 다른 슬래브 ${dropped}개(계단참 등)는 제외했습니다.`);
      if (parts.some(x => x.sh.src === 'bbox')) W.push('일부 슬래브는 외곽선을 읽지 못해 사각형으로 근사했습니다.');
      const sg = main.sh.g;
      // 0) 건물이 X·Y축에서 돌아가 있으면(진북 회전 등) 축에 맞게 돌려서 계산한다
      //    먼저 슬래브 외곽만으로 각도를 구하고, 외곽이 직교형이 아니어서 애매할 때만 이 층의 수평 보 방향을 보탠다
      const est = () => {
        const bins = new Float64Array(180), items = []; let w = 0;
        const norm = a => { a = ((a % 90) + 90) % 90; return a; };
        const E = {
          add(dx, dy, wt) { if (!(wt > 1e-6)) return; const a = norm(Math.atan2(dy, dx) * 180 / Math.PI); bins[Math.floor(a * 2) % 180] += wt; items.push([a, wt]); w += wt; },
          peak() { let bi = 0, bv = -1; for (let i = 0; i < 180; i++) { const v = bins[(i + 179) % 180] + 2 * bins[i] + bins[(i + 1) % 180]; if (v > bv) { bv = v; bi = i; } } return (bi + 0.5) / 2; },
          get angle() { if (!w) return 0; const pk = E.peak(); let sx = 0, sw = 0; for (const [a, wt] of items) { let d = a - pk; if (d > 45) d -= 90; if (d < -45) d += 90; if (Math.abs(d) <= 2) { sx += d * wt; sw += wt; } } let r = pk + (sw ? sx / sw : 0); if (r > 45) r -= 90; return r * Math.PI / 180; },
          get conc() { if (!w) return 0; const ang = E.angle * 180 / Math.PI; let sw = 0; for (const [a, wt] of items) { let d = norm(a - ang); if (d > 45) d -= 90; if (Math.abs(d) <= 2) sw += wt; } return sw / w; }
        };
        return E;
      };
      const ring = (E, o) => { for (let i = 0; i < o.length; i++) { const p = o[i], q = o[(i + 1) % o.length]; E.add(q[0] - p[0], q[1] - p[1], Math.hypot(q[0] - p[0], q[1] - p[1])); } };
      const Es = est();
      for (const x of parts) if (x.sh.src !== 'bbox') ring(Es, x.sh.outer);
      let theta = 0;
      if (Es.conc > 0.6) theta = Es.angle;
      else {
        const Eb = est();
        for (const x of parts) if (x.sh.src !== 'bbox') ring(Eb, x.sh.outer);
        for (const id of allOf('beam')) {
          const g = G(id); if (!g || g.max[2] < sg.min[2] - 1.5 || g.max[2] > sg.max[2] + 0.5) continue;
          for (const e of g.ext) if (e.dir && Math.abs(e.dir[2]) < 0.05) Eb.add(e.dir[0], e.dir[1], e.len);
        }
        if (Eb.conc > 0.6) theta = Eb.angle;
      }
      if (Math.abs(theta) < 0.2 * Math.PI / 180) theta = 0;
      const rx = (sg.min[0] + sg.max[0]) / 2, ry = (sg.min[1] + sg.max[1]) / 2, cT = Math.cos(-theta), sT = Math.sin(-theta);
      const rot = p => [rx + (p[0] - rx) * cT - (p[1] - ry) * sT, ry + (p[0] - rx) * sT + (p[1] - ry) * cT];
      const Gr = id => {
        const g = G(id); if (!g) return null;
        if (!theta) return g;
        // 캐시는 회전각과 회전 중심이 모두 같을 때만 재사용 (층마다 중심이 다르다)
        const rk = theta + '|' + rx + '|' + ry; if (g._rk === rk) return g._r;
        const mn = [Infinity, Infinity, g.min[2]], mx = [-Infinity, -Infinity, g.max[2]];
        for (const p of g.pts) { const q = rot(p); if (q[0] < mn[0]) mn[0] = q[0]; if (q[1] < mn[1]) mn[1] = q[1]; if (q[0] > mx[0]) mx[0] = q[0]; if (q[1] > mx[1]) mx[1] = q[1]; }
        g._rk = rk; g._r = { min: mn, max: mx, ext: g.ext };
        return g._r;
      };
      if (theta) W.push(`모델이 X·Y축에서 ${(theta * 180 / Math.PI).toFixed(1)}° 돌아가 있어, 그리드에 맞게 돌려서 계산했습니다.`);
      // 주 방향과 3° 넘게 다른 슬래브(다른 방향으로 꺾인 날개동 등)는 한 평면에서 같이 풀 수 없어 제외한다
      const skew = [];
      for (let i = parts.length - 1; i >= 1; i--) {
        const x = parts[i]; if (x.sh.src === 'bbox') continue;
        const Ep = est(); ring(Ep, x.sh.outer);
        if (Ep.conc < 0.6) continue;
        let d = Math.abs((Ep.angle - theta) * 180 / Math.PI) % 90; if (d > 45) d = 90 - d;
        if (d > 3) { skew.push(x); parts.splice(i, 1); }
      }
      if (skew.length) W.push(`주 방향과 다르게 꺾인 슬래브 ${skew.length}개(날개동 등)는 제외했습니다. 그 부분은 따로 계산해야 합니다.`);
      if (parts.length > 1) W.push(`이 층의 슬래브 ${parts.length}개를 한 바닥으로 합쳐 계산했습니다.`);
      const zTop = Math.max(...parts.map(x => x.sh.g.max[2])), zBot = Math.min(...parts.map(x => x.sh.g.min[2]));
      const t = main.sh.t;
      const openings = [];
      const clean = pg => pg.filter((p, i) => { const q = pg[(i + pg.length - 1) % pg.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
      const polys = [];
      for (const x of parts) {
        if (x.sh.src === 'bbox') { const r = Gr(x.id); polys.push([[r.min[0], r.min[1]], [r.max[0], r.min[1]], [r.max[0], r.max[1]], [r.min[0], r.max[1]]]); }
        else polys.push(clean(x.sh.outer.map(p => rot(p))));
        for (const q0 of x.sh.inner || []) { const q = q0.map(p => rot(p)); const xs = q.map(p => p[0]), ys = q.map(p => p[1]); openings.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]); }
        for (const op of voids.get(x.id) || []) { const g = Gr(op); if (g) openings.push([g.min[0], g.min[1], g.max[0], g.max[1]]); }
      }
      // 같은 개구부가 프로파일 구멍과 개구부 객체로 두 번 잡히면 하나로
      const uniqOpen = [];
      for (const o of openings) if (!uniqOpen.some(q => q.every((v, i) => Math.abs(v - o[i]) < 0.02))) uniqOpen.push(o);
      openings.length = 0; openings.push(...uniqOpen);
      let poly = polys[0], slabRings = [polys[0]], dropRatio = 0;
      if (polys.length > 1) {
        const u = outlineFromFaces(polys.map(r => [r.map(p => [p[0], p[1], 0])]), 0, 1e-6);
        if (u) {
          const rings = [u.outer, ...u.inner].map(r => r.map(p => [p[0], p[1]]));
          const areaR = r => { let x = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; x += p[0] * q[1] - q[0] * p[1]; } return Math.abs(x) / 2; };
          const pin = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
          rings.sort((p, q) => areaR(q) - areaR(p));
          const outers = [];
          for (const r of rings) {
            const mid = [(r[0][0] + r[1][0]) / 2 + 1e-3, (r[0][1] + r[1][1]) / 2 + 1e-3];
            const host = outers.find(o => pin(r[0], o) && pin(mid, o));
            if (host) { const xs = r.map(p => p[0]), ys = r.map(p => p[1]); openings.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]); }
            else outers.push(r);
          }
          // 본 바닥과 떨어진 아주 작은 조각(문턱·점검구 바닥 같은 모델 조각)은 구획 대상에서 뺀다
          const totA = outers.reduce((a, r) => a + areaR(r), 0);
          const keep = outers.filter((r, i) => i === 0 || areaR(r) >= Math.max(10, 0.02 * totA));
          const dropA = totA - keep.reduce((a, r) => a + areaR(r), 0);
          if (keep.length < outers.length) {
            W.push(`본 바닥과 떨어진 작은 슬래브 조각 ${outers.length - keep.length}개(합계 ${dropA.toFixed(1)} ㎡)는 구획에서 제외했습니다.`);
            dropRatio = dropA / totA;
          }
          poly = keep[0]; slabRings = keep;
          if (keep.length > 1) W.push(`이 층 바닥이 서로 떨어진 ${keep.length}덩어리로 되어 있습니다.`);
        } else {
          // 슬래브끼리 겹쳐 있으면 외곽을 한 줄로 합칠 수 없다. 계산은 셀 단위 합집합으로 하므로 모두 그대로 넘긴다
          slabRings = polys.slice();
          W.push('슬래브 외곽이 서로 겹쳐 있어 겹친 영역을 합쳐서 계산했습니다(총 물량은 겹친 만큼 크게 잡혔을 수 있음).');
        }
      }
      const allP = slabRings.flat();
      const bx = [Math.min(...allP.map(p => p[0])) - 1, Math.min(...allP.map(p => p[1])) - 1, Math.max(...allP.map(p => p[0])) + 1, Math.max(...allP.map(p => p[1])) + 1];
      const inBox = g => g.max[0] > bx[0] && g.min[0] < bx[2] && g.max[1] > bx[1] && g.min[1] < bx[3];
      let slabVol = parts.reduce((v, x) => v + x.sh.vol, 0);
      if (dropRatio > 0) slabVol *= (1 - dropRatio);

      // 2) 기둥: 슬래브 높이에 걸치는 기둥 (아래층 기둥 상단 / 위층 기둥 하단)
      const columns = [];
      for (const c of allOf('column')) {
        const g = Gr(c); if (!g || !inBox(g)) continue;
        if (g.max[2] < zBot - 0.05 || g.min[2] > zTop + 0.05) continue;
        const cx = (g.min[0] + g.max[0]) / 2, cy = (g.min[1] + g.max[1]) / 2;
        if (!columns.some(q => Math.hypot(q[0] - cx, q[1] - cy) < 0.15)) columns.push([cx, cy, g.max[0] - g.min[0], g.max[1] - g.min[1]]);
      }
      // 3) 보: 윗면이 슬래브 높이 근처인 수평 보
      const beams = []; let diag = 0, beamVol = 0;
      for (const b of allOf('beam')) {
        const g = Gr(b); if (!g || !inBox(g)) continue;
        if (g.max[2] < zBot - 0.3 || g.max[2] > zTop + 0.3) continue;
        const dx = g.max[0] - g.min[0], dy = g.max[1] - g.min[1], dz = g.max[2] - g.min[2];
        if (Math.min(dx, dy) > 1.5) { diag++; continue; }
        const below = Math.max(0, (zTop - g.min[2]) - t);
        const dep = Math.min(below, dz);
        if (dx >= dy) { beams.push({ o: 'h', c: (g.min[1] + g.max[1]) / 2, a: g.min[0], b: g.max[0], w: dy, d: dep, v: dy * dx * dep }); beamVol += dy * dx * dep; }
        else { beams.push({ o: 'v', c: (g.min[0] + g.max[0]) / 2, a: g.min[1], b: g.max[1], w: dx, d: dep, v: dx * dy * dep }); beamVol += dx * dy * dep; }
      }
      if (diag) W.push(`사선·곡선 보 ${diag}개는 제외했습니다.`);
      // 보 끝을 기둥 중심·받는 보 중심선까지 늘림 (Revit은 보를 기둥 면에서 자름)
      const reach = 0.9;
      for (const b of beams) {
        const colC = columns.map(c => b.o === 'h' ? [c[0], c[1]] : [c[1], c[0]]); // [along, perp]
        for (const c of colC) if (Math.abs(c[1] - b.c) < 0.35) b.c = c[1];
      }
      for (const b of beams) {
        const colC = columns.map(c => b.o === 'h' ? [c[0], c[1]] : [c[1], c[0]]);
        for (const end of ['a', 'b']) {
          let snapped = false;
          for (const c of colC) if (Math.abs(c[1] - b.c) < 0.35 && Math.abs(c[0] - b[end]) < reach) { b[end] = c[0]; snapped = true; break; }
          if (snapped) continue;
          let bestD = reach, to = null;
          for (const q of beams) {
            if (q === b || q.o === b.o) continue;
            if (b.c < q.a - 0.3 || b.c > q.b + 0.3) continue;
            const d = Math.abs(q.c - b[end]); if (d < bestD) { bestD = d; to = q.c; }
          }
          if (to !== null) b[end] = to;
        }
      }
      // 4) 벽: 슬래브 높이에 걸치는 직선 벽 → 사각형
      const walls = []; let skipW = 0, thinW = 0;
      for (const w of allOf('wall')) {
        const g = Gr(w); if (!g || !inBox(g)) continue;
        if (g.max[2] < zBot - 0.05 || g.min[2] > zTop + 0.05) continue;
        const dx = g.max[0] - g.min[0], dy = g.max[1] - g.min[1];
        if (Math.min(dx, dy) > 1.0) { skipW++; continue; }
        if (Math.min(dx, dy) < minWallT) { thinW++; continue; }
        const wr = [g.min[0], g.min[1], g.max[0], g.max[1]];
        // 위층 벽·아래층 벽이 같은 자리에 겹치면 하나로
        if (!walls.some(q => q.every((v, i) => Math.abs(v - wr[i]) < 0.02))) walls.push(wr);
      }
      if (skipW) W.push(`사선·곡선 벽 ${skipW}개는 제외했습니다.`);
      if (thinW) W.push(`두께 ${minWallT} m 미만인 칸막이벽 ${thinW}개는 제외했습니다(구조벽만 반영).`);
      // 좌표를 슬래브 좌하단 기준으로 옮기고 mm 단위로 반올림
      const ox = Math.min(...allP.map(p => p[0])), oy = Math.min(...allP.map(p => p[1]));
      // 레빗 그리드(IfcGrid)를 이름 그대로 읽는다
      const gridRaw = [];
      const bx0 = Math.min(...allP.map(p => p[0])) - 15, bx1 = Math.max(...allP.map(p => p[0])) + 15;
      const by0 = Math.min(...allP.map(p => p[1])) - 15, by1 = Math.max(...allP.map(p => p[1])) + 15;
      for (const gid of list('IFCGRID')) {
        const ga = A(gid); if (!ga) continue;
        const F = placement(R(ga[5]));
        for (const axes of [ga[7], ga[8], ga[9]]) for (const ref of axes || []) {
          const aa = A(R(ref)); if (!aa) continue;
          const tag = String(aa[0] || '').trim(); const cid = R(aa[1]); if (!tag || !cid) continue;
          let pts = null;
          if (T(cid) === 'IFCPOLYLINE') pts = (A(cid)[0] || []).map(r => pt(R(r)));
          else if (T(cid) === 'IFCLINE') { const la = A(cid); const p0 = pt(R(la[0])); const v = A(R(la[1])); const d = v ? dir(R(v[0])) : [1, 0, 0]; const m = v && typeof v[1] === 'number' ? v[1] : 1; pts = [p0, [p0[0] + d[0] * m, p0[1] + d[1] * m, 0]]; }
          if (!pts || pts.length < 2) continue;
          const w = pts.map(p => apply(F, [p[0], p[1], p[2] || 0])).map(p => rot([p[0] * lenScale, p[1] * lenScale]));
          const p = w[0], q = w[w.length - 1], dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
          if (dx < 1e-6 && dy < 1e-6) continue;
          let o = null, c = 0;
          if (dy > dx * 20) { o = 'v'; c = (p[0] + q[0]) / 2; if (c < bx0 || c > bx1) continue; }
          else if (dx > dy * 20) { o = 'h'; c = (p[1] + q[1]) / 2; if (c < by0 || c > by1) continue; }
          else continue; // 사선 그리드는 표시하지 않음
          if (!gridRaw.some(g => g.tag === tag && g.o === o && Math.abs(g.c - c) < 0.05)) gridRaw.push({ tag, o, c });
        }
      }
      const r3 = v => Math.round(v * 1000) / 1000;
      const mvx = v => r3(v - ox), mvy = v => r3(v - oy);
      return {
        project: projName, floor: st.name, foundation: isFoundation(main.id) || t >= 0.6,
        slab: poly.map(p => [mvx(p[0]), mvy(p[1])]), slabs: slabRings.map(pg => pg.map(p => [mvx(p[0]), mvy(p[1])])), t: r3(t), C: Math.round((slabVol + beamVol) * 10) / 10, Cslab: Math.round(slabVol * 10) / 10,
        grids: gridRaw.map(g => ({ tag: g.tag, o: g.o, c: g.o === 'v' ? mvx(g.c) : mvy(g.c) })),
        columns: columns.map(c => [mvx(c[0]), mvy(c[1]), r3(c[2]), r3(c[3])]),
        beams: beams.map(b => b.o === 'h' ? [mvx(b.a), mvy(b.c), mvx(b.b), mvy(b.c), r3(b.w), r3(b.d || 0), r3(b.v || 0)] : [mvx(b.c), mvy(b.a), mvx(b.c), mvy(b.b), r3(b.w), r3(b.d || 0), r3(b.v || 0)]),
        walls: walls.map(w => [mvx(w[0]), mvy(w[1]), mvx(w[2]), mvy(w[3])]),
        openings: openings.map(o => [mvx(o[0]), mvy(o[1]), mvx(o[2]), mvy(o[3])]),
        info: { slabVol, beamVol, origin: [ox, oy], zTop, zBot }, W
      };
    }
    return { storeys, extract, lenScale, projName, count: ents.size, geomOf: G, list, T };
  }
  return { parse };
})();
// ===== IFC-END =====
if (typeof module !== 'undefined') module.exports = { IFCReader };
