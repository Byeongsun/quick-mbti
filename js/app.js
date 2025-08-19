// ========== Config ==========
const VER = '2025-08-18-1';
const AXES = ['EI','SN','TF','JP'];
// 상대경로(깃허브 페이지스에서 하위 디렉토리라도 동작). 절대경로(/) 쓰면 404 날 수 있음
const DATA_URL = `./data/questions_bank.json?v=${VER}`;

// 출제 범위: 'general' | 'senior'
let audienceFilter = 'general';

// ========== DOM utils ==========
const $ = s => document.querySelector(s);
function scrollToEl(el){ try{ el?.scrollIntoView({behavior:'smooth', block:'center'});}catch{} }

// ========== State ==========
let KB = { raw:null, bank:null };       // raw=원본, bank=필터 적용된 뷰
let baseQuestions = [];                 // 8개(각 축 2개)
let baseIds = [];
let usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
let answers = [];                       // [{axis, value}]  value ∈ E/I/S/N/T/F/J/P (중립 없음)
let baseDone = false;
let pendingIds = [];                    // 아직 응답 안 된 추가 문항 id들

// ----------- 폴백(내장) 문항: 각 축 4문항(일반2+어르신2) -----------
const FALLBACK_BANK = {
  EI: [
    { audience:'general', prompt:'가족 단톡방에서 즉흥적으로 주말 피크닉 제안이 나왔습니다.',
      A:{label:'바로 좋다고 하고 준비를 나눈다.', value:'E'}, B:{label:'일정을 보고 가능하면 참여하겠다고 답한다.', value:'I'} },
    { audience:'general', prompt:'배우자 친구들과의 저녁 식사에 동행하게 되었습니다.',
      A:{label:'새로운 사람들과 이야기 나누는 걸 즐긴다.', value:'E'}, B:{label:'모르는 사람과의 식사는 피곤할 수 있어 조심스럽다.', value:'I'} },
    { audience:'senior', prompt:'손주가 저녁에 같이 산책하며 이야기하자고 합니다.',
      A:{label:'밖에서 사람들 보며 함께 걷고 대화하는 게 즐겁다.', value:'E'}, B:{label:'오늘은 집에서 쉬며 조용히 시간을 보내고 싶다.', value:'I'} },
    { audience:'senior', prompt:'경로당에 새 회원이 왔는데 어색해 보입니다.',
      A:{label:'먼저 다가가 자리 안내와 인사를 건네 분위기를 풀어준다.', value:'E'}, B:{label:'상황을 지켜보고 시간이 지나면 자연스럽게 말을 건넨다.', value:'I'} }
  ],
  SN: [
    { audience:'general', prompt:'가족 여행을 계획합니다.',
      A:{label:'세부 일정·숙소·교통을 꼼꼼히 확정한다.', value:'S'}, B:{label:'분위기와 경험을 먼저 그린 뒤 현지에서 유연하게 정한다.', value:'N'} },
    { audience:'general', prompt:'아이의 식습관 개선을 시작합니다.',
      A:{label:'하루 섭취량과 메뉴를 구체적으로 기록한다.', value:'S'}, B:{label:'긍정 경험을 쌓는 장기 전략을 먼저 상상한다.', value:'N'} },
    { audience:'senior', prompt:'정기 검진 예약을 잡아야 합니다.',
      A:{label:'병원·이동·준비사항을 구체적으로 확인해 확정한다.', value:'S'}, B:{label:'생활 흐름을 보며 여유 있는 날로 생각해 둔다.', value:'N'} },
    { audience:'senior', prompt:'낙상 예방을 위해 집안을 점검합니다.',
      A:{label:'미끄럼 방지·조명·손잡이 등 구체 항목을 체크한다.', value:'S'}, B:{label:'다양한 상황을 상상해 동선을 바꾸는 큰 그림을 먼저 잡는다.', value:'N'} }
  ],
  TF: [
    { audience:'general', prompt:'배우자가 건강검진 결과에 대해 걱정합니다.',
      A:{label:'수치를 분석해 해석하고 다음 조치를 함께 정한다.', value:'T'}, B:{label:'불안을 공감하고 마음을 안정시키는 말을 건넨다.', value:'F'} },
    { audience:'general', prompt:'가족 모임 비용 분담 문제로 불만이 나왔습니다.',
      A:{label:'공정한 기준을 정해 명확히 합의하도록 이끈다.', value:'T'}, B:{label:'서로 사정을 듣고 모두가 덜 상하는 합의점을 찾는다.', value:'F'} },
    { audience:'senior', prompt:'이웃과 소음 문제로 다툼이 있었습니다.',
      A:{label:'사실관계를 정리해 해결 절차를 제안한다.', value:'T'}, B:{label:'감정을 달래며 관계가 상하지 않게 조율한다.', value:'F'} },
    { audience:'senior', prompt:'손주가 학업 문제로 속상해합니다.',
      A:{label:'원인을 분석하고 실천 계획을 세운다.', value:'T'}, B:{label:'마음을 충분히 들어주고 응원한다.', value:'F'} }
  ],
  JP: [
    { audience:'general', prompt:'아이 예방접종 일정을 관리해야 합니다.',
      A:{label:'달력에 미리 표시하고 알람을 설정한다.', value:'J'}, B:{label:'가까워지면 확인해 진행한다.', value:'P'} },
    { audience:'general', prompt:'가족 여행 날 아침 예상치 못한 비가 옵니다.',
      A:{label:'대체 일정을 적용해 모두에게 공유한다.', value:'J'}, B:{label:'현장 분위기에 맞춰 즉흥적으로 바꾼다.', value:'P'} },
    { audience:'senior', prompt:'정기 검진과 약 복용 일정을 관리합니다.',
      A:{label:'달력과 알람으로 미리 준비한다.', value:'J'}, B:{label:'필요해지면 그때 확인해 진행한다.', value:'P'} },
    { audience:'senior', prompt:'집안 정리·청소를 합니다.',
      A:{label:'구역을 나누고 순서대로 끝낸다.', value:'J'}, B:{label:'눈에 띄는 곳부터 유연하게 처리한다.', value:'P'} }
  ]
};

// ========== Load & Filter ==========
async function loadData(){
  try{
    const qRes = await fetch(DATA_URL, {cache:'no-store'});
    if(!qRes.ok) throw new Error('HTTP '+qRes.status);
    const raw = await qRes.json();
    KB.raw = raw;
  }catch(e){
    console.warn('[경고] questions_bank.json 로드 실패. 폴백 데이터 사용:', e);
    // 폴백 사용
    KB.raw = FALLBACK_BANK;
    // 화면 안내
    const msg = document.createElement('div');
    msg.className = 'q';
    msg.innerHTML = `<h3>문항 파일을 불러오지 못했습니다.</h3>
      <div class="hint">data/questions_bank.json 경로/대소문자/위치를 확인해주세요. (임시 폴백 데이터로 진행합니다)</div>`;
    $('#form').before(msg);
  }
  KB.bank = filterByAudience(KB.raw, audienceFilter);
}

function filterByAudience(raw, filter){
  const out = {EI:[], SN:[], TF:[], JP:[]};
  const ok = (aud) => {
    if(!aud) return true;            // 태그 없으면 포함
    if(aud==='both') return true;
    return aud===filter;
  };
  for(const axis of AXES){
    for(const q of (raw[axis]||[])){
      if(ok(q.audience)) out[axis].push(q);
    }
  }
  return out;
}

// ========== Question pickers ==========
function shuffleIdx(n){
  const idx=[...Array(n).keys()];
  for(let i=n-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return idx;
}
function sampleTwo(arr){
  if(arr.length===1) return [arr[0], arr[0]]; // 방어
  const idx=shuffleIdx(arr.length);
  return [arr[idx[0]], arr[idx[1]]];
}
function pickBaseQuestions(){
  baseQuestions = []; baseIds = [];
  usedPromptsByAxis = {EI:new Set(),SN:new Set(),TF:new Set(),JP:new Set()};
  AXES.forEach(axis=>{
    const bank=KB.bank?.[axis]||[];
    if(bank.length<2) {
      if(bank.length===0) throw new Error(`${axis} 축 문제은행이 비어 있습니다.`);
      // 최소 방어: 1개만 있으면 중복 출제
      const [qA,qB]=sampleTwo(bank);
      const q1={id:`base_${axis}_1`,axis,...qA};
      const q2={id:`base_${axis}_2`,axis,...qB};
      baseQuestions.push(q1,q2);
      baseIds.push(q1.id,q2.id);
      usedPromptsByAxis[axis].add(qA.prompt); usedPromptsByAxis[axis].add(qB.prompt);
      return;
    }
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
    const value = inp.value;
    if(axis && value) answers.push({axis, value});
  });
  // 필수 표기 (기본 8문항)
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

// 규칙: 2문항 diff==0 → +2, 4문항 diff==0 → +2, 6문항 diff==0 → 판정 불가
function needMoreAfter2(axis, model){ return model.axisTotals[axis]===2 && model.diff[axis] === 0; }
function needMoreAfter4(axis, model){ return model.axisTotals[axis]===4 && model.diff[axis] === 0; }
function unresolvedAfter6(axis, model){ return model.axisTotals[axis]===6 && model.diff[axis] === 0; }
function hasPendingForAxis(axis){ return pendingIds.some(id=> id.startsWith(`ex_${axis}_`) && !isAnswered(id)); }

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

// 평가
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

  // (4) 최종 판정
  const final = computeMBTI(answers);
  const unresolved = AXES.filter(axis => unresolvedAfter6(axis, final));
  renderResult(final, unresolved);
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
function renderResult(model, unresolvedAxes=[]){
  ensureReportStyles();
  const form=$('#form'); if(form) form.innerHTML='';

  const displayType = formatTypeWithUnresolved(model, unresolvedAxes);
  const unresolvedNote = unresolvedAxes.length ? `\n[참고] 일부 축은 판정 불가(혼재): ${unresolvedAxes.join(', ')}` : '';

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
</pre>`;
  $('#result').style.display='block';
  scrollToEl($('#result'));
}

// 부트스트랩
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

function startApp(filter){
  audienceFilter = filter; // 'general' | 'senior'
  $('#mode-select').style.display = 'none';
  $('#form').style.display = 'block';
  loadData().then(()=>{
    answers=[]; baseDone=false; pendingIds=[];
    $('#result').innerHTML='';
    renderBaseQuestions();
    $('#form').addEventListener('change', onAnyChange, {passive:true});
  }).catch(err=>{
    console.error('데이터 로드 실패(폴백도 실패):', err);
    $('#form').innerHTML='<div class="q"><h3>데이터를 불러오지 못했습니다.</h3><div class="hint">data/questions_bank.json 경로와 캐시를 확인하세요.</div></div>';
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('#btn-general')?.addEventListener('click', ()=> startApp('general'));
  $('#btn-senior')?.addEventListener('click',  ()=> startApp('senior'));
});
