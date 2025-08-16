// ========== Config ==========
const DATA_URLS = {
  questions: 'data/questions.json',      // 축별 문제은행(EI/SN/TF/JP)
  tiebreakers: 'data/tiebreakers.json'   // 축별 타이브레이커
};
const AXES = ['EI','SN','TF','JP'];
const MAX_TB = 2; // 축별 추가문항 최대(0~2) → 전체 최대 8개

// 디버그 패널 (주소에 ?debug=0 붙이면 OFF)
const DEBUG = (new URLSearchParams(location.search).get('debug') ?? '1') !== '0' ||
              localStorage.getItem('quick_mbti_debug') === '1';

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'}); }catch{} }
function status(msg){ console.debug('[quick-mbti]', msg); }

// ========== State ==========
let KB = { questions:null, tiebreakers:null };
let baseQuestions = [];                   // [{id,axis,prompt,A,B,hint}]
let baseIds = [];                         // ['base_EI_1',...]
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];                         // 전체 선택(E/I/S/N/T/F/J/P)
let askedTB = {EI:0,SN:0,TF:0,JP:0};     // 축별 추가문항 제공 횟수
let baseDone = false;                     // 기본 8문항 완료 여부
let pendingTBIds = [];                    // 아직 답하지 않은 추가문항 name 목록

// ========== Debug UI ==========
function ensureDebugShell(){
  if(!DEBUG) return;
  if(!document.body){ document.addEventListener('DOMContentLoaded', ensureDebugShell, {once:true}); return; }
  if($('#debug-panel')) return;

  const css = document.createElement('style');
  css.textContent = `
    #debug-panel{position:fixed;right:12px;bottom:12px;z-index:9999;background:#111827;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:360px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #debug-panel summary{cursor:pointer;list-style:none;padding:10px 12px;margin:0}
    #debug-panel .body{padding:10px 12px}
    #debug-panel table{width:100%;border-collapse:collapse;margin-top:6px;background:transparent}
    #debug-panel th,#debug-panel td{border:1px solid rgba(255,255,255,.15);padding:4px 6px;text-align:center}
    #debug-panel .row{display:flex;gap:8px;flex-wrap:wrap}
    #debug-panel .tag{display:inline-block;border:1px solid rgba(255,255,255,.25);padding:2px 6px;border-radius:999px}
    #debug-toggle{position:fixed;right:12px;bottom:12px;z-index:10000;border-radius:999px;border:1px solid #d1d5db;background:#fff;padding:8px 10px;cursor:pointer;font-size:14px;box-shadow:0 6px 14px rgba(0,0,0,.15)}
  `;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'debug-panel';
  box.innerHTML = `
    <details>
      <summary>🛠 Debug (실시간 합계)</summary>
      <div class="body" id="debug-body">
        <div class="muted">응답에 따라 즉시 업데이트됩니다.</div>
      </div>
    </details>
  `;
  document.body.appendChild(box);

  if(!$('#debug-toggle')){
    const btn=document.createElement('button');
    btn.id='debug-toggle'; btn.type='button'; btn.textContent='🛠';
    btn.addEventListener('click', ()=>{
      const det=$('#debug-panel details'); det.open=!det.open;
    });
    document.body.appendChild(btn);
  }
}
function renderDebug(model){
  if(!DEBUG) return; ensureDebugShell();
  const baseCount = countBaseAnswered();
  const pendCount = pendingTBIds.filter(id => !isAnswered(id)).length;
  const rows = `
    <tr><th>축</th><th>득점</th><th>문항수</th><th>우세/동률</th></tr>
    <tr><td>E vs I</td><td>${model.count.E} : ${model.count.I}</td><td>${model.axisTotals.EI}</td><td>${model.count.E>model.count.I?'E':model.count.E<model.count.I?'I':'동률'}</td></tr>
    <tr><td>S vs N</td><td>${model.count.S} : ${model.count.N}</td><td>${model.axisTotals.SN}</td><td>${model.count.S>model.count.N?'S':model.count.S<model.count.N?'N':'동률'}</td></tr>
    <tr><td>T vs F</td><td>${model.count.T} : ${model.count.F}</td><td>${model.axisTotals.TF}</td><td>${model.count.T>model.count.F?'T':model.count.T<model.count.F?'F':'동률'}</td></tr>
    <tr><td>J vs P</td><td>${model.count.J} : ${model.count.P}</td><td>${model.axisTotals.JP}</td><td>${model.count.J>model.count.P?'J':model.count.J<model.count.P?'P':'동률'}</td></tr>
  `;
  const tag = (k,v)=>`<span class="tag">${k}: ${v}</span>`;
  $('#debug-body').innerHTML = `
    <table>${rows}</table>
    <div class="row" style="margin-top:6px">
      ${tag('기본응답', `${baseCount}/8`)} ${tag('baseDone', baseDone)} ${tag('대기TB', pendCount)}
      ${tag('EI TB', askedTB.EI)} ${tag('SN TB', askedTB.SN)} ${tag('TF TB', askedTB.TF)} ${tag('JP TB', askedTB.JP)}
      ${tag('신뢰도', `${model.reliability}%`)}
    </div>
    <div class="muted" style="margin-top:4px">※ 대기TB>0이면 결과 렌더 보류</div>`;
}

// ========== Fetch ==========
async function loadData(){
  const [qRes, tbRes] = await Promise.all([ fetch(DATA_URLS.questions), fetch(DATA_URLS.tiebreakers) ]);
  if(!qRes.ok) throw new Error('questions.json 로드 실패: '+qRes.status);
  if(!tbRes.ok) throw new Error('tiebreakers.json 로드 실패: '+tbRes.status);
  KB.questions = await qRes.json();     // {EI:[],SN:[],TF:[],JP:[]}
  KB.tiebreakers = await tbRes.json();  // {EI:[],SN:[],TF:[],JP:[]}
}

// ========== Question pickers ==========
function sampleTwo(arr){
  const idx = [...arr.keys()];
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return [arr[idx[0]], arr[idx[1]]];
}
function pickBaseQuestions(){
  baseQuestions = []; baseIds = [];
  usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
  AXES.forEach(axis=>{
    if(!KB.questions[axis] || KB.questions[axis].length < 2)
      throw new Error(`${axis} 축 문제은행이 2개 미만입니다.`);
    const [qA,qB] = sampleTwo(KB.questions[axis]);
    const q1 = { id:`base_${axis}_1`, axis, ...qA };
    const q2 = { id:`base_${axis}_2`, axis, ...qB };
    baseQuestions.push(q1,q2);
    baseIds.push(q1.id, q2.id);
    usedPromptsByAxis[axis].add(qA.prompt); usedPromptsByAxis[axis].add(qB.prompt);
  });
  for(let i=baseQuestions.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [baseQuestions[i],baseQuestions[j]]=[baseQuestions[j],baseQuestions[i]]; }
}
function pickTieBreaker(axis){
  const pool = KB.tiebreakers[axis] || [];
  const remaining = pool.filter(item => !usedPromptsByAxis[axis].has(item.prompt));
  if(remaining.length===0) return null;
  const item = remaining[Math.floor(Math.random()*remaining.length)];
  usedPromptsByAxis[axis].add(item.prompt);
  return item;
}

// ========== Render ==========
function makeQuestionBlock({id, axis, prompt, A, B, hint, isTB=false, indexNum=null}){
  const div=document.createElement('div');
  div.className='q'; div.dataset.axes=axis; div.id=id;
  const title = indexNum ? `${indexNum}) ${prompt}` : prompt;
  div.innerHTML = `
    <h3>${title}</h3>
    <div class="opts">
      <label><input type="radio" name="${id}" value="${A.value}"> <span>${A.label}</span></label>
      <label><input type="radio" name="${id}" value="${B.value}"> <span>${B.label}</span></label>
    </div>
    <div class="req">이 문항에 답해주세요.</div>
    ${hint?`<div class="hint">${hint}${isTB?' · (추가 확인 질문)':''}</div>`:(isTB?`<div class="hint">(추가 확인 질문)</div>`:'')}
  `;
  div.querySelectorAll('input[type="radio"]').forEach(r=>{ r.addEventListener('change', onAnyChange, {passive:true}); });
  return div;
}
function renderBaseQuestions(){
  const form=$('#form'); form.innerHTML='';
  pickBaseQuestions();
  baseQuestions.forEach((q, i)=>{
    form.appendChild(makeQuestionBlock({id:q.id, axis:q.axis, prompt:q.prompt, A:q.A, B:q.B, hint:q.hint, isTB:false, indexNum:i+1}));
  });
}

// 타이브레이커 추가
function appendTiebreaker(axis){
  const item = pickTieBreaker(axis);
  if(!item){ status(`타이브레이커 남은 항목 없음: ${axis}`); return false; }
  askedTB[axis]++;
  const id = `tb_${axis}_${askedTB[axis]}`;
  const block = makeQuestionBlock({
    id, axis, prompt:`추가 문항 · ${item.prompt}`, A:item.A, B:item.B, hint:item.hint||'', isTB:true
  });
  $('#form').appendChild(block);
  pendingTBIds.push(id);
  scrollToEl(block);
  status(`추가 문항 추가: ${axis} (#${askedTB[axis]})`);
  return true;
}

// ========== Logic ==========
function collectAnswers(){
  answers = [];
  document.querySelectorAll('input[type="radio"]:checked').forEach(inp=>{ answers.push(inp.value); });
  baseIds.forEach(name=>{
    const picked=document.querySelector(`input[name="${name}"]:checked`);
    const req=$('#'+name)?.querySelector('.req');
    if(req) req.style.display = picked?'none':'block';
  });
}
function countBaseAnswered(){ return baseIds.reduce((n,name)=> n + (document.querySelector(`input[name="${name}"]:checked`)?1:0), 0); }
function allBaseAnswered(){ return countBaseAnswered()===8; }

function computeMBTI(ans){
  const count={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0}, axisTotals={EI:0,SN:0,TF:0,JP:0};
  const axisMap={E:'EI',I:'EI',S:'SN',N:'SN',T:'TF',F:'TF',J:'JP',P:'JP'};
  for(const a of ans){ if(count[a]!=null){ count[a]++; axisTotals[axisMap[a]]++; } }
  const pick=(a,b,def)=> count[a]>count[b]?a:count[a]<count[b]?b:def;
  const ei=pick('E','I','E'), sn=pick('S','N','S'), tf=pick('T','F','T'), jp=pick('J','P','J');
  const mbti=ei+sn+tf+jp;
  const total = ans.length || 1;
  const diff=Math.abs(count.E-count.I)+Math.abs(count.S-count.N)+Math.abs(count.T-count.F)+Math.abs(count.J-count.P);
  const reliability=Math.round((diff/total)*100);
  const ties = { EI:count.E===count.I, SN:count.S===count.N, TF:count.T===count.F, JP:count.J===count.P };
  return {mbti,count,axisTotals,reliability,total,ties};
}
function isAnswered(name){ return !!document.querySelector(`input[name="${name}"]:checked`); }
function allPendingAnswered(){ return pendingTBIds.every(id => isAnswered(id)); }
function hasPendingForAxis(axis){ return pendingTBIds.some(id => id.startsWith(`tb_${axis}_`) && !isAnswered(id)); }
function nextTieAxisOrder(model){
  const res=[];
  if(model.axisTotals.EI>=2 && model.ties.EI && askedTB.EI<MAX_TB) res.push('EI');
  if(model.axisTotals.SN>=2 && model.ties.SN && askedTB.SN<MAX_TB) res.push('SN');
  if(model.axisTotals.TF>=2 && model.ties.TF && askedTB.TF<MAX_TB) res.push('TF');
  if(model.axisTotals.JP>=2 && model.ties.JP && askedTB.JP<MAX_TB) res.push('JP');
  return res;
}

// ========== Result UI: 보고서 한 페이지 & 결과 시 문항 제거 ==========
const AXIS_MEANING_LONG = {
  E:{name:'Extraversion · 외향', text:'에너지를 외부 상호작용에서 얻는 경향. 말하면서 생각을 정리하고 즉시 실행을 선호.'},
  I:{name:'Introversion · 내향', text:'에너지를 고요/몰입에서 얻는 경향. 먼저 정리하고 말하며, 깊이 파고드는 편.'},
  S:{name:'Sensing · 감각', text:'현재의 구체·사실에 주목. 검증된 방식과 실제 사례를 신뢰.'},
  N:{name:'iNtuition · 직관', text:'패턴과 가능성에 주목. 큰 그림을 먼저 세우고 세부를 유연하게 조정.'},
  T:{name:'Thinking · 사고', text:'논리·일관성을 우선. 공정한 기준과 설명 가능성을 중시.'},
  F:{name:'Feeling · 감정', text:'가치·관계의 조화를 우선. 수용도와 심리적 안전을 고려.'},
  J:{name:'Judging · 판단', text:'계획·마감 중심. 예측 가능성과 정돈을 선호.'},
  P:{name:'Perceiving · 인식', text:'유연·탐색 중심. 변화에 민첩하게 적응.'}
};
const TYPES=['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'];
const TYPE_DOMAINS={};
function setExplain(type, life, work, rel, study){ TYPE_DOMAINS[type]={life,work,rel,study}; }
setExplain('ISTJ',{tips:'생활: 루틴/예산 점검, 비상 계획 정기 갱신.'},{tips:'일: 역할·마감 합의 기록, 점검 목록으로 품질 안정.'},{tips:'인간관계: 약속·기대 분명히, 사실 기반 조정.'},{tips:'학습: 주간 계획과 복습 고정으로 축적.'});
setExplain('ENFP',{tips:'생활: 동시 과제 수 제한으로 에너지 분산 방지.'},{tips:'일: 아이디어 전개 후 범위 합의로 마무리 밀어붙이기.'},{tips:'인간관계: 경계와 휴식시간 확보.'},{tips:'학습: 흥미 유발, 점검 파트너로 완료율 관리.'});
TYPES.forEach(t=>{ if(TYPE_DOMAINS[t]) return;
  setExplain(t,
    {tips:'생활: 에너지 패턴 파악, 휴식 규칙.'},
    {tips:'일: 강점 역할 명확화, 협업 방식 합의.'},
    {tips:'인간관계: 기대·경계 공유, 피드백 정례화.'},
    {tips:'학습: 목표 단계화, 진행률 가시화.'}
  );
});

function ensureCaptureStyles(){
  if($('#capture-style')) return;
  const css=document.createElement('style'); css.id='capture-style';
  css.textContent = `
    /* 보고서 컨테이너 */
    #report-wrap{max-width:880px;margin:0 auto;padding:16px}
    #report-title{font-size:1.4rem;margin:0 0 12px}
    #report-meta{color:#6b7280;font-size:.92rem;margin-bottom:12px}

    /* 카드/표 스타일 */
    #result .stack{display:flex;flex-direction:column;gap:14px}
    #result .card{border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff;page-break-inside:avoid}
    #result .section-title{margin:0 0 8px;font-size:1.05rem}
    #result .kv{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    #result .badge{display:inline-block;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;font-size:.9rem;color:#374151;background:#f9fafb}
    #result .tip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
    #result .tip{border:1px dashed #e5e7eb;border-radius:10px;padding:10px;background:#fafafa}
    #result .tip strong{display:block;margin-bottom:6px}

    /* 표 */
    #result .table{width:100%;border-collapse:collapse}
    #result .table th,#result .table td{border:1px solid #e5e7eb;padding:6px 8px;text-align:center}
    #result .table thead th{background:#f9fafb}

    /* 인쇄/캡처 최적화 */
    @media print {
      body{background:#fff}
      #debug-panel,#debug-toggle{display:none !important}
      #form,.q,.hint,.req{display:none !important}
      #result{border-top:none;padding-top:0;margin-top:0}
      .card{box-shadow:none}
    }
  `;
  document.head.appendChild(css);
}

function renderResult(model, unresolvedAxes=[]){
  ensureCaptureStyles();

  // ✨ 결과 시점에 문항을 지우고 결과만 남깁니다.
  const form = $('#form');
  if(form){ form.innerHTML = ''; }

  const root = $('#result');
  root.innerHTML = '';

  const {mbti,count,axisTotals,reliability,total}=model;
  const dom = TYPE_DOMAINS[mbti] || {
    life:{tips:'생활: 루틴 최적화/휴식 규칙.'},
    work:{tips:'일: 역할/마감 합의, 협업 합의.'},
    rel:{tips:'인간관계: 기대/경계 공유.'},
    study:{tips:'학습: 단계 분해/진행률 가시화.'}
  };
  const badges = unresolvedAxes.length ? `<span class="badge">동률 유지: ${unresolvedAxes.join(', ')}</span>` : '';

  const legend = `
    <div class="legend small">
      ${Object.entries(AXIS_MEANING_LONG).map(([k,v])=>(
        `<div class="tip"><strong>${k} — ${v.name}</strong><div class="muted">${v.text}</div></div>`
      )).join('')}
    </div>`;

  // 📄 보고서 래퍼 (날짜 표기)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');

  root.innerHTML = `
    <div id="report-wrap">
      <h2 id="report-title">Quick-MBTI 결과 보고서</h2>
      <div id="report-meta">생성일: ${yyyy}-${mm}-${dd}</div>

      <div class="stack">
        <!-- (1) 결과 -->
        <div class="card">
          <div class="section-title">① 결과</div>
          <div class="kv">
            <div><strong>결과:</strong> <span class="mono" style="font-size:1.2rem">${mbti}</span></div>
            <div class="badge">신뢰도 ${reliability}%</div>
            ${badges}
          </div>
          <table class="table small" style="margin-top:10px">
            <thead><tr><th>축</th><th>득점</th><th>문항수</th><th>우세</th></tr></thead>
            <tbody>
              <tr><td>E vs I</td><td>${count.E} : ${count.I}</td><td>${axisTotals.EI}</td><td>${count.E>=count.I?'E':'I'}</td></tr>
              <tr><td>S vs N</td><td>${count.S} : ${count.N}</td><td>${axisTotals.SN}</td><td>${count.S>=count.N?'S':'N'}</td></tr>
              <tr><td>T vs F</td><td>${count.T} : ${count.F}</td><td>${axisTotals.TF}</td><td>${count.T>=count.F?'T':'F'}</td></tr>
              <tr><td>J vs P</td><td>${count.J} : ${count.P}</td><td>${axisTotals.JP}</td><td>${count.J>=count.P?'J':'P'}</td></tr>
            </tbody>
          </table>
        </div>

        <!-- (2) 팁: 생활/일/인간관계/학습 (모두 노출) -->
        <div class="card">
          <div class="section-title">② 팁</div>
          <div class="tip-grid">
            <div class="tip"><strong>생활</strong>${dom.life.tips}</div>
            <div class="tip"><strong>일(업무)</strong>${dom.work.tips}</div>
            <div class="tip"><strong>인간관계</strong>${dom.rel.tips}</div>
            <div class="tip"><strong>학습</strong>${dom.study.tips}</div>
          </div>
        </div>

        <!-- (3) MBTI 의미 (확장 설명) -->
        <div class="card">
          <div class="section-title">③ MBTI 의미</div>
          ${legend}
        </div>
      </div>
    </div>
  `;

  root.style.display = 'block';
  scrollToEl(root);
}

// ========== Flow ==========
function onAnyChange(e){
  collectAnswers();
  renderDebug(computeMBTI(answers));

  if(!baseDone){
    if(countBaseAnswered() < 8) return;
    baseDone = true;
    evaluateOrAsk();
    return;
  }
  const changed = e?.target?.name || '';
  if(/^tb_/.test(changed)){
    evaluateOrAsk();
  }
}
function evaluateOrAsk(){
  const model = computeMBTI(answers);
  pendingTBIds = pendingTBIds.filter(id => !isAnswered(id));

  let addedNow = 0;
  for(const axis of nextTieAxisOrder(model)){
    if(!hasPendingForAxis(axis) && askedTB[axis] < MAX_TB){
      if(appendTiebreaker(axis)) addedNow++;
    }
  }
  if(addedNow>0){ renderDebug(computeMBTI(answers)); return; }
  if(!allPendingAnswered()){ renderDebug(computeMBTI(answers)); return; }

  const latest = computeMBTI(answers);
  let addedNext = 0;
  for(const axis of nextTieAxisOrder(latest)){
    if(askedTB[axis] < MAX_TB && !hasPendingForAxis(axis)){
      if(appendTiebreaker(axis)) addedNext++;
    }
  }
  if(addedNext>0){ renderDebug(computeMBTI(answers)); return; }

  const unresolved=[];
  if(latest.ties.EI && askedTB.EI>=MAX_TB) unresolved.push('EI');
  if(latest.ties.SN && askedTB.SN>=MAX_TB) unresolved.push('SN');
  if(latest.ties.TF && askedTB.TF>=MAX_TB) unresolved.push('TF');
  if(latest.ties.JP && askedTB.JP>=MAX_TB) unresolved.push('JP');
  renderResult(latest, unresolved);
  renderDebug(latest);
}

function init(){
  askedTB={EI:0,SN:0,TF:0,JP:0};
  answers=[]; baseDone=false; pendingTBIds=[];
  renderBaseQuestions();
  $('#form').addEventListener('change', onAnyChange, {passive:true});
  renderDebug(computeMBTI(answers));
}

// ========== Boot ==========
ensureDebugShell();
document.addEventListener('DOMContentLoaded', ()=>{
  ensureDebugShell();
  loadData().then(init).catch(err=>{
    console.error('데이터 로드 실패:', err);
    const form=$('#form');
    form.innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/*.json 경로와 GitHub Pages 배포 상태를 확인해 주세요.</div></div>';
  });
});
