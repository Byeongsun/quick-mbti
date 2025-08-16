// ================= Config =================
const VER = '20250816';
const DATA_URLS = {
  questions: `data/questions.json?v=${VER}`,
  tiebreakers: `data/tiebreakers.json?v=${VER}`
};
const AXES = ['EI','SN','TF','JP'];
const MAX_TB = 2;              // 축별 추가문항 최대(0~2)

// 🔧 DEBUG 기본 OFF (쿼리 ?debug=1 또는 localStorage 플래그로만 ON)
const DEBUG = (new URLSearchParams(location.search).get('debug') === '1') ||
              (localStorage.getItem('quick_mbti_debug') === '1');

// ================= DOM utils =================
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }
function log(...a){ if (DEBUG) console.debug('[quick-mbti]', ...a); }

// ================= State =================
let KB = { questions:null, tiebreakers:null };
let baseQuestions = [];             // [{id,axis,prompt,A,B,hint}]
let baseIds = [];                   // ['base_EI_1', ...]
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];                   // ['E','I', ...] (collectAnswers에서 채움)
let askedTB = {EI:0,SN:0,TF:0,JP:0};
let baseDone = false;               // 기본 8문항 완료
let pendingTBIds = [];              // 아직 답하지 않은 추가문항의 name

// ================= Debug Panel (기본 숨김) =================
function ensureDebugShell(){
  if(!DEBUG) return;
  if(!document.body){ document.addEventListener('DOMContentLoaded', ensureDebugShell, {once:true}); return; }
  if($('#debug-panel')) return;

  const style = document.createElement('style');
  style.textContent = `
    #debug-panel{position:fixed;right:12px;bottom:12px;z-index:9999;background:#0f172a;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:360px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #debug-panel details[open] summary{border-bottom:1px solid rgba(255,255,255,.15)}
    #debug-panel summary{cursor:pointer;list-style:none;padding:10px 12px;margin:0}
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
  $('#debug-body').innerHTML = `
    <table>${rows}</table>
    <div class="row" style="margin-top:6px">
      ${tag('기본응답', `${baseCount}/8`)} ${tag('baseDone', baseDone)}
      ${tag('대기TB', pendCount)} ${tag('EI TB', askedTB.EI)}
      ${tag('SN TB', askedTB.SN)} ${tag('TF TB', askedTB.TF)} ${tag('JP TB', askedTB.JP)}
      ${tag('신뢰도', `${model.reliability}%`)}
    </div>
    <div class="muted" style="opacity:.7;margin-top:4px">※ 대기TB>0이면 결과 렌더를 보류합니다.</div>`;
}

// ================= Fetch =================
async function loadData(){
  const [qRes, tbRes] = await Promise.all([
    fetch(DATA_URLS.questions, {cache:'no-store'}),
    fetch(DATA_URLS.tiebreakers, {cache:'no-store'})
  ]);
  if(!qRes.ok) throw new Error('questions.json 로드 실패: '+qRes.status);
  if(!tbRes.ok) throw new Error('tiebreakers.json 로드 실패: '+tbRes.status);
  KB.questions = await qRes.json();     // {EI:[],SN:[],TF:[],JP:[]}
  KB.tiebreakers = await tbRes.json();  // {EI:[],SN:[],TF:[],JP:[]}
  log('loaded:', {
    EI_Q: KB.questions?.EI?.length ?? 0,
    SN_Q: KB.questions?.SN?.length ?? 0,
    TF_Q: KB.questions?.TF?.length ?? 0,
    JP_Q: KB.questions?.JP?.length ?? 0,
    EI_TB: KB.tiebreakers?.EI?.length ?? 0,
    SN_TB: KB.tiebreakers?.SN?.length ?? 0,
    TF_TB: KB.tiebreakers?.TF?.length ?? 0,
    JP_TB: KB.tiebreakers?.JP?.length ?? 0,
  });
}

// ================= Question pickers =================
function sampleTwo(arr){
  const idx = [...arr.keys()];
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return [arr[idx[0]], arr[idx[1]]];
}
function pickBaseQuestions(){
  baseQuestions = []; baseIds = [];
  usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
  AXES.forEach(axis=>{
    const bank = KB.questions?.[axis] || [];
    if(bank.length < 2) throw new Error(`${axis} 축 문제은행이 2개 미만입니다.`);
    const [qA,qB] = sampleTwo(bank);
    const q1 = { id:`base_${axis}_1`, axis, ...qA };
    const q2 = { id:`base_${axis}_2`, axis, ...qB };
    baseQuestions.push(q1,q2);
    baseIds.push(q1.id, q2.id);
    usedPromptsByAxis[axis].add(qA.prompt); usedPromptsByAxis[axis].add(qB.prompt);
  });
  // 표시 순서 섞기
  for(let i=baseQuestions.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [baseQuestions[i],baseQuestions[j]]=[baseQuestions[j],baseQuestions[i]]; }
}
function pickTieBreaker(axis){
  const pool = KB.tiebreakers?.[axis] || [];
  // base에서 사용한 prompt와 TB에서 이미 쓴 prompt는 usedPromptsByAxis로 막는다
  const remaining = pool.filter(item => !usedPromptsByAxis[axis].has(item.prompt));
  if(remaining.length===0) return null;
  const item = remaining[Math.floor(Math.random()*remaining.length)];
  usedPromptsByAxis[axis].add(item.prompt);
  return item;
}

// ================= Render =================
function makeQuestionBlock({id, axis, prompt, A, B, hint, isTB=false, indexNum=null}){
  const div=document.createElement('div');
  div.className='q'; div.dataset.axes=axis; div.id=id;
  const title = indexNum ? `${indexNum}) ${prompt}` : prompt;
  div.innerHTML = `
    <h3 style="margin:0 0 8px">${title}</h3>
    <div class="opts" style="display:flex;gap:12px;flex-wrap:wrap">
      <label><input type="radio" name="${id}" value="${A.value}"> <span>${A.label}</span></label>
      <label><input type="radio" name="${id}" value="${B.value}"> <span>${B.label}</span></label>
    </div>
    <div class="req" style="color:#b91c1c;font-size:.9rem;display:none;margin-top:6px">이 문항에 답해주세요.</div>
    ${hint?`<div class="hint" style="font-size:.9rem;color:#6b7280;margin-top:6px">${hint}${isTB?' · (추가 확인 질문)':''}</div>`:(isTB?`<div class="hint" style="font-size:.9rem;color:#6b7280;margin-top:6px">(추가 확인 질문)</div>`:'')}
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

// ================= Logic =================
function collectAnswers(){
  answers = [];
  document.querySelectorAll('input[type="radio"]:checked').forEach(inp=>{ answers.push(inp.value); });
  // 필수 표시
  baseIds.forEach(name=>{
    const picked=document.querySelector(`input[name="${name}"]:checked`);
    const req=$('#'+name)?.querySelector('.req');
    if(req) req.style.display = picked?'none':'block';
  });
}
function countBaseAnswered(){ return baseIds.reduce((n,name)=> n + (document.querySelector(`input[name="${name}"]:checked`)?1:0), 0); }
function isAnswered(name){ return !!document.querySelector(`input[name="${name}"]:checked`); }
function allPendingAnswered(){ return pendingTBIds.every(id => isAnswered(id)); }

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
function hasPendingForAxis(axis){
  return pendingTBIds.some(id => id.startsWith(`tb_${axis}_`) && !isAnswered(id));
}
function tieAxesToAsk(model){
  // 기본 2문항 이상 답했고 동률이며 축당 한도 미만이면 후보
  const out=[];
  if(model.axisTotals.EI>=2 && model.ties.EI && askedTB.EI<MAX_TB) out.push('EI');
  if(model.axisTotals.SN>=2 && model.ties.SN && askedTB.SN<MAX_TB) out.push('SN');
  if(model.axisTotals.TF>=2 && model.ties.TF && askedTB.TF<MAX_TB) out.push('TF');
  if(model.axisTotals.JP>=2 && model.ties.JP && askedTB.JP<MAX_TB) out.push('JP');
  return out;
}

// ================= Result (텍스트 보고서) =================
const AXIS_MEANING_LONG = {
  E:'Extraversion · 외향 — 에너지를 외부 상호작용에서 얻음',
  I:'Introversion · 내향 — 에너지를 고요/몰입에서 얻음',
  S:'Sensing · 감각 — 현재의 구체·사실에 주목',
  N:'iNtuition · 직관 — 패턴/가능성에 주목',
  T:'Thinking · 사고 — 논리·일관성을 우선',
  F:'Feeling · 감정 — 가치·관계의 조화를 우선',
  J:'Judging · 판단 — 계획·마감 중심',
  P:'Perceiving · 인식 — 유연·탐색 중심'
};
const TYPE_DOMAINS={}; // (간단 기본 문구)
function setExplain(type, life, work, rel, study){ TYPE_DOMAINS[type]={life,work,rel,study}; }
setExplain('ISTJ',{tips:'생활: 루틴/예산 점검, 비상 계획 정기 갱신.'},{tips:'일: 역할·마감 합의 기록, 점검 목록으로 품질 안정.'},{tips:'인간관계: 약속·기대 분명히, 사실 기반 조정.'},{tips:'학습: 주간 계획과 복습 고정으로 축적.'});
setExplain('ENFP',{tips:'생활: 동시 과제 수 제한으로 에너지 분산 방지.'},{tips:'일: 아이디어 전개 후 범위 합의로 마무리 밀어붙이기.'},{tips:'인간관계: 경계와 휴식시간 확보.'},{tips:'학습: 흥미 유발, 점검 파트너로 완료율 관리.'});

function ensureReportStyles(){
  if($('#capture-style')) return;
  const css=document.createElement('style'); css.id='capture-style';
  css.textContent = `
    #result pre{background:#fff;border:1px solid #e5e7eb;padding:16px;border-radius:10px;white-space:pre-wrap;line-height:1.55}
    @media print {
      #debug-panel { display:none !important }
      #form { display:none !important }
      body { background:#fff }
    }
  `;
  document.head.appendChild(css);
}
function renderResult(model, unresolvedAxes=[]){
  ensureReportStyles();

  // 결과만 남김
  const form = $('#form'); if(form) form.innerHTML='';

  const {mbti,reliability} = model;
  const tips = TYPE_DOMAINS[mbti] || {
    life:{tips:'생활: 에너지 패턴을 이해하고 휴식 규칙을 마련하세요.'},
    work:{tips:'일: 강점 역할을 명확히 하고 협업 방식을 합의하세요.'},
    rel:{tips:'인간관계: 기대·경계를 공유하고 피드백을 정례화하세요.'},
    study:{tips:'학습: 목표를 단계로 나눠 진행률을 가시화하세요.'}
  };

  const unresolvedBadge = unresolvedAxes.length ? ` (동률 유지: ${unresolvedAxes.join(', ')})` : '';

  $('#result').innerHTML = `
<pre>
[결과]
${mbti}   신뢰도: ${reliability}%${unresolvedBadge}

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
${AXIS_MEANING_LONG.E.padEnd(28)}${AXIS_MEANING_LONG.I}
S                           N
${AXIS_MEANING_LONG.S.padEnd(28)}${AXIS_MEANING_LONG.N}
T                           F
${AXIS_MEANING_LONG.T.padEnd(28)}${AXIS_MEANING_LONG.F}
J                           P
${AXIS_MEANING_LONG.J.padEnd(28)}${AXIS_MEANING_LONG.P}
</pre>`;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// ================= Flow =================
function onAnyChange(e){
  try{
    collectAnswers();
    renderDebug(computeMBTI(answers));

    if(!baseDone){
      if(countBaseAnswered() < 8) return; // 8개 미만 → 대기
      baseDone = true;                    // 8개 찼다 → 최초 평가
      evaluateOrAsk();
      return;
    }
    // 기본 완료 이후에는 추가문항 응답에만 반응
    const changed = e?.target?.name || '';
    if(/^tb_/.test(changed)){
      evaluateOrAsk();
    }
  }catch(err){
    console.error('onAnyChange 실패:', err);
  }
}

function evaluateOrAsk(){
  try{
    const model = computeMBTI(answers);

    // 이미 답한 추가문항 제거
    pendingTBIds = pendingTBIds.filter(id => !isAnswered(id));

    // 동률 축들 후보 산출
    const candidates = tieAxesToAsk(model);

    // 후보마다 대기 미존재 + 한도 미달이면 즉시 1문항씩 추가
    let added = 0;
    for(const axis of candidates){
      if(!hasPendingForAxis(axis) && askedTB[axis] < MAX_TB){
        const item = pickTieBreaker(axis);
        if(item){
          askedTB[axis]++;
          const id = `tb_${axis}_${askedTB[axis]}`;
          const block = makeQuestionBlock({
            id, axis, prompt:`추가 문항 · ${item.prompt}`, A:item.A, B:item.B, hint:item.hint||'', isTB:true
          });
          $('#form').appendChild(block);
          pendingTBIds.push(id);
          added++;
        }else{
          log(`타이브레이커 풀이 없음: ${axis} → 바로 결과로 진행`);
        }
      }
    }

    // 방금이라도 추가했다면 응답 대기
    if(added>0){ renderDebug(computeMBTI(answers)); return; }

    // 아직 대기 추가문항이 있으면 결과 보류
    if(!allPendingAnswered()){ renderDebug(computeMBTI(answers)); return; }

    // 대기 없음 → 재평가
    const latest = computeMBTI(answers);

    // 여전히 동률인데 더 이상 물을 수 없거나(풀 없음/한도 도달) 대기 없음 → 결과
    const unresolved=[];
    if(latest.ties.EI && (askedTB.EI>=MAX_TB || !(KB.tiebreakers?.EI||[]).length)) unresolved.push('EI');
    if(latest.ties.SN && (askedTB.SN>=MAX_TB || !(KB.tiebreakers?.SN||[]).length)) unresolved.push('SN');
    if(latest.ties.TF && (askedTB.TF>=MAX_TB || !(KB.tiebreakers?.TF||[]).length)) unresolved.push('TF');
    if(latest.ties.JP && (askedTB.JP>=MAX_TB || !(KB.tiebreakers?.JP||[]).length)) unresolved.push('JP');

    // 동률이 남아 있어도 더 묻지 못하면 바로 결과
    renderResult(latest, unresolved);
    renderDebug(latest);
  }catch(err){
    console.error('evaluateOrAsk 실패:', err);
    // 오류 시라도 결과가 계산 가능하면 보여준다(멈춤 방지)
    try{ renderResult(computeMBTI(answers)); }catch(e){}
  }
}

function init(){
  try{
    // 새 라운드 초기화
    askedTB={EI:0,SN:0,TF:0,JP:0};
    answers=[]; baseDone=false; pendingTBIds=[];
    $('#result').innerHTML='';

    renderBaseQuestions();
    $('#form').addEventListener('change', onAnyChange, {passive:true});
    renderDebug(computeMBTI(answers));
  }catch(err){
    console.error('init 실패:', err);
  }
}

// ================= Boot =================
if (DEBUG) ensureDebugShell();
document.addEventListener('DOMContentLoaded', ()=>{
  loadData().then(init).catch(err=>{
    console.error('데이터 로드 실패:', err);
    const form=$('#form');
    form.innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/*.json 경로와 GitHub Pages 캐시를 확인하세요.</div></div>';
  });
});
