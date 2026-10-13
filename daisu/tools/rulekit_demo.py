"""rulekit 전체 흐름 예시: 규정 읽기 → 검색 → (LLM 판정 JSON) → 이수시간 계산 → 제출 양식 문서.

    pip install -r requirements-ai.txt
    python tools/rulekit_demo.py                 # [예시] 지침과 가상 판정으로 실행 → output/ 에 hwpx·docx
    python tools/rulekit_demo.py --bge-m3        # 밀집 임베딩을 BGE-m3 로(모델 내려받기 필요)
    python tools/rulekit_demo.py --template 우리기관_양식.hwpx   # 기관 제출 양식에 채우기

LLM 부분은 일부러 비워 두었습니다(judgment_prompt 로 만든 지시문을 기관이 쓰는 LLM 에 보내고, 받은 JSON 을
parse_judgment 에 넣으면 됩니다). 이 예시는 정해 둔 가상 판정 JSON 을 씁니다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from daisu.rulekit.calc import Judgment, compute_all, parse_judgment  # noqa: E402
from daisu.rulekit.chunking import split_regulation  # noqa: E402
from daisu.rulekit.official import render  # noqa: E402
from daisu.rulekit.parser import parse_text  # noqa: E402
from daisu.rulekit.retrieval import BGEM3Embeddings, HashingEmbeddings, HybridRegulationRetriever  # noqa: E402
from daisu.rulekit.schema import Profile  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "tests", "rulekit", "fixtures")
LAW = "[예시] 교육훈련 운영 지침"


def judgment_prompt(record: dict, docs, rules) -> str:
    """LLM 에 보낼 지시문: 근거 조문과 규칙 목록 안에서만 고르게 하고, JSON 형식을 강제한다."""
    ctx = "\n\n".join(f"[{d.metadata['law_name']} {d.metadata['article']} · 시행 {d.metadata['effective_date']}]\n{d.page_content}" for d in docs)
    rl = "\n".join(f"- {r.rule_id}: {r.category.value} / {r.title} / {r.legal_basis.cite()}" for r in rules)
    schema = json.dumps(Judgment.model_json_schema(), ensure_ascii=False)
    return (f"다음 교육 기록이 어떤 이수시간 인정 규칙에 해당하는지 판정하세요. 아래 규칙 목록의 rule_id 만 쓰고, "
            f"해당 규칙이 없으면 recognized=false 로 하세요. 시간 계산·상한 적용은 하지 마세요(별도 엔진이 합니다).\n\n"
            f"[교육 기록]\n{json.dumps(record, ensure_ascii=False)}\n\n[규칙 목록]\n{rl}\n\n[근거 조문]\n{ctx}\n\n"
            f"[출력 형식] 아래 JSON Schema 를 따르는 JSON 하나만 출력:\n{schema}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bge-m3", action="store_true")
    ap.add_argument("--template", default="")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "output"))
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    v1 = open(os.path.join(FIX, "example_guideline_v1.txt"), encoding="utf-8").read()
    v2 = open(os.path.join(FIX, "example_guideline_v2.txt"), encoding="utf-8").read()
    parsed = parse_text(v2, LAW, dt.date(2026, 1, 1))
    rs = parsed.ruleset("2026", dt.date(2026, 1, 1))
    print(f"① 규정에서 규칙 {len(rs.rules)}개, 의무 기준 {len(rs.requirements)}개를 읽음 (확인 필요 문장 {len(parsed.unparsed)}개)")
    for r in rs.rules:
        print(f"   {r.rule_id:<12} {r.category.value:<5} {r.legal_basis.cite()}")

    docs = split_regulation(v1, LAW) + split_regulation(v2, LAW)
    emb = BGEM3Embeddings() if a.bge_m3 else HashingEmbeddings()
    ret = HybridRegulationRetriever(documents=docs, embeddings=emb, k=3)
    q = "자기개발학습 인정 한도"
    print(f"\n② 검색 '{q}':")
    for d in ret.invoke(q):
        print(f"   {d.metadata['article']} 시행 {d.metadata['effective_date']} 점수 {d.metadata['score']}{' (구판)' if d.metadata['superseded'] else ''}")
    record = {"record_id": "r1", "course": "온라인 외국어 과정", "hours": 30, "date": "2026-05-10"}
    print(f"\n   LLM 지시문 예(앞부분): {judgment_prompt(record, ret.invoke(record['course']), rs.rules)[:120]}…")

    people = [Profile(person_id="P1", name="김주무", dept="총무팀", series="행정", grade="7급"),
              Profile(person_id="P2", name="이팀장", dept="총무팀", series="행정", grade="5급"),
              Profile(person_id="P3", name="박시설", dept="시설팀", series="시설", grade="6급")]
    llm_out = [  # 가상 판정(실제로는 LLM 이 judgment_prompt 를 받고 돌려준 JSON)
        '{"person_id":"P1","items":[{"record_id":"r1","rule_id":"BASIC-A5-1","category":"기본교육","hours":44,"date":"2026-03-02"},'
        '{"record_id":"r2","rule_id":"SELF-A7-1","category":"자기개발","hours":30,"recognized_ratio":1,"date":"2026-05-10"}]}',
        '```json\n{"person_id":"P2","items":[{"record_id":"r1","rule_id":"BASIC-A5-1","category":"기본교육","hours":20}]}\n```',
        '{"person_id":"P3","items":[{"record_id":"r1","rule_id":"PROF-A6-2","category":"전문교육","hours":36},'
        '{"record_id":"r2","rule_id":"BASIC-A5-2","category":"기본교육","hours":12}]}']
    res = compute_all(people, [parse_judgment(x) for x in llm_out], rs)
    print("\n③ 계산 결과")
    for r in res:
        print(f"   {r.profile.name}({r.profile.grade} {r.profile.series}) 합계 {r.total}시간 · 미달 {r.total_shortfall}시간 · 가점 {r.bonus_points}점")
        for it in r.items:
            if it.notes:
                print(f"      - {it.record_id}: {it.credited_hours}시간 인정 ({'; '.join(it.notes)})")

    os.makedirs(a.out, exist_ok=True)
    tpl = open(a.template, "rb").read() if a.template else None
    fmts = [os.path.splitext(a.template)[1][1:].lower()] if a.template else ["hwpx", "docx"]
    for fmt in fmts:
        p = os.path.join(a.out, f"교육훈련_실적_제출.{fmt}")
        with open(p, "wb") as f:
            f.write(render(res, "가상기관", 2026, "2026-12-31", fmt, template=tpl))
        print(f"\n④ 문서 저장: {os.path.abspath(p)}")


if __name__ == "__main__":
    main()
