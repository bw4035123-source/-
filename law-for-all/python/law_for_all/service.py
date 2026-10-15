"""법령 저장소 — 실시간(Open API)과 내장 데이터를 하나의 인터페이스로, 실패 시 자동 대체"""
from __future__ import annotations

import concurrent.futures as cf

from .data import DATASET_DATE, LAWS, get_law, parse_key, to_citation
from .drf import LawApiError, drf_get, parse_case_detail, parse_case_list, parse_law_doc, parse_law_list
from .search import search_law_names

CASE_TIMEOUT = 25
# 답변(질의응답·상황분석)이 실시간 원문을 기다리는 최대 시간 — 넘으면 공식 원문 스냅샷으로 즉시 답변
ANSWER_LIVE_BUDGET = 6.0
# 법령 뷰어가 실시간 원문을 기다리는 최대 시간
VIEWER_LIVE_BUDGET = 9.0
FAST = {"timeout": 5, "retries": 1}
# 기한을 넘긴 요청도 백그라운드에서 끝까지 진행 → 캐시에 저장되어 다음 요청부터 실시간
_POOL = cf.ThreadPoolExecutor(max_workers=8, thread_name_prefix="law-live")


def _summary(l: dict) -> dict:
    return {"id": l["id"], "name": l["name"], "kind": l["kind"], "ministry": l["ministry"], "articleCount": len(l["articles"]), "parentId": l.get("parentId"), "source": l.get("source", "mock")}


def _merge(live: dict, mock: dict) -> dict:
    meta = {a["no"]: a for a in mock["articles"]}
    return {
        **live, "id": mock["id"], "shortName": mock.get("shortName"), "parentId": mock.get("parentId"), "kind": mock["kind"],
        "ministry": live.get("ministry") or mock["ministry"], "revisionReason": live.get("revisionReason") or mock.get("revisionReason"),
        "practiceNotes": mock.get("practiceNotes"),
        "articles": [{**a, "delegates": meta.get(a["no"], {}).get("delegates"), "keywords": meta.get(a["no"], {}).get("keywords")} for a in live["articles"]],
    }


class LawService:
    def __init__(self, oc: str = ""):
        self.oc = oc
        self.warnings: list[str] = []
        self._memo: dict[str, dict | None] = {}

    @property
    def mode(self) -> str:
        return "live" if self.oc else "mock"

    def list_laws(self, query: str = "") -> list[dict]:
        local = [_summary(l) for l in search_law_names(query)]
        if not self.oc or not query.strip():
            return local
        try:
            known = {l["name"].replace(" ", "") for l in LAWS}
            live = [
                {"id": f"mst-{x['mst']}", "name": x["name"], "kind": x["kind"] or "법률", "ministry": x["ministry"], "articleCount": 0, "source": "live"}
                for x in parse_law_list(drf_get("lawSearch.do", {"target": "law", "query": query, "display": "20"}, self.oc))
                if x["name"].replace(" ", "") not in known
            ]
            return local + live
        except LawApiError as e:
            self.warnings.append(str(e))
            return local

    def get_law(self, law_id: str, fast: bool = False) -> dict | None:
        """fast: 짧은 제한시간·재시도 1회(시간 예산 경로용)"""
        if law_id in self._memo:
            return self._memo[law_id]
        t = FAST if fast else {"timeout": 20, "retries": None}
        mock = get_law(law_id)
        result = mock
        if self.oc:
            try:
                if law_id.startswith("mst-"):
                    mst = law_id[4:]
                    result = parse_law_doc(drf_get("lawService.do", {"target": "law", "MST": mst}, self.oc, t["timeout"], t["retries"]), law_id, "", mst)
                elif mock:
                    live = self._fetch_by_name(mock["name"], law_id, fast)
                    result = _merge(live, mock) if live else mock
            except LawApiError as e:
                self.warnings.append(f"{mock['name'] if mock else law_id}: {e} — 내장 데이터로 대체")
                result = mock
        self._memo[law_id] = result
        return result

    def _fetch_by_name(self, name: str, law_id: str, fast: bool = False) -> dict | None:
        t = FAST if fast else {"timeout": 20, "retries": None}
        lst = parse_law_list(drf_get("lawSearch.do", {"target": "law", "query": name, "display": "20"}, self.oc, t["timeout"], t["retries"]))
        exact = [x for x in lst if x["name"].replace(" ", "") == name.replace(" ", "")]
        if not exact:
            raise LawApiError(f"'{name}'을(를) 국가법령정보에서 찾지 못했습니다")
        current = [x for x in exact if not x["status"] or x["status"] == "현행"] or exact
        pick = sorted(current, key=lambda x: x["effective"], reverse=True)[0]
        doc = parse_law_doc(drf_get("lawService.do", {"target": "law", "MST": pick["mst"]}, self.oc, t["timeout"], t["retries"]), law_id, name, pick["mst"])
        # 본문의 기본정보.시행일자는 단계적 시행 조문 중 '마지막' 시행일일 수 있어, 목록의 현행 시행일자를 사용
        if pick.get("effective"):
            doc["effectiveDate"] = pick["effective"]
        return doc

    def _get_laws_within(self, ids: list[str], budget: float) -> dict:
        """여러 법령을 병렬로 조회하되 budget 초 안에 끝나지 않은 것은 공식 원문 스냅샷으로 대체"""
        if not self.oc or not budget:
            return {i: self.get_law(i) for i in ids}
        def fetch(i):
            svc = LawService(self.oc)
            return svc.get_law(i, True), svc.warnings

        futs = {i: _POOL.submit(fetch, i) for i in ids}
        done, _ = cf.wait(futs.values(), timeout=budget)
        out = {}
        for i, f in futs.items():
            if f in done:
                law, warns = f.result()
                out[i] = law
                # 실패 사유(인증 실패·연결 실패 등)를 그대로 전달 — 원인 진단에 필요
                for w in warns:
                    if w not in self.warnings:
                        self.warnings.append(w)
            else:
                out[i] = get_law(i)
                msg = f"국가법령정보센터 응답 지연({round(budget)}초 초과) — 공식 원문 스냅샷({DATASET_DATE} 수집)으로 표시했습니다. 잠시 후 다시 검색하면 실시간 원문으로 표시됩니다."
                if msg not in self.warnings:
                    self.warnings.append(msg)
            self._memo[i] = out[i]
        return out

    def get_hierarchy(self, law_id: str, budget: float = VIEWER_LIVE_BUDGET) -> dict | None:
        """상위법-시행령-시행규칙 3단 구조(병렬 조회, 시간 예산 적용)"""
        base = get_law(law_id)
        root_id = (base or {}).get("parentId") or law_id
        child_ids = [l["id"] for l in LAWS if l.get("parentId") == root_id]
        ids = list(dict.fromkeys([root_id, law_id, *child_ids]))
        docs = self._get_laws_within(ids, budget)
        root = docs.get(root_id) or docs.get(law_id)
        if not root:
            return None
        return {"root": root, "children": [docs[c] for c in child_ids if docs.get(c)]}

    def get_citations(self, keys: list[str], budget: float = ANSWER_LIVE_BUDGET) -> list[dict]:
        """인용 키 → 인용 카드(법령별 병렬, 시간 예산 적용)"""
        law_ids = list(dict.fromkeys(p[0] for p in (parse_key(k) for k in keys) if p))
        docs = self._get_laws_within(law_ids, budget)
        out = {}
        for k in keys:
            p = parse_key(k)
            if not p or not docs.get(p[0]):
                continue
            law = docs[p[0]]
            art = next((a for a in law["articles"] if a["no"] == p[1]), None)
            if not art and get_law(p[0]):
                art = next((a for a in get_law(p[0])["articles"] if a["no"] == p[1]), None)
            if art:
                out[k] = to_citation(law, art)
        return [out[k] for k in keys if k in out]

    def search_cases(self, query: str, limit: int = 5) -> list[dict]:
        """판례·법령해석례: 사건명 검색 우선, 결과가 부족하면 본문 검색(search=2)으로 보완"""
        if not self.oc or not query.strip():
            return []
        display = str(min(max(int(limit), 1), 20))

        def one(target: str, kind: str) -> list[dict]:
            by_name = parse_case_list(drf_get("lawSearch.do", {"target": target, "query": query, "display": display}, self.oc, CASE_TIMEOUT), kind)
            if len(by_name) >= 2:
                return by_name
            by_text = parse_case_list(drf_get("lawSearch.do", {"target": target, "query": query, "display": display, "search": "2"}, self.oc, CASE_TIMEOUT), kind)
            return (by_name + [c for c in by_text if not any(b["id"] == c["id"] for b in by_name)])[: int(display)]

        try:
            return one("prec", "판례") + one("expc", "법령해석례")
        except LawApiError as e:
            self.warnings.append(str(e))
            return []

    def get_case(self, kind: str, case_id: str) -> dict | None:
        """판례·법령해석례 상세 — 실시간 연동 시에만 제공(사건 내용을 지어내지 않음)"""
        if not self.oc or not case_id.isdigit() or len(case_id) > 12:
            return None
        try:
            data = drf_get("lawService.do", {"target": "prec" if kind == "판례" else "expc", "ID": case_id}, self.oc, CASE_TIMEOUT)
            return parse_case_detail(data, kind, case_id)
        except LawApiError as e:
            self.warnings.append(str(e))
            return None
