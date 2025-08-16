// 디버그 모드 기본값: false
let DEBUG = false;

// 질문 은행
const questionBank = {
  EI: [
    {q:"친구가 갑작스레 주말 약속을 제안한다. 당신은?", a1:"거의 바로 수락하는 편이다", a2:"한 번 생각해보고 결정하는 편이다"},
    {q:"모임에 초대받았을 때, 당신은?", a1:"사람들과 만나는 게 기대되어 바로 OK한다", a2:"컨디션과 일정을 먼저 고려한다"},
    {q:"새로운 동호회 첫 모임, 당신은?", a1:"처음 본 사람들과도 먼저 말을 건다", a2:"분위기를 살피며 조용히 시작한다"}
  ],
  SN: [
    {q:"새 프로젝트를 맡았다. 당신은?", a1:"실행 가능한 세부 계획부터 짠다", a2:"큰 그림과 아이디어를 먼저 떠올린다"},
    {q:"요리를 배울 때 당신은?", a1:"레시피의 순서를 충실히 따른다", a2:"재료와 감각을 살려 변형해본다"},
    {q:"책을 읽을 때 당신은?", a1:"사실·정보 위주에 주목한다", a2:"상징·의미 해석을 즐긴다"}
  ],
  TF: [
    {q:"교통사고 현장을 목격했다. 당신은?", a1:"누가 잘못했는지부터 판단한다", a2:"사람이 다치진 않았을지 먼저 걱정한다"},
    {q:"친구가 시험에 떨어졌다며 이야기한다. 당신은?", a1:"실패 원인을 분석해 조언한다", a2:"기분을 위로하고 공감한다"},
    {q:"회의에서 동료의 아이디어가 약하다. 당신은?", a1:"객관적 근거로 부족한 점을 지적한다", a2:"의도를 이해하고 장점을 먼저 언급한다"}
  ],
  JP: [
    {q:"여행을 준비할 때 당신은?", a1:"세부 일정을 미리 정리해둔다", a2:"큰 계획만 잡고 상황에 따라 움직인다"},
    {q:"과제를 할 때 당신은?", a1:"마감 전에 여유 있게 끝내둔다", a2:"마감 직전에 몰아서 한다"},
    {q:"주말을 보낼 때 당신은?", a1:"미리 계획한 일정대로 보낸다", a2:"그때그때 즉흥적으로 정한다"}
  ]
};

// MBTI 의미
const AXIS_MEANING = {
  EI: "E (외향) vs I (내향)",
  SN: "S (현실 감각) vs N (직관)",
  TF: "T (사고) vs F (감정)",
  JP: "J (계획) vs P (자율)"
};

// MBTI 결과별 팁
const TYPE_DOMAINS = {
  ISTJ:{life:"생활: 질서와 규칙을 지키며 안정된 생활을 선호합니다.",
        work:"일: 책임감이 강하고 철저하게 준비합니다.",
        rel:"인간관계: 신뢰를 중시하고 진중한 관계를 맺습니다.",
        study:"학습: 계획적으로 꾸준히 학습합니다."},
  ENFP:{life:"생활: 자유롭고 새로운 경험을 추구합니다.",
        work:"일: 창의적인 아이디어를 잘 내고 활기차게 일합니다.",
        rel:"인간관계: 다양한 사람과 쉽게 친해집니다.",
        study:"학습: 관심 있는 분야는 열정적으로 몰입합니다."}
  // 필요시 더 추가
};

// 상태
let answers = [];
let usedQuestions = [];

// DOM 헬퍼
const $ = s=>document.querySelector(s);

function pickRandomQuestions(bank, count){
  const shuffled=[...bank].sort(()=>Math.random()-0.5);
  return shuffled.slice(0,count);
}

function generateInitialQuestions(){
  const axes=["EI","SN","TF","JP"];
  let questions=[];
  axes.forEach(axis=>{
    const selected=pickRandomQuestions(questionBank[axis],2);
    selected.forEach(q=>questions.push({...q,axis}));
  });
  return questions.sort(()=>Math.random()-0.5);
}

function renderQuestions(){
  const form=$("#form");
  form.innerHTML="";
  const qs=generateInitialQuestions();
  qs.forEach((q,idx)=>{
    const div=document.createElement("div");
    div.className="q";
    div.innerHTML=`<p>${idx+1}. ${q.q}</p>
      <button data-axis="${q.axis}" data-choice="A">${q.a1}</button>
      <button data-axis="${q.axis}" data-choice="B">${q.a2}</button>`;
    form.appendChild(div);
  });
  form.querySelectorAll("button").forEach(b=>b.addEventListener("click",onAnswer));
}

function onAnswer(e){
  const axis=e.target.dataset.axis;
  const choice=e.target.dataset.choice;
  answers.push({axis,choice});
  e.target.parentElement.style.display="none";
  checkIfDone();
}

function checkIfDone(){
  const remain=document.querySelectorAll("#form .q:not([style*='display: none'])").length;
  if(remain===0){
    showResult();
  }
}

function showResult(){
  let scores={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0};
  let axisTotals={EI:0,SN:0,TF:0,JP:0};
  answers.forEach(a=>{
    if(a.axis==="EI"){axisTotals.EI++; if(a.choice==="A")scores.E++; else scores.I++;}
    if(a.axis==="SN"){axisTotals.SN++; if(a.choice==="A")scores.S++; else scores.N++;}
    if(a.axis==="TF"){axisTotals.TF++; if(a.choice==="A")scores.T++; else scores.F++;}
    if(a.axis==="JP"){axisTotals.JP++; if(a.choice==="A")scores.J++; else scores.P++;}
  });
  let mbti="";
  mbti+=(scores.E>=scores.I)?"E":"I";
  mbti+=(scores.S>=scores.N)?"S":"N";
  mbti+=(scores.T>=scores.F)?"T":"F";
  mbti+=(scores.J>=scores.P)?"J":"P";

  const domTips=TYPE_DOMAINS[mbti] || {life:"(준비중)",work:"(준비중)",rel:"(준비중)",study:"(준비중)"};

  // 결과 화면만 보이도록 질문 제거
  $("#form").innerHTML="";

  $("#result").innerHTML=`<pre>
[결과]
${mbti}   신뢰도: ${Math.round((answers.length/8)*100)}%

[팁]
- 생활
${domTips.life}
- 일
${domTips.work}
- 인간관계
${domTips.rel}
- 학습
${domTips.study}

[MBTI 의미]
E                           I
S                           N
T                           F
J                           P
</pre>`;

  if(DEBUG){
    $("#debug-panel").style.display="block";
    $("#debug-panel").innerText=JSON.stringify(scores,null,2);
  }
}

renderQuestions();
