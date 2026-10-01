// 검사용 무작위 비정형 평면 생성기 (L·ㄷ·T자, 중정, 코어, 캔틸레버, 떨어진 바닥 등). 같은 번호면 항상 같은 평면.
// 복잡한 비정형 평면 무작위 생성기 (시드 고정)
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gen(seed){
  const R=rng(seed), rr=(a,b)=>a+(b-a)*R(), ri=(a,b)=>Math.floor(rr(a,b+1)), pick=a=>a[Math.floor(R()*a.length)];
  const nxs=ri(3,7), nys=ri(3,6);
  const xs=[0],ys=[0];for(let i=0;i<nxs;i++)xs.push(+(xs[i]+pick([4.5,6,7.2,8,8.4,9,10,11])).toFixed(2));for(let j=0;j<nys;j++)ys.push(+(ys[j]+pick([4.5,6,6.6,7.2,8,9])).toFixed(2));
  const X1=xs[xs.length-1],Y1=ys[ys.length-1];
  // 격자 칸 단위로 평면 모양 만들기: 모서리 파내기, 가운데 중정
  const on=[];for(let i=0;i<nxs;i++){on.push([]);for(let j=0;j<nys;j++)on[i].push(true);}
  const nCut=ri(0,3);for(let c=0;c<nCut;c++){const ci=R()<.5?0:nxs-1,cj=R()<.5?0:nys-1;const w=ri(1,Math.max(1,Math.floor(nxs/2))),h=ri(1,Math.max(1,Math.floor(nys/2)));for(let a=0;a<w;a++)for(let b=0;b<h;b++){const i=ci===0?a:nxs-1-a,j=cj===0?b:nys-1-b;on[i][j]=false;}}
  if(nxs>=4&&nys>=4&&R()<.35){const i=ri(1,nxs-3),j=ri(1,nys-3);on[i][j]=false;}
  // 가장 큰 연결 덩어리만 남김
  const seen=on.map(r=>r.map(()=>false));let best=[];for(let i=0;i<nxs;i++)for(let j=0;j<nys;j++)if(on[i][j]&&!seen[i][j]){const st=[[i,j]],comp=[];seen[i][j]=true;while(st.length){const [a,b]=st.pop();comp.push([a,b]);for(const [da,db] of [[1,0],[-1,0],[0,1],[0,-1]]){const A=a+da,B=b+db;if(A>=0&&B>=0&&A<nxs&&B<nys&&on[A][B]&&!seen[A][B]){seen[A][B]=true;st.push([A,B]);}}}if(comp.length>best.length)best=comp;}
  for(let i=0;i<nxs;i++)for(let j=0;j<nys;j++)on[i][j]=false;for(const [a,b] of best)on[a][b]=true;
  // 칸들의 외곽선(합집합) → 폴리곤 (슬래브 끝은 기둥 중심에서 0.4 m 밖, 가끔 한쪽 1.5 m 캔틸레버)
  const ext=0.4, cantSide=R()<.3?pick(['S','N','E','W']):null, cantL=1.5;
  const cellRect=(i,j)=>{let x0=xs[i]-(i===0||!on[i-1][j]?ext:0),x1=xs[i+1]+(i===nxs-1||!on[i+1][j]?ext:0),y0=ys[j]-(j===0||!on[i][j-1]?ext:0),y1=ys[j+1]+(j===nys-1||!on[i][j+1]?ext:0);
    if(cantSide==='S'&&j===0)y0-=cantL;if(cantSide==='N'&&j===nys-1)y1+=cantL;if(cantSide==='W'&&i===0)x0-=cantL;if(cantSide==='E'&&i===nxs-1)x1+=cantL;return [x0,y0,x1,y1];};
  const rects=best.map(([i,j])=>cellRect(i,j));
  const poly=unionOutline(rects);
  // 사선 모서리(가끔)
  if(R()<.3&&poly.length>=4){const k=0;const p=poly[k],q=poly[(k+1)%poly.length];poly.splice(k+1,0,[(p[0]*.7+q[0]*.3),(p[1]*.7+q[1]*.3)]);}
  // 기둥: 격자점 중 슬래브 안(가끔 빠짐) + 그리드 밖 기둥 몇 개
  const cols=[];const inCell=(x,y)=>best.some(([i,j])=>x>=xs[i]-1e-6&&x<=xs[i+1]+1e-6&&y>=ys[j]-1e-6&&y<=ys[j+1]+1e-6);
  for(const x of xs)for(const y of ys)if(inCell(x,y)&&R()>.08)cols.push([x,y]);
  // 보: 큰보는 인접 기둥 사이, 작은보는 칸 가운데 한 방향
  const beams=[];const has=(x,y)=>cols.some(c=>Math.abs(c[0]-x)<1e-6&&Math.abs(c[1]-y)<1e-6);
  for(const y of ys){const row=xs.filter(x=>has(x,y));for(let k=0;k+1<row.length;k++)if(inCell((row[k]+row[k+1])/2,y)&&R()>.05)beams.push([row[k],y,row[k+1],y,pick([0.4,0.5,0.6])]);}
  for(const x of xs){const colm=ys.filter(y=>has(x,y));for(let k=0;k+1<colm.length;k++)if(inCell(x,(colm[k]+colm[k+1])/2)&&R()>.05)beams.push([x,colm[k],x,colm[k+1],pick([0.4,0.5])]);}
  const dirY=R()<.5;for(const [i,j] of best){if(R()<.3)continue;const n=(xs[i+1]-xs[i]>8||ys[j+1]-ys[j]>8)?ri(1,2):1;for(let t=1;t<=n;t++){if(dirY){const x=xs[i]+(xs[i+1]-xs[i])*t/(n+1);beams.push([x,ys[j],x,ys[j+1],0.3]);}else{const y=ys[j]+(ys[j+1]-ys[j])*t/(n+1);beams.push([xs[i],y,xs[i+1],y,0.3]);}}}
  // 코어(벽 4면 + 계단실 개구부) 1~2개, 외벽 일부, 샤프트
  const walls=[],openings=[];const nCore=ri(0,2);
  for(let c=0;c<nCore;c++){const [i,j]=pick(best);const cx=xs[i]+rr(1.5,Math.max(1.6,xs[i+1]-xs[i]-4)),cy=ys[j]+rr(1.5,Math.max(1.6,ys[j+1]-ys[j]-4)),w=rr(2.5,3.5),h=rr(3,5),t=0.25;
    walls.push([cx,cy,cx+w,cy+t],[cx,cy+h-t,cx+w,cy+h],[cx,cy,cx+t,cy+h],[cx+w-t,cy,cx+w,cy+h]);openings.push([cx+t,cy+t,cx+w-t,cy+h-t]);}
  if(R()<.5){const [i,j]=pick(best);const x=xs[i]+rr(1,3),y=ys[j]+rr(1,3);openings.push([x,y,x+rr(1,2),y+rr(1,2)]);}
  if(R()<.5){walls.push([xs[0]-ext,ys[0]-ext,xs[0]-ext+0.25,ys[0]-ext+Math.min(6,Y1)]);}
  // 떨어진 바닥: 작은 조각 0~3개, 가끔 큰 별도 슬래브
  const slabs=[poly];const bx1=Math.max(...poly.map(p=>p[0])),by0=Math.min(...poly.map(p=>p[1]));
  const nPad=R()<.6?ri(1,3):0;for(let k=0;k<nPad;k++){const w=rr(1.5,4.5),h=rr(1.5,4.5),x=bx1+rr(2,6),y=by0+k*7-rr(2,6);slabs.push([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);}
  if(R()<.3){const x=bx1+rr(3,5),y=by0+22,w=rr(5,8),h=rr(8,14);slabs.push([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);}
  const area=slabs.reduce((a,p)=>a+polyArea(p),0), t=pick([0.15,0.18,0.2,0.25]), C=+(area*t*rr(1.1,1.35)).toFixed(1);
  const Nt=ri(2,10), P=Math.ceil(C/Nt*rr(1.05,1.4));
  return {seed, slab:poly, slabs, columns:cols, beams, walls, openings, t, C, P, ratio:1/3, mult:2, defW:0.4, cantExt:false, info:{nxs,nys,cells:best.length,cant:cantSide,cores:nCore,pads:slabs.length-1}};
}
function polyArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1];}return Math.abs(a)/2;}
// 축정렬 사각형들의 합집합 외곽선 (격자 셀 경계 상쇄)
function unionOutline(rects){
  const X=[...new Set(rects.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b),Y=[...new Set(rects.flatMap(r=>[r[1],r[3]]))].sort((a,b)=>a-b);
  const nx=X.length-1,ny=Y.length-1,g=(i,j)=>i>=0&&j>=0&&i<nx&&j<ny&&rects.some(r=>(X[i]+X[i+1])/2>r[0]&&(X[i]+X[i+1])/2<r[2]&&(Y[j]+Y[j+1])/2>r[1]&&(Y[j]+Y[j+1])/2<r[3]);
  const G=[];for(let i=0;i<nx;i++){G.push([]);for(let j=0;j<ny;j++)G[i].push(g(i,j));}const f=(i,j)=>i>=0&&j>=0&&i<nx&&j<ny&&G[i][j];
  const E=new Map();const add=(a,b)=>E.set(a.join(','),b);
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)if(G[i][j]){if(!f(i,j-1))add([X[i],Y[j]],[X[i+1],Y[j]]);if(!f(i+1,j))add([X[i+1],Y[j]],[X[i+1],Y[j+1]]);if(!f(i,j+1))add([X[i+1],Y[j+1]],[X[i],Y[j+1]]);if(!f(i-1,j))add([X[i],Y[j+1]],[X[i],Y[j]]);}
  const start=E.keys().next().value;const out=[];let k=start;do{const p=k.split(',').map(Number);out.push(p);k=E.get(k).join(',');}while(k!==start&&out.length<10000);
  const s=[];for(let i=0;i<out.length;i++){const a=out[(i-1+out.length)%out.length],b=out[i],c=out[(i+1)%out.length];if(Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-9)s.push(b);}
  return s;
}
module.exports={gen};
