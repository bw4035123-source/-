# 4차 블라인드 문항 생성(독립 작성자: 로컬 EXAONE 3.5) — Ollama 필요. 결과는 사람이 라벨만 검토해 tests/fixtures/routing-blind-v4.json 으로 저장
import json, urllib.request, re
# 상황 이름과 한 줄 설명만 제공(규칙 사전·트리거는 주지 않음)
TOPICS = [
 ("floor-noise","층간소음","공동주택 위·아래·옆집 사이 생활 소음 피해와 기준"),
 ("deposit-return","보증금 반환","임대차 계약이 끝났는데 집주인이 보증금을 돌려주지 않는 상황"),
 ("jeonse-fraud","전세사기 예방","전세 계약 전 위험 확인, 집이 경매·압류되거나 집주인 문제로 보증금을 잃을 위험"),
 ("lease-renewal","계약 갱신","세입자의 임대차 계약 갱신 요구, 임대료 인상 한도, 집주인의 실거주 거절"),
 ("parental-leave","육아휴직","근로자의 육아휴직 신청·기간·급여·불이익 금지"),
 ("petition-deadline","민원 처리 기한","행정기관에 낸 민원의 처리기간과 답변 지연"),
 ("drunk-driving","음주운전","술을 마시고 운전했을 때의 처벌·면허 취소·정지 기준"),
 ("unpaid-wages","임금체불","월급·퇴직금 등 임금을 받지 못한 상황"),
 ("unfair-dismissal","부당해고","회사로부터 갑자기 또는 부당하게 해고당한 상황"),
 ("privacy-access","개인정보 열람·삭제","기관·회사가 가진 내 개인정보의 열람·정정·삭제 요구"),
 ("info-disclosure","정보공개 청구","공공기관이 가진 문서·자료의 공개를 청구하는 상황"),
 ("admin-appeal","행정심판","행정기관의 처분(영업정지·과태료·면허취소 등)에 불복하는 상황"),
 ("work-rules","취업규칙 점검(공직자)","기관의 취업규칙·복무규정이 근로기준법(근로시간·휴가·휴게 등)에 맞는지 검토"),
 ("local-public-enterprise","지방공기업(공직자)","지방공사·지방공단의 설립·임원 임기·임원추천·경영평가"),
 ("election-neutrality","선거 중립(공직자)","공무원·공공기관 직원의 선거운동 금지와 정치적 중립"),
 ("anti-graft","청탁금지법(공직자)","공직자의 금품·선물·접대 수수 한도, 부정청탁, 외부강의 사례금"),
 ("public-property","공유재산(공직자)","지자체 소유 재산의 사용허가·대부·사용료"),
]
def ask(prompt):
    body={"model":"exaone3.5:7.8b","prompt":prompt,"stream":False,"options":{"temperature":0.9,"num_ctx":4096,"seed":20261026}}
    r=urllib.request.urlopen(urllib.request.Request("http://localhost:11434/api/generate",json.dumps(body).encode(),{"Content-Type":"application/json"}),timeout=900)
    return json.load(r)["response"]
out=[]
for tid,label,desc in TOPICS:
    who = "공무원·공공기관 실무자" if "공직자" in label else "법을 잘 모르는 일반 시민"
    p=f"""다음 상황에 처한 {who}가 법률 상담 검색창에 실제로 입력할 법한 질문을 3개 써 주세요.
상황: {label} — {desc}
조건: 사람마다 말투가 다르게(구어체·짧은 키워드·하소연 등 섞기), 상황 이름이나 법 이름을 그대로 쓰지 말고 자기 일처럼, 한 줄에 하나씩, 번호나 따옴표 없이 질문만."""
    txt=ask(p)
    qs=[re.sub(r'^[\s\-\d\.\)•·"“]+|["”]$','',l).strip() for l in txt.splitlines() if l.strip()]
    qs=[q for q in qs if 6<=len(q)<=80][:3]
    out.append({"topic":tid,"qs":qs})
    print(tid, qs, flush=True)
p="""법률 상담 검색창에 일반 시민이나 공무원이 입력할 법한 질문을 10개 써 주세요.
조건: 다음 주제는 절대 포함하지 마세요 — 층간소음, 전세·월세·보증금·임대차, 육아휴직, 민원 처리기간, 음주운전, 임금·퇴직금 체불, 해고, 개인정보, 정보공개, 행정심판, 취업규칙, 지방공기업, 선거, 청탁·선물·접대, 공유재산.
그 밖의 다양한 생활·행정 법률 주제로, 한 줄에 하나씩, 번호나 따옴표 없이 질문만."""
txt=ask(p)
nulls=[re.sub(r'^[\s\-\d\.\)•·"“]+|["”]$','',l).strip() for l in txt.splitlines() if l.strip()]
nulls=[q for q in nulls if 6<=len(q)<=80][:10]
print("null", nulls)
json.dump({"topics":out,"null":nulls},open("gen.json","w"),ensure_ascii=False,indent=1)
