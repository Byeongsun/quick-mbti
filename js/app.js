// ========== Config ==========
const VER = '2025-08-18';
const AXES = ['EI','SN','TF','JP'];

// 모드별 데이터 URL (추가문항은 같은 은행에서 더 뽑음)
const DATA_URLS = {
  normal: { questions: `data/questions.json?v=${VER}` },
  senior: { questions: `data/questions_senior.json?v=${VER}` }
};

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }

// ========== State ==========
let mode = null; // 'normal' | 'senior'
let KB = { questions:null };               // {EI:[],SN:[],TF:[],JP:[]}
let baseQuestions = [];                    // 8개(각 축 2개)
let baseIds = [];
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];                          // [{axis, value}]  value ∈ E/I/S/N/T/F/J/P (MID 없음)
let baseDone = false;
let pendingIds = [];                       // 아직 응답 안 된 추가 문항 id들

// ========== Load ==========
async function loadData(){
  const urls = DATA_URLS[mode];
  const qRes = await fetch(urls.questions, {cache:'no-store'});
  if(!qRes.ok) throw new Error('questions 로드 실패: '+qRes.status);
  KB.questions = await qRes.json();
}

// ========== Question pickers ==========
function shuffleIdx(n){
  const idx=[...Array(n).keys()];
  for(let i=n-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return idx;
}
function sampleTwo(arr){
  const idx=shuffleIdx(arr.length);
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
function pickExtraFromBank(axis){
  // 아직 쓰지 않은 문항에서 1개 추출
  const pool=KB.questions?.[axis]||[];
  const remain=pool.filter(it=>!usedPromptsByAxis[axis].has(it.prompt));
  if(remain.length===0) return null;
  const item=remain[Math.floor(Math.random()*remain.length)];
  usedPromptsByAxis[axis].add(item.prompt);
  return item;
}

// ========== Render ==========
function makeQuestionBlock({id,axis,prompt,A,B,hint,isExtra=false,indexNum=null}){
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
    ${hint?`<div class="hint">${hint}${isExtra?' · (추가 질문)':''}</div>`:(isExtra?`<div class="hint">(추가 질문)</div>`:'')}
  `;
  div.querySelectorAll('input[type="radio"]').forEach(r=>r.addEventListener('change', onAnyChange, {passive:true}));
  return div;
}
function renderBaseQuestions(){
  const form=$('#form'); form.innerHTML='';
  pickBaseQuestions();
  baseQuestions.forEach((q,i)=>{
    form.appendChild(makeQuestionBlock({id:q.id,axis:q.axis,prompt:q.prompt,A:q.A,B:q.B,hint:q.hint,isExtra:false,indexNum:i+1}));
  });
}

// ========== Logic ==========
function collectAnswers(){
  answers = [];
  document.querySelectorAll('input[type="radio"]:checked').forEach(inp=>{
    const axis = inp.closest('.q')?.dataset?.axes;
    const value = inp.value; // E/I/S/N/T/F/J/P
    if(axis && value) answers.push({axis, value});
  });
  // 필수 표기 (기본 8문항에만)
  baseIds.forEach(name=>{
    const picked=document.querySelector(`input[name="${name}"]:checked`);
    const req=$('#'+name)?.querySelector('.req');
    if(req) req.style.display = picked?'none':'block';
  });
}
function countBaseAnswered(){ return baseIds.reduce((n,name)=> n + (document.querySelector(`input[name="${name}"]:checked`)?1:0), 0); }
function isAnswered(name){ return !!document.querySelector(`input[name="${name}"]:checked`); }
function allPendingAnswered(){ return pendingIds.every(id=>isAnswered(id)); }

function computeMBTI(ans){
  const count={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0}, axisTotals={EI:0,SN:0,TF:0,JP:0};
  const poles = { EI:['E','I'], SN:['S','N'], TF:['T','F'], JP:['J','P'] };

  for (const {axis,value} of ans){
    if(!axis || !poles[axis]) continue;
    const [A,B] = poles[axis];
    if(value in count){ count[value]+=1; }
    axisTotals[axis]++;
  }

  const diff = {
    EI: Math.abs(count.E-count.I),
    SN: Math.abs(count.S-count.N),
    TF: Math.abs(count.T-count.F),
    JP: Math.abs(count.J-count.P)
  };

  const pick=(a,b,def)=> count[a]>count[b]?a:count[a]<count[b]?b:def;
  const ei=pick('E','I','E'), sn=pick('S','N','S'), tf=pick('T','F','T'), jp=pick('J','P','J');
  const mbti = ei+sn+tf+jp;

  return {mbti,count,axisTotals,diff};
}

// 규칙 (MID 없음: 2문항→diff 2 또는 0 / 4문항→4,2,0 / 6문항→6,4,2,0)
function needMoreAfter2(axis, model){
  // 2문항에서 diff==2만 확정, diff==0이면 추가 2문항
  return model.axisTotals[axis]===2 && model.diff[axis] === 0;
}
function needMoreAfter4(axis, model){
  // 4문항에서 diff==0(=2:2)만 추가 2문항, diff>=2면 확정
  return model.axisTotals[axis]===4 && model.diff[axis] === 0;
}
function unresolvedAfter6(axis, model){
  // 6문항까지 했는데도 diff==0 -> 판정 불가(혼재)
  return model.axisTotals[axis]===6 && model.diff[axis] === 0;
}

function hasPendingForAxis(axis){
  return pendingIds.some(id=> id.startsWith(`ex_${axis}_`) && !isAnswered(id));
}

function appendExtraFromBank(axis, count=2){
  let added = 0;
  while (added < count){
    const item = pickExtraFromBank(axis);
    if(!item) break;
    const id=`ex_${axis}_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const block = makeQuestionBlock({
      id, axis,
      prompt:`추가 문항 · ${item.prompt}`,
      A:item.A, B:item.B, hint:item.hint||'',
      isExtra:true
    });
    $('#form').appendChild(block);
    pendingIds.push(id);
    added++;
  }
  if(added>0){ scrollToEl($('#form').lastElementChild); return true; }
  return false;
}

// 메인 평가
function evaluateOrAsk(){
  const model = computeMBTI(answers);

  // 이미 답변한 추가문항 id 정리
  pendingIds = pendingIds.filter(id=>!isAnswered(id));

  // (1) 2문항 단계: diff==0 -> 추가 2문항
  let added = 0;
  for (const axis of AXES){
    if(!baseDone) continue;
    if (needMoreAfter2(axis, model) && !hasPendingForAxis(axis)){
      if (appendExtraFromBank(axis, 2)) added++;
    }
  }
  if (added>0) return;

  // (2) 4문항 단계: diff==0 -> 추가 2문항
  added = 0;
  for (const axis of AXES){
    if (needMoreAfter4(axis, model) && !hasPendingForAxis(axis)){
      if (appendExtraFromBank(axis, 2)) added++;
    }
  }
  if (added>0) return;

  // (3) 아직 대기 중 질문 있으면 결과 보류
  if (!allPendingAnswered()) return;

  // (4) 최종 판정: 6문항에서도 diff==0 이면 판정 불가
  const final = computeMBTI(answers);
  const unresolved = AXES.filter(axis => unresolvedAfter6(axis, final));

  renderResult(final, unresolved);
}

// ========== 결과 화면 ==========
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
    #result strong.type{font-size:1.8rem;font-weight:800}
    @media print{ #form{display:none!important} body{background:#fff} }
  `;
  document.head.appendChild(css);
}
function renderResult(model, unresolvedAxes=[]){
  ensureReportStyles();
  const form=$('#form'); if(form) form.innerHTML='';

  const {mbti}=model;
  const unresolvedNote = unresolvedAxes.length ? `\n[참고] 일부 축은 판정 불가(혼재): ${unresolvedAxes.join(', ')}` : '';

  $('#result').innerHTML = `
<pre>
[결과]
<strong class="type">${mbti}</strong>${unresolvedNote}

[팁]
${COMMON_TIPS.life}
${COMMON_TIPS.work}
${COMMON_TIPS.rel}
${COMMON_TIPS.study}

[MBTI 의미]
E (Extraversion, 외향): 사람들과의 교류·활동에서 에너지를 얻고, 외부 자극에 적극적으로 반응함
I (Introversion, 내향): 고요한 시간과 혼자만의 몰입에서 에너지를 회복하고, 신중한 내적 성찰을 선호함

S (Sensing, 감각): 현재의 구체적 사실·경험을 중시하고, 실용적이고 현실적인 정보에 신뢰를 둠
N (Intuition, 직관): 패턴·가능성과 같은 추상적 연결을 중시하고, 미래지향적 아이디어를 선호함

T (Thinking, 사고): 논리·일관성·원칙에 따라 판단하고, 공정한 기준을 우선함
F (Feeling, 감정): 사람·가치·관계의 조화를 중시하고, 공감과 배려를 판단에 반영함

J (Judging, 판단): 계획적·체계적으로 일을 정리하고, 마감과 규칙을 선호함
P (Perceiving, 인식): 상황에 맞춰 유연하게 적응하며, 열린 선택지를 유지하는 것을 선호함
</pre>`;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// ========== Boot ==========
function onAnyChange(){
  collectAnswers();

  if(!baseDone){
    if(countBaseAnswered() < 8) return; // 기본 8문항 모두 응답되어야 시작
    baseDone = true;
    evaluateOrAsk();
    return;
  }
  evaluateOrAsk(); // 추가 문항 응답 때마다 평가
}

function startApp(selectedMode){
  mode = selectedMode;
  $('#mode-select').style.display = 'none';
  $('#form').style.display = 'block';
  loadData().then(()=>{
    answers=[]; baseDone=false; pendingIds=[];
    $('#result').innerHTML='';
    renderBaseQuestions();
    $('#form').addEventListener('change', onAnyChange, {passive:true});
  }).catch(err=>{
    console.error('데이터 로드 실패:', err);
    $('#form').innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/*.json 경로와 캐시를 확인하세요.</div></div>';
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('#btn-normal')?.addEventListener('click', ()=> startApp('normal'));
  $('#btn-senior')?.addEventListener('click', ()=> startApp('senior'));
});
