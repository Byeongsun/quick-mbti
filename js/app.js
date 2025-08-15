// ========== Config ==========
const DATA_URLS = {
  questions: 'data/questions.json',
  tiebreakers: 'data/tiebreakers.json'
};
const AXIS_OF = { q1:'EI', q2:'EI', q3:'SN', q4:'SN', q5:'TF', q6:'TF', q7:'JP', q8:'JP' };
const MAX_TB = 2; // 축별 추가문항 최대(0~2) → 전체 최대 8개
const DEBUG = true; // 디버그 패널 온/오프

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'}); }catch{} }
function status(msg){ console.debug('[quick-mbti]', msg); }

// ========== State ==========
let KB = { questions:null, tiebreakers:null };
let answers = [];                         // 전체 선택(E/I/S/N/T/F/J/P)
let askedTB = {EI:0,SN:0,TF:0,JP:0};     // 축별 추가문항 제공 횟수
let baseDone = false;                     // 기본 8문항 완료 여부
let pendingTBIds = [];                    // 아직 답하지 않은 추가문항 name 목록

// ========== Debug UI ==========
function ensureDebugShell(){
  if(!DEBUG) return;
  if($('#debug-panel')) return;

  const css = document.createElement('style');
  css.textContent = `
    #debug-panel{position:fixed;right:12px;bottom:12px;z-index:9999;background:#111827;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:340px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #debug-panel details[open] summary{border-bottom:1px solid rgba(255,255,255,.15)}
    #debug-panel summary{cursor:pointer;list-style:none;padding:10px 12px;margin:0}
    #debug-panel .body{padding:10px 12px}
    #debug-panel table{width:100%;border-collapse:collapse;margin-top:6px;background:transparent}
    #debug-panel th,#debug-panel td{border:1px solid rgba(255,255,255,.15);padding:4px 6px;text-align:center}
    #debug-panel .row{display:flex;gap:8px;flex-wrap:wrap}
    #debug-panel .tag{display:inline-block;border:1px solid rgba(255,255,255,.25);padding:2px 6px;border-radius:999px}
    #debug-panel .ok{color:#10b981} #debug-panel .warn{color:#f59e0b} #debug-panel .muted{color:#9ca3af}
  `;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'debug-panel';
  box.innerHTML = `
    <details open>
      <summary>🛠 Debug (실시간 합계)</summary>
      <div class="body" id="debug-body">
        <div class="muted">응답에 따라 즉시 업데이트됩니다.</div>
      </div>
    </details>
  `;
  document.body.appendChild(box);
}

function renderDebug(model){
  if(!DEBUG) return;
  ensureDebugShell();

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
  const flags = `
    <div class="row" style="margin-top:6px">
      ${tag('기본응답', `${baseCount}/8`)}
      ${tag('baseDone', baseDone)}
      ${tag('대기TB', pendCount)}
      ${tag('EI TB', askedTB.EI)}
      ${tag('SN TB', askedTB.SN)}
      ${tag('TF TB', askedTB.TF)}
      ${tag('JP TB', askedTB.JP)}
      ${tag('신뢰도', `${model.reliability}%`)}
    </div>
  `;

  $('#debug-body').innerHTML = `
    <table>${rows}</table>
    ${flags}
    <div class="muted" style="margin-top:4px">※ 대기TB>0이면 결과 렌더를 보류합니다.</div>
  `;
}

// ========== Fetch ==========
async function loadData(){
  const [qRes, tbRes] = await Promise.all([
    fetch(DATA_URLS.questions),
    fetch(DATA_URLS.tiebreakers)
  ]);
  if(!qRes.ok) throw new Error('questions.json 로드 실패: '+qRes.status);
  if(!tbRes.ok) throw new Error('tiebreakers.json 로드 실패: '+tbRes.status);
  KB.questions = await qRes.json();
  KB.tiebreakers = await tbRes.json();
  if(!KB.questions || !KB.tiebreakers) throw new Error('JSON 파싱 실패');
}

// ========== Render ==========
function makeQuestionBlock({id, axis, prompt, A, B, hint, isTB=false, indexNum=null}){
  const div=document.createElement('div');
  div.className='q';
  div.dataset.axes=axis;
  div.id=id;
  const title = indexNum ? `${indexNum}) ${prompt}` : prompt;
  div.innerHTML=`
    <h3>${title}</h3>
    <div class="opts">
      <label><input type="radio" name="${id}" value="${A.value}"> <span>${A.label}</span></label>
      <label><input type="radio" name="${id}" value="${B.value}"> <span>${B.label}</span></label>
    </div>
    <div class="req">이 문항에 답해주세요.</div>
    ${hint?`<div class="hint">${hint}${isTB?' · (추가 확인 질문)':''}</div>`:(isTB?`<div class="hint">(추가 확인 질문)</div>`:'')}
  `;
  // 개별 라디오에도 바인딩 (안전망)
  div.querySelectorAll('input[type="radio"]').forEach(r=>{
    r.addEventListener('change', onAnyChange, {passive:true});
  });
  return div;
}

function renderBaseQuestions(){
  const form=$('#form'); form.innerHTML='';
  let idx=1;
  for(const qid of Object.keys(AXIS_OF)){
    const bank = KB.questions[qid];
    const pick = bank[Math.floor(Math.random()*bank.length)];
    const axis = AXIS_OF[qid];
    const block = makeQuestionBlock({
      id: qid, axis, prompt: pick.prompt, A: pick.A, B: pick.B, hint: pick.hint, isTB:false, indexNum: idx
    });
    form.appendChild(block); idx++;
  }
}

function appendTiebreaker(axis){
  const pool = KB.tiebreakers[axis] || [];
  if(!pool.length) { status(`타이브레이커 풀이 없음: ${axis}`); return false; }
  const idx = askedTB[axis] % pool.length;   // 중복 최소화
  const item = pool[idx];
  askedTB[axis]++;

  const id = `tb_${axis}_${askedTB[axis]}`;
  const block = makeQuestionBlock({
    id, axis, prompt: `추가 문항 · ${item.prompt}`, A:item.A, B:item.B, hint:item.hint||'', isTB:true, indexNum:null
  });
  $('#form').appendChild(block);

  // 대기 목록에 등록 (아직 체크 전)
  pendingTBIds.push(id);

  scrollToEl(block);
  status(`추가 문항 추가: ${axis} (#${askedTB[axis]})`);
  return true;
}

// ========== Logic ==========
function collectAnswers(){
  answers = [];
  document.querySelectorAll('input[type="radio"]:checked').forEach(inp=>{
    answers.push(inp.value);
  });
  // 기본문항 미응답 표시
  Object.keys(AXIS_OF).forEach(qid=>{
    const picked=document.querySelector(`input[name="${qid}"]:checked`);
    const req=$('#'+qid)?.querySelector('.req');
    if(req) req.style.display = picked?'none':'block';
  });
}

function countBaseAnswered(){
  return Object.keys(AXIS_OF).reduce((n, qid)=> n + (document.querySelector(`input[name="${qid}"]:checked`)?1:0), 0);
}
function allBaseAnswered(){ return countBaseAnswered() === 8; }

function computeMBTI(ans){
  const count={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0};
  const axisTotals={EI:0,SN:0,TF:0,JP:0};
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
function hasPendingForAxis(axis){
  return pendingTBIds.some(id => id.startsWith(`tb_${axis}_`) && !isAnswered(id));
}

function nextTieAxisOrder(model){
  const res=[];
  if(model.axisTotals.EI>=2 && model.ties.EI && askedTB.EI<MAX_TB) res.push('EI');
  if(model.axisTotals.SN>=2 && model.ties.SN && askedTB.SN<MAX_TB) res.push('SN');
  if(model.axisTotals.TF>=2 && model.ties.TF && askedTB.TF<MAX_TB) res.push('TF');
  if(model.axisTotals.JP>=2 && model.ties.JP && askedTB.JP<MAX_TB) res.push('JP');
  return res;
}

// ========== Result UI (동일) ==========
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
setExplain('ISTJ',
  {tips:'생활: 루틴/예산 점검, 비상 계획 정기 갱신.'},
  {tips:'일: 역할·마감 합의 기록, 점검 목록으로 품질 안정.'},
  {tips:'인간관계: 약속·기대 분명히, 사실 기반 조정.'},
  {tips:'학습: 주간 계획과 복습 고정으로 축적.'}
);
setExplain('ENFP',
  {tips:'생활: 동시 과제 수를 제한해 에너지 분산을 방지.'},
  {tips:'일: 아이디어 전개 후 범위 합의로 마무리 밀어붙이기.'},
  {tips:'인간관계: 경계와 휴식시간 확보.'},
  {tips:'학습: 흥미를 당기고, 점검 파트너로 완료율 관리.'}
);
TYPES.forEach(t=>{
  if(TYPE_DOMAINS[t]) return;
  setExplain(t,
    {tips:'생활: 에너지 패턴을 이해하고 휴식 규칙 마련.'},
    {tips:'일: 강점 역할 명확화, 협업 방식 합의.'},
    {tips:'인간관계: 기대·경계 공유, 피드백 정례화.'},
    {tips:'학습: 목표를 단계로 나눠 진행률 가시화.'}
  );
});

function renderResult(model, unresolvedAxes=[]){
  const root=$('#result'); root.innerHTML='';
  const {mbti,count,axisTotals,reliability,total}=model;
  const dom = TYPE_DOMAINS[mbti] || {
    life:{tips:'생활: 루틴 최적화와 휴식 규칙.'},
    work:{tips:'일: 역할·마감 합의, 협업 방식 합의.'},
    rel:{tips:'인간관계: 기대·경계 공유, 피드백 정례화.'},
    study:{tips:'학습: 단계 분해와 진행률 가시화.'}
  };
  const badges = unresolvedAxes.length ? `<span class="muted small">동률 유지: ${unresolvedAxes.join(', ')}</span>` : '';
  const legend = `
    <div class="legend small">
      ${Object.entries(AXIS_MEANING_LONG).map(([k,v])=>(
        `<div><strong>${k}</strong> — ${v.name}<br/><span class="muted">${v.text}</span></div>`
      )).join('')}
    </div>`;

  root.innerHTML=`
    <h2>결과: <span class="mono">${mbti}</span> ${badges}</h2>
    <div class="row">
      <div class="card">
        <div><strong>신뢰도</strong>:
          <span class="${reliability>=70?'ok':(reliability>=40?'warn':'low')}">${reliability}%</span>
          <span class="muted small">(응답 수 ${total} 정규화 · 축별 격차 기반)</span>
        </div>
        <table class="table small">
          <thead><tr><th>축</th><th>득점</th><th>문항수</th><th>우세</th></tr></thead>
          <tbody>
            <tr><td>E vs I</td><td>${count.E} : ${count.I}</td><td>${axisTotals.EI}</td><td>${count.E>=count.I?'E':'I'}</td></tr>
            <tr><td>S vs N</td><td>${count.S} : ${count.N}</td><td>${axisTotals.SN}</td><td>${count.S>=count.N?'S':'N'}</td></tr>
            <tr><td>T vs F</td><td>${count.T} : ${count.F}</td><td>${axisTotals.TF}</td><td>${count.T>=count.F?'T':'F'}</td></tr>
            <tr><td>J vs P</td><td>${count.J} : ${count.P}</td><td>${axisTotals.JP}</td><td>${count.J>=count.P?'J':'P'}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="tabs">
          <button class="tab active" data-tab="life">생활</button>
          <button class="tab" data-tab="work">일</button>
          <button class="tab" data-tab="rel">인간관계</button>
          <button class="tab" data-tab="study">학습</button>
        </div>
        <div id="domain-life" class="domain active small"><strong>생활</strong><br/>${dom.life.tips}</div>
        <div id="domain-work" class="domain small"><strong>일(업무)</strong><br/>${dom.work.tips}</div>
        <div id="domain-rel" class="domain small"><strong>인간관계</strong><br/>${dom.rel.tips}</div>
        <div id="domain-study" class="domain small"><strong>학습</strong><br/>${dom.study.tips}</div>
      </div>
    </div>
    <h3 style="margin-top:14px">MBTI 축 의미(확장)</h3>
    ${legend}
  `;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// ========== Flow ==========
function onAnyChange(e){
  collectAnswers();

  // 1) 현재 상태(중간이라도) 디버그 패널 갱신
  renderDebug(computeMBTI(answers));

  // 2) 기본 8개가 모두 끝나기 전에는 아무 것도 하지 않음
  if(!baseDone){
    const n = countBaseAnswered();
    if(n < 8) return;

    // 이제 막 8개가 채워진 순간 → 최초 평가/추가문항 제공
    baseDone = true;
    evaluateOrAsk();
    return;
  }

  // 3) 기본 완료 이후에는 '추가 문항(tb_*)' 응답에만 반응
  const changedName = e?.target?.name || '';
  if(/^tb_/.test(changedName)){
    evaluateOrAsk();
  }
}

function evaluateOrAsk(){
  // 현재 답변 기준 1차 평가
  const model = computeMBTI(answers);

  // 대기 중 추가문항 목록에서 이미 답한 항목 제거
  pendingTBIds = pendingTBIds.filter(id => !isAnswered(id));

  // 동률 축에 대해, 아직 대기 추가문항이 없고 제공 한도 미달이면 각 축별 1개씩 추가
  const order = nextTieAxisOrder(model);
  let addedNow = 0;
  for(const axis of order){
    if(!hasPendingForAxis(axis) && askedTB[axis] < MAX_TB){
      if(appendTiebreaker(axis)) addedNow++;
    }
  }

  // 🔒 방어: 방금이라도 1개 이상 추가했다면 결과 렌더 금지 (사용자 응답 대기)
  if(addedNow > 0){
    renderDebug(computeMBTI(answers));
    return;
  }

  // 아직 답하지 않은 추가문항이 있으면 → 결과 보류
  if(!allPendingAnswered()){
    status(`대기 중 추가문항: ${pendingTBIds.length}개`);
    renderDebug(computeMBTI(answers));
    return;
  }

  // 모든 추가문항 응답 완료 → 최신 답변으로 재평가
  const latest = computeMBTI(answers);

  // 여전히 동률이고 더 묻을 수 있으며 해당 축 대기 없으면 다음 라운드 추가
  let addedNextRound = 0;
  const order2 = nextTieAxisOrder(latest);
  for(const axis of order2){
    if(askedTB[axis] < MAX_TB && !hasPendingForAxis(axis)){
      if(appendTiebreaker(axis)) addedNextRound++;
    }
  }
  if(addedNextRound > 0){
    renderDebug(computeMBTI(answers));
    return; // 사용자 응답 후 다시 평가
  }

  // 더 묻지 못하거나 동률 해소 → 결과 렌더
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
  answers=[];
  baseDone=false;
  pendingTBIds=[];
  renderBaseQuestions();

  // 폼 델리게이션 (동적으로 추가되는 문항 포함)
  $('#form').addEventListener('change', onAnyChange, {passive:true});

  // 최초 디버그 패널
  renderDebug(computeMBTI(answers));
}

// ========== Boot ==========
document.addEventListener('DOMContentLoaded', ()=>{
  ensureDebugShell();
  loadData().then(init).catch(err=>{
    console.error('데이터 로드 실패:', err);
    const form=$('#form');
    form.innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/*.json 경로와 GitHub Pages 배포 상태를 확인해 주세요.</div></div>';
  });
});
