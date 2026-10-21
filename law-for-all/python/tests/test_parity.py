"""Next.js(TypeScript) 엔진과 Python 이식판의 결과 동등성 검증 — 같은 입력이면 같은 답변·인용·추천·요건 판정"""
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
for k in ("LAW_API_OC", "LAW_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
    os.environ.pop(k, None)
os.environ["LAW_PROXY_URL"] = "off"  # 테스트는 네트워크 없이(기본 중계 서버 대신 직접 모드 + 모킹)

from law_for_all.analyze import analyze  # noqa: E402
from law_for_all.ask import ask  # noqa: E402
from law_for_all.followup import followup  # noqa: E402

FIX = json.loads((Path(__file__).parent / "parity_fixtures.json").read_text(encoding="utf-8"))


def strip(o: dict) -> dict:
    return {k: v for k, v in o.items() if k not in ("elapsedMs", "generatedAt")}


class ParityTest(unittest.TestCase):
    maxDiff = None

    def test_ask(self):
        for case in FIX["ask"]:
            i = case["input"]
            with self.subTest(query=i["query"], mode=i["mode"]):
                self.assertEqual(strip(ask(i["query"], i["mode"])), case["output"])

    def test_analyze(self):
        for case in FIX["analyze"]:
            s = case["input"]["situation"]
            with self.subTest(situation=s[:30]):
                self.assertEqual(strip(analyze(s)), case["output"])

    def test_followup(self):
        for case in FIX["followup"]:
            i = case["input"]
            with self.subTest(prev=i["prevQuery"], question=i["question"], mode=i["mode"]):
                self.assertEqual(strip(followup(i["question"], i["prevQuery"], i["mode"])), case["output"])


if __name__ == "__main__":
    unittest.main()
