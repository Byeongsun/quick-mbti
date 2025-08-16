// ========== Config ==========
const VER = '20250816';
const DATA_URLS = {
  questions: `data/questions.json?v=${VER}`,
  tiebreakers: `data/tiebreakers.json?v=${VER}`
};
const AXES = ['EI','SN','TF','JP'];
const MAX_TB = 2;   // 축별 추가문항 최대(0~2)

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }

// ========== State ==========
let KB = { questions:null, tiebreakers:null };
let baseQuestions = [];
let baseIds = [];
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];
let askedTB = {EI:0,SN:0,TF:0,JP:0};
let baseDone = false;
let pendingTBIds = [];

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
  const ties={ EI:count.E===count.I, SN:count.S===count.N, TF:count.T===count.F, JP:count.J===count.P };
  return {mbti,count,axisTotals:axisTotals,ties};
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
// 공통 팁(모든 유형 동일)
const COMMON_TIPS = {
  life:  "생활: 에너지 패턴을 이해하고 휴식 규칙을 마련하세요.",
  work:  "일: 강점 역할을 명확히 하고 협업 방식을 합의하세요.",
  rel:   "인간관계: 기대·경계를 공유하고 피드백을 정례화하세요.",
  study: "학습: 목표를 단계로 나눠 진행률을 가시화하세요."
};

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

  const {mbti}=model;
  const unresolved = unresolvedAxes.length ? ` (동률 유지: ${unresolvedAxes.join(', ')})` : '';

  $('#result').innerHTML = `
<pre>
[결과]
<span style="font-size:1.6rem; font-weight:bold;">${mbti}</span>${unresolved}

[팁]
${COMMON_TIPS.life}
${COMMON_TIPS.work}
${COMMON_TIPS.rel}
${COMMON_TIPS.study}

[MBTI 의미]
E (Extraversion, 외향): 사람들과의 교류에서 에너지를 얻고, 활동적이며 즉각적인 행동을 선호함
I (Introversion, 내향): 혼자 있는 시간을 통해 회복하고, 깊이 있는 사고와 내적 성찰을 선호함

S (Sensing, 감각): 현재의 구체적 사실과 경험을 중시하며, 실제적이고 현실적인 정보를 신뢰함
N (Intuition, 직관): 보이지 않는 가능성과 패턴을 중시하며, 미래지향적이고 상상력 있는 사고를 선호함

T (Thinking, 사고): 논리와 객관적 분석을 통해 결정을 내리며, 공정성과 일관성을 중시함
F (Feeling, 감정): 사람과 관계의 조화를 중시하며, 공감과 가치에 기반해 결정을 내림

J (Judging, 판단): 계획적이고 체계적으로 삶을 조직하며, 마감과 규칙을 선호함
P (Perceiving, 인식): 유연하고 상황에 맞게 적응하며, 자율성과 개방성을 중시함
</pre>`;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// ========== Flow ==========
function onAnyChange(e){
  collectAnswers();

  if(!baseDone){
    if(countBaseAnswered() < 8) return; // 8개 모두 응답 전이면 대기
    baseDone = true;
    evaluateOrAsk();
    return;
  }
  const changed = e?.target?.name || '';
  if(/^tb_/.test(changed)){ // 추가문항 응답 시 평가
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
  if(added>0) return;            // 방금 추가했으면 응답 대기

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
