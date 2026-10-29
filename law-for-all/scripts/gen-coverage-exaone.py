# 처음 보는 일상 질문 블라인드 문항 생성(독립 작성자: 로컬 EXAONE 3.5) — 사용자 PC의 Ollama에서 실행
#   ollama pull exaone3.5:7.8b   (이미 있으면 생략)
#   python gen-coverage-exaone.py      → coverage-blind-exaone.json 생성
# 법이음의 상황(토픽) 목록·규칙은 주지 않고, 넓은 생활 분야 이름만 준다(상황 밖 질문 대응력을 재기 위함).
# 결과 파일은 사람이 법령 이름 표기만 검토해 커밋한 뒤 한 번 측정한다(문항을 보고 규칙을 고치지 않음).
import json
import re
import sys
import urllib.request

MODEL = sys.argv[1] if len(sys.argv) > 1 else "exaone3.5:7.8b"
AREAS = [
    "가족(결혼·이혼·자녀)", "상속·유언", "개인 간 돈거래", "물건 사고팔기·소비자 피해", "인터넷·온라인 피해",
    "직장·아르바이트", "집·임대차·이웃", "교통·운전", "범죄 피해", "수사·고소를 당한 경우",
    "병원·의료", "학교·교육", "복지·지원금", "세금·과태료", "동물·반려견",
]


def ask(prompt: str) -> str:
    body = {"model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.9, "num_ctx": 4096, "seed": 20261029}}
    req = urllib.request.Request("http://localhost:11434/api/generate", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)["response"]


out = []
for area in AREAS:
    p = f"""한국에서 '{area}' 분야의 법률 문제를 겪는 일반 시민이 법률 상담 검색창에 실제로 입력할 법한 질문을 4개 써 주세요.
각 질문 뒤에 그 질문에 답할 때 근거가 되는 대한민국 법령의 정식 이름을 하나 적어 주세요.
조건: 사람마다 말투가 다르게(구어체·짧은 하소연·키워드 섞기), 법 이름은 질문 안에 쓰지 말 것.
형식: 한 줄에 하나씩 '질문 | 법령이름' (번호·따옴표 없이)"""
    txt = ask(p)
    n = 0
    for line in txt.splitlines():
        if "|" not in line:
            continue
        q, law = (re.sub(r'^[\s\-\d\.\)•·"“]+|["”]$', "", x).strip() for x in line.split("|", 1))
        law = re.sub(r"^[「『\[(]|[」』\])]$", "", law).strip()
        if 6 <= len(q) <= 80 and law:
            out.append({"area": area, "q": q, "law": law})
            n += 1
        if n >= 4:
            break
    print(area, n, flush=True)

json.dump({"model": MODEL, "generator": "scripts/gen-coverage-exaone.py", "cases": out}, open("coverage-blind-exaone.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"✔ coverage-blind-exaone.json ({len(out)}문항) — 이 파일을 그대로 보내 주세요")
