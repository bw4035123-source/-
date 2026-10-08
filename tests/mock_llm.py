"""시험용 OpenAI 호환 모의 LLM 서버(실제 모델 없이 LLM 경로를 검증).

프롬프트 종류를 알아보고 형식에 맞는 응답을 돌려준다. 일부러 ```json 코드펜스, 끝 쉼표,
존재하지 않는 근거 ID(S9999)를 섞어 파서·출처 검증 로직도 함께 시험한다.
"""
from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def respond(messages: list[dict]) -> str:
    user = messages[-1]["content"]
    ids = re.findall(r"S\d{4}", user)
    first = ids[0] if ids else "S0001"
    if "대한민국의 수도" in user:
        return "서울"
    if '"task": "수준진단 제출"' in user:
        return '```json\n{"task": "수준진단 제출", "month": 5, "day": 29,}\n```'
    if "도에 먼저 보내야 하는 기한" in user:
        return "도에는 5월 22일까지 먼저 보내야 합니다 [S1]."
    if "[진행 중인 현안]" in user:
        return json.dumps([
            {"title": "웹 접근성 개선", "status": "대기", "text": "업체 견적 회신 대기 중임.", "next": "개선 범위 확정 후 견적 요청",
             "due": "9월 30일", "sources": [first]},
            {"title": "근거 없는 현안", "status": "진행중", "text": "근거 없이 지어낸 문장", "next": "", "due": "", "sources": ["S9999"]},
        ], ensure_ascii=False)
    if "인수인계서의 [" in user:
        return "설명입니다.\n" + json.dumps([{"text": "AI가 정리한 항목입니다.", "sources": [first]},
                                           {"text": "두 번째 항목", "sources": ids[1:2] or [first]}], ensure_ascii=False) + ",]"
    if "인터뷰어" in user:
        return json.dumps([{"q": "보안관제 서비스 계약 갱신 준비는 몇 월부터 시작하나요?", "why": "결론 없음", "section": "issues", "sources": [first]}],
                          ensure_ascii=False)
    if "1~2문장으로 요약" in user:
        return '{"summary": "모의 요약입니다."}'
    if "후임자의 질문" in user:
        if "주차" in user:
            return "자료에서 찾을 수 없습니다."
        return f"관련 내용은 근거에 있습니다 [{first}]."
    return "[]"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        content = respond(body["messages"])
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def start(port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


if __name__ == "__main__":
    s, p = start(11999)
    print(f"mock LLM: http://127.0.0.1:{p}/v1")
    threading.Event().wait()
