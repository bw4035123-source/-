"""법령 저장소 — 실시간(Open API)과 내장 데이터를 하나의 인터페이스로, 실패 시 자동 대체"""
from __future__ import annotations

from .data import LAWS, get_law, parse_key, to_citation
from .drf import LawApiError, drf_get, parse_case_detail, parse_case_list, parse_law_doc, parse_law_list
from .search import search_law_names

CASE_TIMEOUT = 25


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

    def get_law(self, law_id: str) -> dict | None:
        if law_id in self._memo:
            return self._memo[law_id]
        mock = get_law(law_id)
        result = mock
        if self.oc:
            try:
                if law_id.startswith("mst-"):
                    mst = law_id[4:]
                    result = parse_law_doc(drf_get("lawService.do", {"target": "law", "MST": mst}, self.oc), law_id, "", mst)
                elif mock:
                    live = self._fetch_by_name(mock["name"], law_id)
                    result = _merge(live, mock) if live else mock
            except LawApiError as e:
                self.warnings.append(f"{mock['name'] if mock else law_id}: {e} — 내장 데이터로 대체")
                result = mock
        self._memo[law_id] = result
        return result

    def _fetch_by_name(self, name: str, law_id: str) -> dict | None:
        lst = parse_law_list(drf_get("lawSearch.do", {"target": "law", "query": name, "display": "20"}, self.oc))
        exact = [x for x in lst if x["name"].replace(" ", "") == name.replace(" ", "")]
        if not exact:
            raise LawApiError(f"'{name}'을(를) 국가법령정보에서 찾지 못했습니다")
        current = [x for x in exact if not x["status"] or x["status"] == "현행"] or exact
        pick = sorted(current, key=lambda x: x["effective"], reverse=True)[0]
        doc = parse_law_doc(drf_get("lawService.do", {"target": "law", "MST": pick["mst"]}, self.oc), law_id, name, pick["mst"])
        # 본문의 기본정보.시행일자는 단계적 시행 조문 중 '마지막' 시행일일 수 있어, 목록의 현행 시행일자를 사용
        if pick.get("effective"):
            doc["effectiveDate"] = pick["effective"]
        return doc

    def get_hierarchy(self, law_id: str) -> dict | None:
        base = self.get_law(law_id)
        if not base:
            return None
        root_id = base.get("parentId") or base["id"]
        root = base if root_id == base["id"] else (self.get_law(root_id) or base)
        children = [c for c in (self.get_law(l["id"]) for l in LAWS if l.get("parentId") == root["id"]) if c]
        return {"root": root, "children": children}

    def get_citations(self, keys: list[str]) -> list[dict]:
        out = {}
        for k in keys:
            p = parse_key(k)
            if not p:
                continue
            law = self.get_law(p[0])
            if not law:
                continue
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
