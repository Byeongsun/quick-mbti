// ========== Config ==========
const VER = '2025-08-20-logs';
const AXES = ['EI','SN','TF','JP'];
const DATA_URL = `./questions_bank.json?ts=${Date.now()}`;

// 출제 범위: 'general' | 'senior'
let audienceFilter = 'general';

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }

// ========== State ==========
let KB = { raw:null, bank:null };
let baseQuestions = []; // 8개(각 축 2개)
let baseIds = [];
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];       // {id, axis, value, label, prompt, isExtra}
let baseDone = false;
let pendingIds = [];
let questionMeta = {};  // id -> {axis,prompt,A,B,isExtra}

// ========== 폴백(간단 샘플) ==========
const FALLBACK_BANK = {
  EI: [
    { audience:'general', prompt:'가족 단톡방에서 즉흥적으로 주말 피크닉 제안이 나왔습니다.',
      A:{label:'바로 좋다고 하고 준비를 나눈다.', value:'E'}, B:{label:'일정을 보고 가능하면 참여하겠다고 답한다.', value:'I'} },
    { audience:'senior',  prompt:'손주가 저녁에 같이 산책하며 이야기하자고 합니다.',
      A:{label:'밖에서 사람들 보며 함께 걷고 대화하는 게 즐겁다.', value:'E'}, B:{label:'오늘은 집에서 쉬며 조용히 시간을 보내고 싶다.', value:'I'} }
  ],
  SN: [
    { audience:'general', prompt:'가족 여행을 계획합니다.',
      A:{label:'세부 일정·숙소·교통을 꼼꼼히 확정한다.', value:'S'}, B:{label:'분위기와 경험을 먼저 그린 뒤 현지에서 유연하게 정한다.', value:'N'} },
    { audience:'senior',  prompt:'정기 검진 예약을 잡아야 합니다.',
      A:{label:'병원·이동·준비사항을 구체적으로 확인해 확정한다.', value:'S'}, B:{label:'생활 흐름을 보며 여유 있는 날로 생각해 둔다.', value:'N'} }
  ],
  TF: [
    { audience:'general', prompt:'배우자가 건강검진 결과에 대해 걱정합니다.',
      A:{label:'수치를 분석해 해석하고 다음 조치를 함께 정한다.', value:'T'}, B:{label:'불안을 공감하고 마음을 안정시키는 말을 건넨다.', value:'F'} },
    { audience:'senior',  prompt:'이웃과 소음 문제로 다툼이 있었습니다.',
      A:{label:'사실관계를 정리해 해결 절차를 제안한다.', value:'T'}, B:{label:'감정을 달래며 관계가 상하지 않게 조율한다.', value:'F'} }
  ],
  JP: [
    { audience:'general', prompt:'가족 여행 날 아침 예상치 못한 비가 옵니다.',
      A:{label:'대체 일정을 적용해 모두에게 공유한다.', value:'J'}, B:{label:'현장 분위기에 맞춰 즉흥적으로 바꾼다.', value:'P'} },
    { audience:'senior',  prompt:'정기 검진과 약 복용 일정을 관리합니다.',
      A:{label:'달력과 알람으로 미리 준비한다.', value:'J'}, B:{label:'필요해지면 그때 확인해 진행한다.', value:'P'} }
  ]
};

// ========== Load & Filter ==========
async function loadData(){
  try{
    const res = await fetch(DATA_URL, { cache:'no-store', mode:'same-origin' });
    if(!res.ok) throw new Error('HTTP '+res.status);
    KB.raw = await res.json();
  }catch(e){
    console.warn('[경고] questions_bank.json 로드 실패. 폴백 사용:', e);
    KB.raw = FALLBACK_BANK;
    const msg = document.createElement('div');
    msg.className = 'q';
    msg.innerHTML = `<h3>문항 파일을 불러오지 못했습니다.</h3>
      <div class="hint">같은 폴더의 <code>questions_bank.json</code>을 확인하세요. (임시 폴백 데이터로 진행합니다)</div>`;
    $('#form').before(msg);
  }
  KB.bank = filterByAudience(KB.raw, audienceFilter);
}
function filterByAudience(raw, filter){
  const out = {EI:[], SN:[], TF:[], JP:[]};
  const ok = (aud) => !aud || aud==='both' || aud===filter;
  for(const axis of AXES){ for(const q of (raw[axis]||[])){ if(ok(q.audience)) out[axis].push(q); } }
  return out;
}

// ========== Question pickers ==========
function shuffleIdx(n){ const a=[...Array(n).keys()]; for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function sampleTwo(arr){ const idx=shuffleIdx(arr.length); return [arr[idx[0]], arr[idx[1]]]; }
function pickBaseQuestions(){
  baseQuestions=[]; baseIds=[]; usedPromptsByAxis={EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()}; questionMeta={};
  AXES.forEach(axis=>{
    const bank=KB.bank?.[axis]||[];
    if(bank.length<2) throw new Error(`${axis} 축 문제은행이 2개 미만입니다.`);
    const [qA,qB]=sampleTwo(bank);
    const q1={id:`base_${axis}_1`,axis,...qA};
    const q2={id:`base_${axis}_2`,axis,...qB};
    baseQuestions.push(q1,q2); baseIds.push(q1.id,q2.id);
    usedPromptsByAxis[axis].add(qA.prompt); usedPromptsByAxis[axis].add(qB.prompt);
  });
  for(let i=baseQuestions.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [baseQuestions[i],baseQuestions[j]]=[baseQuestions[j],baseQuestions[i]]; }
}
function pickExtraFromBank(axis){
  const pool=KB.bank?.[axis]||[];
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
  // 결과 로그용 메타 저장
  questionMeta[id] = { axis, prompt, A, B, isExtra };
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
    const id = inp.name;
    const meta = questionMeta[id] || {};
    const axis = meta.axis || inp.closest('.q')?.dataset?.axes;
    const value = inp.value;
    let label = '';
    if(meta.A && meta.A.value===value) label = meta.A.label;
    else if(meta.B && meta.B.value===value) label = meta.B.label;
    const prompt = meta.prompt || '';
    const isExtra = !!meta.isExtra;
    if(axis && value){ answers.push({id, axis, value, label, prompt, isExtra}); }
  });
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
  for (const a of ans){ const {axis,value}=a; if(!axis||!poles[axis]) continue; if(value in count) count[value]+=1; axisTotals[axis]++; }
  const diff = { EI:Math.abs(count.E-count.I), SN:Math.abs(count.S-count.N), TF:Math.abs(count.T-count.F), JP:Math.abs(count.J-count.P) };
  const pick=(a,b,def)=> count[a]>count[b]?a:count[a]<count[b]?b:def;
  const mbti = pick('E','I','E') + pick('S','N','S') + pick('T','F','T') + pick('J','P','J');
  return {mbti,count,axisTotals,diff};
}
function needMoreAfter2(axis, m){ return m.axisTotals[axis]===2 && m.diff[axis]===0; }
function needMoreAfter4(axis, m){ return m.axisTotals[axis]===4 && m.diff[axis]===0; }
function unresolvedAfter6(axis, m){ return m.axisTotals[axis]===6 && m.diff[axis]===0; }
function hasPendingForAxis(axis){ return pendingIds.some(id=> id.startsWith(`ex_${axis}_`) && !isAnswered(id)); }

function appendExtraFromBank(axis, count=2){
  let added=0;
  while(added<count){
    const item=pickExtraFromBank(axis); if(!item) break;
    const id=`ex_${axis}_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const block=makeQuestionBlock({ id, axis, prompt:`추가 문항 · ${item.prompt}`, A:item.A, B:item.B, hint:item.hint||'', isExtra:true });
    $('#form').appendChild(block);
    pendingIds.push(id); added++;
  }
  if(added>0){ scrollToEl($('#form').lastElementChild); return true; }
  return false;
}

// 동률 축 이중 표기
function formatTypeWithUnresolved(model, unresolvedAxes=[]) {
  const lead = {
    EI: (model.count.E >= model.count.I) ? 'E' : 'I',
    SN: (model.count.S >= model.count.N) ? 'S' : 'N',
    TF: (model.count.T >= model.count.F) ? 'T' : 'F',
    JP: (model.count.J >= model.count.P) ? 'J' : 'P',
  };
  const poles = { EI:['E','I'], SN:['S','N'], TF:['T','F'], JP:['J','P'] };
  return ['EI','SN','TF','JP'].map(axis=>{
    const [a,b] = poles[axis];
    if (unresolvedAxes.includes(axis)) return `(${a}/${b})`;
    return lead[axis];
  }).join('');
}

// === NEW: 응답 로그 생성 ===
function buildAnswerLog(list){
  const src = (list && list.length) ? list : answers;     // 스냅샷이 비면 전역 answers 사용
  if(!src || src.length===0) return '(응답 없음)';
  return src.map((a,i)=>{
    const kind = a.isExtra ? '(추가) ' : '';
    const prompt = (a.prompt||'').replace(/^추가 문항 ·\s*/,'');
    const label  = a.label || (questionMeta[a.id]?.[ a.value==='E'||a.value==='S'||a.value==='T'||a.value==='J' ? 'A':'B' ]?.label) || '';
    return `${i+1}) [${a.axis}] ${kind}${prompt}\n    → 선택: ${label} (${a.value})`;
  }).join('\n');
}

// 평가
function evaluateOrAsk(){
  const model = computeMBTI(answers);
  pendingIds = pendingIds.filter(id=>!isAnswered(id));

  let added=0;
  for(const axis of AXES){ if(!baseDone) continue; if(needMoreAfter2(axis,model) && !hasPendingForAxis(axis)){ if(appendExtraFromBank(axis,2)) added++; } }
  if(added>0) return;

  added=0;
  for(const axis of AXES){ if(needMoreAfter4(axis,model) && !hasPendingForAxis(axis)){ if(appendExtraFromBank(axis,2)) added++; } }
  if(added>0) return;

  if(!allPendingAnswered()) return;

  const final = computeMBTI(answers);
  const unresolved = AXES.filter(axis => unresolvedAfter6(axis, final));
  renderResult(final, unresolved);     // (스냅샷 인자 제거 → 전역 answers 사용)
}

// 결과 화면
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

function renderResult(model, unresolvedAxes = []) {
  ensureReportStyles();

  // ✅ 1) 먼저 최신 응답을 수집
  collectAnswers();

  // ⬇️ 이 이후에 폼을 비웁니다.
  const form = $('#form');
  if (form) form.innerHTML = '';

  const displayType = formatTypeWithUnresolved(model, unresolvedAxes);
  const unresolvedNote = unresolvedAxes.length
    ? `\n[참고] 일부 축은 판정 불가(혼재): ${unresolvedAxes.join(', ')}`
    : '';

  // 전역 answers를 사용해 로그 생성
  const logText = buildAnswerLog(answers);

  $('#result').innerHTML = `
<pre>
[결과]
<strong class="type">${displayType}</strong>${unresolvedNote}

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

[응답 로그]
${logText}
</pre>`;
  $('#result').style.display = 'block';
  scrollToEl($('#result'));
}


// 부트스트랩
function onAnyChange(){
  collectAnswers();
  if(!baseDone){
    if(countBaseAnswered() < 8) return;
    baseDone = true;
    evaluateOrAsk();
    return;
  }
  evaluateOrAsk();
}
function startApp(filter){
  audienceFilter = filter;
  $('#mode-select').style.display = 'none';
  $('#form').style.display = 'block';
  loadData().then(()=>{
    answers=[]; baseDone=false; pendingIds=[]; questionMeta={};
    $('#result').innerHTML='';
    renderBaseQuestions();
    $('#form').addEventListener('change', onAnyChange, {passive:true});
  }).catch(err=>{
    console.error('데이터 로드 실패:', err);
    $('#form').innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">questions_bank.json 위치/이름을 확인하세요.</div></div>';
  });
}
document.addEventListener('DOMContentLoaded', ()=>{
  $('#btn-general')?.addEventListener('click', ()=> startApp('general'));
  $('#btn-senior') ?.addEventListener('click', ()=> startApp('senior'));
});
