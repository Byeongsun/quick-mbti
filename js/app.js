// ========== Config ==========
const VER = '20250816';
const DATA_URLS = {
  questions: `data/questions.json?v=${VER}`,
  tiebreakers: `data/tiebreakers.json?v=${VER}`
};
const AXES = ['EI','SN','TF','JP'];
const MAX_TB = 2;   // 축별 추가문항 최대(0~2)

// 🔧 DEBUG: 기본 OFF. ?debug=1 또는 localStorage=1 일 때만 ON
const DEBUG = (() => {
  const q = new URLSearchParams(location.search).get('debug');
  if (q === '1') return true;    // 쿼리로 강제 ON
  if (q === '0') return false;   // 쿼리로 강제 OFF
  return localStorage.getItem('quick_mbti_debug') === '1'; // 저장소 플래그
})();

// 혹시 예전 캐시에서 뜬 디버그 패널이 남아있으면 제거
if (!DEBUG) {
  document.getElementById('debug-panel')?.remove();
  document.getElementById('debug-toggle')?.remove();
}

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }
function log(...a){ if (DEBUG) console.debug('[quick-mbti]', ...a); }

// ========== State ==========
let KB = { questions:null, tiebreakers:null };
let baseQuestions = [];
let baseIds = [];
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];
let askedTB = {EI:0,SN:0,TF:0,JP:0};
let baseDone = false;
let pendingTBIds = [];

// ========== Debug Panel (기본 숨김) ==========
function ensureDebugShell(){
  if(!DEBUG) return;
  if(!document.body){ document.addEventListener('DOMContentLoaded', ensureDebugShell, {once:true}); return; }
  if($('#debug-panel')) return;

  const style = document.createElement('style');
  style.textContent = `
    #debug-panel{position:fixed;right:12px;bottom:12px;z-index:9999;background:#0f172a;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:360px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #debug-panel summary{cursor:pointer;list-style:none;padding:10px 12px;margin:0}
    #debug-panel details[open] summary{border-bottom:1px solid rgba(255,255,255,.15)}
    #debug-panel .body{padding:10px 12px}
    #debug-panel table{width:100%;border-collapse:collapse;margin-top:6px}
    #debug-panel th,#debug-panel td{border:1px solid rgba(255,255,255,.15);padding:4px 6px;text-align:center}
    #debug-panel .row{display:flex;gap:8px;flex-wrap:wrap}
    #debug-panel .tag{display:inline-block;border:1px solid rgba(255,255,255,.25);padding:2px 6px;border-radius:999px}
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'debug-panel';
  box.innerHTML = `
    <details open>
      <summary>🛠 Debug (실시간 합계)</summary>
      <div class="body" id="debug-body">로드 중...</div>
    </details>`;
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
  $('#debug-body').innerHTML = `
    <table>${rows}</table>
    <div class="row" style="margin-top:6px">
      ${tag('기본응답', `${baseCount}/8`)} ${tag('baseDone', baseDone)}
      ${tag('대기TB', pendCount)} ${tag('EI TB', askedTB.EI)}
      ${tag('SN TB', askedTB.SN)} ${tag('TF TB', askedTB.TF)} ${tag('JP TB', askedTB.JP)}
      ${tag('신뢰도', `${model.reliability}%`)}
    </div>
    <div class="muted" style="opacity:.7;margin-top:4px">※ 대기TB>0이면 결과 렌더 보류</div>`;
}

// ========== Fetch ==========
async function loadData(){
  const [qRes, tbRes] = await Promise.all([
    fetch(DATA_URLS.questions, {cache:'no-store'}),
    fetch(DATA_URLS.tiebreakers, {cache:'no-store'})
  ]);
  if(!qRes.ok) throw new Error('questions.json 로드 실패: '+qRes.status);
  if(!tbRes.ok) throw new Error('tiebreakers.json 로드 실패: '+tbRes.status);
  KB.questions = await qRes.json();
  KB.tiebreakers = await tbRes.json();
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
    const bank=KB.questions?.[axis]||[];
    if(bank.length<2) throw new Error(`${axis} 축 문제은행이 2개 미만입니다.`);
    const [qA,qB]=sampleTwo(bank);
    const q1={id:`base_${axis}_1`,axis,...qA};
    const q2={id:`base_${axis}_2`,axis,...qB};
    baseQuestions.push(q1,q2);
    baseIds.push(q1.id,q2.id);
    usedPromptsByAxis[axis].add(qA.prompt); usedPromptsByAxis[axis].add(qB.prompt);
  });
  // 전체 섞기
  for(let i=baseQuestions.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [baseQuestions[i],baseQuestions[j]]=[baseQuestions[j],baseQuestions[i]]; }
}
function pickTieBreaker(axis){
  const pool=KB.tiebreakers?.[axis]||[];
  const remain=pool.filter(it=>!usedPromptsByAxis[axis].has(it.prompt));
  if(remain.length===0) return null;
  const item=remain[Math.floor(Math.random()*remain.length)];
  usedPromptsByAxis[axis].add(item.prompt);
  return item;
}

// ========== Render ==========
function makeQuestionBlock({id,axis,prompt,A,B,hint,isTB=false,indexNum=null}){
  const div=document.createElement('div');
  div.className='q'; div.dataset.axes=axis; div.id=id;
  const title=indexNum?`${indexNum}) ${prompt}`:prompt;
  div.innerHTML=`
    <h3>${title}</h3>
    <div class="opts">
      <label><input type="radio" name="${id}" value="${A.value}"> <span>${A.label}</span></label>
      <label><input type="radio" name="${id}" value="${B.value}"> <span>${B.label}</span></label>
    </div>
    <div class="req">이 문항에 답해주세요.</div>
    ${hint?`<div class="hint">${hint}${isTB?' · (추가 확인 질문)':''}</div>`:(isTB?`<div class="hint">(추가 확인 질문)</div>`:'')}
  `;
  div.querySelectorAll('input[type="radio"]').forEach(r=>r.addEventListener('change', onAnyChange, {passive:true}));
  return div;
}
function renderBaseQuestions(){
  const form=$('#form'); form.innerHTML='';
  pickBaseQuestions();
  baseQuestions.forEach((q,i)=>{
    form.appendChild(makeQuestionBlock({id:q.id,axis:q.axis,prompt:q.prompt,A:q.A,B:q.B,hint:q.hint,isTB:false,indexNum:i+1}));
  });
}

// ========== Logic ==========
function collectAnswers(){
  answers = [];
  document.querySelectorAll('input[type="radio"]:checked').forEach(inp=>answers.push(inp.value));
  // 필수 표기
  baseIds.forEach(name=>{
    const picked=document.querySelector(`input[name="${name}"]:checked`);
    const req=$('#'+name)?.querySelector('.req');
    if(req) req.style.display = picked?'none':'block';
  });
}
function countBaseAnswered(){ return baseIds.reduce((n,name)=> n + (document.querySelector(`input[name="${name}"]:checked`)?1:0), 0); }
function isAnswered(name){ return !!document.querySelector(`input[name="${name}"]:checked`); }
function allPendingAnswered(){ return pendingTBIds.every(id=>isAnswered(id)); }

function computeMBTI(ans){
  const count={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0}, axisTotals={EI:0,SN:0,TF:0,JP:0};
  const axisMap={E:'EI',I:'EI',S:'SN',N:'SN',T:'TF',F:'TF',J:'JP',P:'JP'};
  for(const a of ans){ if(count[a]!=null){ count[a]++; axisTotals[axisMap[a]]++; } }
  const pick=(a,b,def)=> count[a]>count[b]?a:count[a]<count[b]?b:def;
  const ei=pick('E','I','E'), sn=pick('S','N','S'), tf=pick('T','F','T'), jp=pick('J','P','J');
  const mbti=ei+sn+tf+jp;
  const total=ans.length||1;
  const diff=Math.abs(count.E-count.I)+Math.abs(count.S-count.N)+Math.abs(count.T-count.F)+Math.abs(count.J-count.P);
  const reliability=Math.round((diff/total)*100);
  const ties={ EI:count.E===count.I, SN:count.S===count.N, TF:count.T===count.F, JP:count.J===count.P };
  return {mbti,count,axisTotals,reliability,total,ties};
}
function hasPendingForAxis(axis){
  return pendingTBIds.some(id=>id.startsWith(`tb_${axis}_`) && !isAnswered(id));
}
function tieAxesToAsk(model){
  const out=[];
  if(model.axisTotals.EI>=2 && model.ties.EI && askedTB.EI<MAX_TB) out.push('EI');
  if(model.axisTotals.SN>=2 && model.ties.SN && askedTB.SN<MAX_TB) out.push('SN');
  if(model.axisTotals.TF>=2 && model.ties.TF && askedTB.TF<MAX_TB) out.push('TF');
  if(model.axisTotals.JP>=2 && model.ties.JP && askedTB.JP<MAX_TB) out.push('JP');
  return out;
}

// ========== 결과(텍스트 보고서) ==========
const TYPE_DOMAINS={};
function setExplain(type, life, work, rel, study){ TYPE_DOMAINS[type]={life,work,rel,study}; }
setExplain('ISTJ',{tips:'생활: 루틴/예산 점검, 비상 계획 정기 갱신.'},{tips:'일: 역할·마감 합의 기록, 점검 목록으로 품질 안정.'},{tips:'인간관계: 약속·기대 분명히, 사실 기반 조정.'},{tips:'학습: 주간 계획과 복습 고정으로 축적.'});
setExplain('ENFP',{tips:'생활: 동시 과제 수 제한으로 에너지 분산 방지.'},{tips:'일: 아이디어 전개 후 범위 합의로 마무리 밀어붙이기.'},{tips:'인간관계: 경계와 휴식시간 확보.'},{tips:'학습: 흥미 유발, 점검 파트너로 완료율 관리.'});

function ensureReportStyles(){
  if($('#capture-style')) return;
  const css=document.createElement('style'); css.id='capture-style';
  css.textContent = `
    #result pre{background:#fff;border:1px solid #e5e7eb;padding:16px;border-radius:10px;white-space:pre-wrap;line-height:1.55}
    @media print{ #form{display:none!important} body{background:#fff} }
  `;
  document.head.appendChild(css);
}
function renderResult(model, unresolvedAxes=[]){
  ensureReportStyles();

  // 결과만 남김(문항 제거)
  const form=$('#form'); if(form) form.innerHTML='';

  const {mbti,reliability}=model;
  const tips = TYPE_DOMAINS[mbti] || {
    life:{tips:'생활: 에너지 패턴을 이해하고 휴식 규칙을 마련하세요.'},
    work:{tips:'일: 강점 역할을 명확히 하고 협업 방식을 합의하세요.'},
    rel:{tips:'인간관계: 기대·경계를 공유하고 피드백을 정례화하세요.'},
    study:{tips:'학습: 목표를 단계로 나눠 진행률을 가시화하세요.'}
  };
  const unresolved = unresolvedAxes.length ? ` (동률 유지: ${unresolvedAxes.join(', ')})` : '';

  $('#result').innerHTML = `
<pre>
[결과]
${mbti}   신뢰도: ${reliability}%${unresolved}

[팁]
- 생활
${tips.life.tips}
- 일
${tips.work.tips}
- 인간관계
${tips.rel.tips}
- 학습
${tips.study.tips}

[MBTI 의미]
E                           I
S                           N
T                           F
J                           P
</pre>`;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// ========== Flow ==========
function onAnyChange(e){
  collectAnswers();

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
function appendTB(axis){
  const item = pickTieBreaker(axis);
  if(!item) return false;
  askedTB[axis]++;
  const id=`tb_${axis}_${askedTB[axis]}`;
  const block = makeQuestionBlock({
    id, axis, prompt:`추가 문항 · ${item.prompt}`, A:item.A, B:item.B, hint:item.hint||'', isTB:true
  });
  $('#form').appendChild(block);
  pendingTBIds.push(id);
  scrollToEl(block);
  return true;
}
function evaluateOrAsk(){
  const model = computeMBTI(answers);

  // 이미 답한 추가문항 제거
  pendingTBIds = pendingTBIds.filter(id=>!isAnswered(id));

  // 동률 축 후보
  const candidates = tieAxesToAsk(model);

  // 후보 축마다 대기 없고 한도 미달이면 즉시 1문항씩 추가
  let added=0;
  for(const axis of candidates){
    if(!hasPendingForAxis(axis) && askedTB[axis] < MAX_TB){
      if(appendTB(axis)) added++;
    }
  }
  if(added>0) return;            // 응답 대기

  // 추가문항 대기 중이면 결과 보류
  if(!allPendingAnswered()) return;

  // 재평가
  const latest = computeMBTI(answers);

  // 여전히 동률인데 더 이상 물을 수 없거나(한도 도달/풀 없음) → 결과
  const unresolved=[];
  if(latest.ties.EI && askedTB.EI>=MAX_TB) unresolved.push('EI');
  if(latest.ties.SN && askedTB.SN>=MAX_TB) unresolved.push('SN');
  if(latest.ties.TF && askedTB.TF>=MAX_TB) unresolved.push('TF');
  if(latest.ties.JP && askedTB.JP>=MAX_TB) unresolved.push('JP');

  renderResult(latest, unresolved);
}

// ========== Boot ==========
if (DEBUG) ensureDebugShell();  // 기본 OFF이므로 대부분 실행 안 됨
document.addEventListener('DOMContentLoaded', ()=>{
  loadData().then(()=>{
    askedTB={EI:0,SN:0,TF:0,JP:0};
    answers=[]; baseDone=false; pendingTBIds=[];
    $('#result').innerHTML='';
    renderBaseQuestions();
    $('#form').addEventListener('change', onAnyChange, {passive:true});
  }).catch(err=>{
    console.error('데이터 로드 실패:', err);
    $('#form').innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/*.json 경로와 배포 캐시를 확인하세요.</div></div>';
  });
});
