"""법령 저장소 — 실시간(Open API)과 내장 데이터를 하나의 인터페이스로, 실패 시 자동 대체"""
from __future__ import annotations

import concurrent.futures as cf
import math
import time

from .data import DATASET_DATE, LAWS, get_law, parse_key, to_citation
from .drf import LawApiError, drf_get, find_all, txt, parse_admrul_doc, parse_admrul_list, parse_case_detail, parse_case_list, parse_law_doc, parse_law_list, parse_ordin_doc, parse_ordin_list
from .search import bigram_overlap, query_terms, score_article_by_terms, search_law_names

CASE_TIMEOUT = 25
# 판례 검색 전체 대기 한도(초)
CASE_BUDGET = 12.0
# 답변(질의응답·상황분석)이 실시간 원문을 기다리는 최대 시간 — 넘으면 공식 원문 스냅샷으로 즉시 답변
ANSWER_LIVE_BUDGET = 6.0
# 법령 뷰어가 실시간 원문을 기다리는 최대 시간
VIEWER_LIVE_BUDGET = 9.0
# 내장 토픽 밖 질문: 전체 법령 검색(법령명 검색 + 본문 조회)을 기다리는 최대 시간
LIVE_SEARCH_BUDGET = 15.0
# 내장 사본이 없는 법령(전체 법령·행정규칙·자치법규)을 기다리는 최대 시간
LIVE_ONLY_BUDGET = 30.0
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

    def list_laws(self, query: str = "", kind: str = "law") -> list[dict]:
        """kind: law(법률·시행령·시행규칙) | admrul(행정규칙) | ordin(자치법규). 실시간 모드면 전체 법령 검색"""
        local = [_summary(l) for l in search_law_names(query)] if kind == "law" else []
        if not self.oc or not query.strip():
            return local
        try:
            if kind == "admrul":
                return [{"id": f"adm-{x['key']}", "name": x["name"], "kind": "행정규칙", "subKind": x["subKind"], "ministry": x["org"], "articleCount": 0, "source": "live", "effectiveDate": x["effective"]}
                        for x in parse_admrul_list(drf_get("lawSearch.do", {"target": "admrul", "query": query, "display": "50"}, self.oc))]
            if kind == "ordin":
                return [{"id": f"ord-{x['key']}", "name": x["name"], "kind": "자치법규", "subKind": x["subKind"], "ministry": x["org"], "articleCount": 0, "source": "live", "effectiveDate": x["effective"]}
                        for x in parse_ordin_list(drf_get("lawSearch.do", {"target": "ordin", "query": query, "display": "50"}, self.oc))]
            known = {l["name"].replace(" ", "") for l in LAWS}
            live = [
                {"id": f"mst-{x['mst']}", "name": x["name"], "kind": x["kind"] or "법률", "ministry": x["ministry"], "articleCount": 0, "source": "live", "effectiveDate": x["effective"]}
                for x in parse_law_list(drf_get("lawSearch.do", {"target": "law", "query": query, "display": "50"}, self.oc))
                if x["name"].replace(" ", "") not in known and (not x["status"] or x["status"] == "현행")
            ]
            return local + live
        except LawApiError as e:
            self.warnings.append(str(e))
            return local

    def search_live_keys(self, query: str, budget: float = LIVE_SEARCH_BUDGET, max_articles: int = 4) -> list[str]:
        """내장 토픽에 없는 질문: Open API로 관련 법령을 찾아 조문 근거 키(질문 → 검색어 → 법령명 검색 → 본문 → 조문 점수)"""
        if not self.oc:
            return []
        terms = query_terms(query)
        if not terms:
            return []
        oc = self.oc

        def work() -> list[str]:
            # 검색어마다 법령명 검색 + 본문 검색(본문 검색 결과 수가 적은 '드문 말'일수록 가중치 큼)
            def get(arg):
                t, body = arg
                params = {"target": "law", "query": t, "display": "100" if body else "10", **({"search": "2"} if body else {})}
                try:
                    d = drf_get("lawSearch.do", params, oc, FAST["timeout"], FAST["retries"])
                    tot = txt((find_all(d, "totalCnt") or [""])[0])
                    return {"list": parse_law_list(d), "total": int(tot) if tot.isdigit() else 0}
                except LawApiError:
                    return {"list": [], "total": 0}

            # 여러 말을 한꺼번에 넣은 본문 검색은 AND 조건 → 모두 들어 있는 법령(결과가 적어 정확)
            combos = list(dict.fromkeys([" ".join(terms), " ".join(terms[:2])])) if len(terms) >= 2 else []
            allres = list(_POOL.map(get, [(t, b) for t in terms for b in (False, True)] + [(c, True) for c in combos]))
            res, and_res = allres[: len(terms) * 2], allres[len(terms) * 2:]
            # 점수: 드문 말일수록 큰 가중치(IDF). 본문 검색은 결과가 100건을 넘으면 가나다순 앞부분만 오므로
            # (관련도와 무관) 100건 이하로 '전부' 받은 경우만 근거로 쓴다.
            def idf(n, base, hi):
                return min(hi, max(0.3, math.log2(base / n))) if n > 0 else 0.0

            def complete(r):
                return 0 < r["total"] <= 100

            cand: dict[str, dict] = {}

            def add(x, v):
                if x["status"] and x["status"] != "현행":
                    return
                c = cand.setdefault(x["mst"], {"mst": x["mst"], "name": x["name"], "score": (0.5 if x["kind"] == "법률" else 0) - len(x["name"]) / 40 + bigram_overlap(x["name"], terms) * 3})
                c["score"] += v

            for ti, t in enumerate(terms):
                by_name, by_body = res[ti * 2], res[ti * 2 + 1]
                # 법령명 일치: 이름이 검색어에 가까울수록(짧을수록) 크게 — "주차장" → 주차장법
                w_name = idf(by_name["total"] or len(by_name["list"]), 300, 6) * 2
                for x in by_name["list"]:
                    if t in x["name"]:
                        add(x, w_name * math.sqrt(len(t) / len(x["name"].replace(" ", ""))))
                if complete(by_body):
                    for x in by_body["list"]:
                        add(x, idf(by_body["total"], 3000, 8))
            # 여러 말이 모두 들어 있는 법령(AND 본문 검색)
            for i, r in enumerate(and_res):
                if complete(r):
                    for x in r["list"]:
                        add(x, (5 if i == 0 else 3) * (1 if x["kind"] == "법률" else 0.6))
            # 근거가 하나도 없으면(모든 말이 흔한 경우) 본문 검색 앞부분 중 법령명이 질문과 비슷한 것만 비교
            # (본문 검색 앞부분은 가나다순이라 관련 없는 법령이 섞이므로 이름이 전혀 안 닮은 법령은 제외)
            if not cand:
                for ti in range(len(terms)):
                    for x in res[ti * 2 + 1]["list"]:
                        if bigram_overlap(x["name"], terms) > 0:
                            add(x, 0.1)
            # 같은 법령의 여러 판(시행 예정 등)은 하나만
            top, seen = [], set()
            for c in sorted(cand.values(), key=lambda c: c["score"], reverse=True):
                if c["name"] not in seen:
                    seen.add(c["name"])
                    top.append(c)
            top = top[:2]
            scored = []
            for c in top:
                doc = LawService(oc).get_law(f"mst-{c['mst']}")
                if not doc:
                    continue
                for a in doc["articles"]:
                    sc = score_article_by_terms(a, terms)
                    # 흔한 말 하나만 겹치는 조문은 근거로 쓰지 않음(제목 일치 또는 본문에 두 말 이상)
                    if sc >= 2:
                        scored.append((sc, f"{doc['id']}:{a['no']}"))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [k for _, k in scored[:max_articles]]

        fut = _POOL.submit(work)
        try:
            return fut.result(timeout=budget)
        except cf.TimeoutError:
            msg = "국가법령정보센터 검색이 늦어 일부 근거를 표시하지 못했습니다. 잠시 후 다시 검색해 주세요."
            if msg not in self.warnings:
                self.warnings.append(msg)
            return []

    def get_law(self, law_id: str, fast: bool = False) -> dict | None:
        """fast: 짧은 제한시간·재시도 1회(시간 예산 경로용)"""
        if law_id in self._memo:
            return self._memo[law_id]
        t = FAST if fast else {"timeout": 20, "retries": None}
        mock = get_law(law_id)
        result = mock
        if self.oc:
            try:
                if law_id.startswith("adm-"):
                    result = parse_admrul_doc(drf_get("lawService.do", {"target": "admrul", "ID": law_id[4:]}, self.oc, t["timeout"], t["retries"]), law_id)
                elif law_id.startswith("ord-"):
                    result = parse_ordin_doc(drf_get("lawService.do", {"target": "ordin", "MST": law_id[4:]}, self.oc, t["timeout"], t["retries"]), law_id)
                elif law_id.startswith("mst-"):
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
            # 내장 사본이 있으면 빠른 호출(늦으면 사본으로), 없으면 보통 제한시간으로
            return svc.get_law(i, get_law(i) is not None), svc.warnings

        futs = {i: _POOL.submit(fetch, i) for i in ids}
        # 내장 사본이 없는 법령(전체 법령 검색 결과·행정규칙·자치법규)은 대체할 것이 없으므로 더 기다린다
        if any(get_law(i) is None for i in ids):
            budget = max(budget, LIVE_ONLY_BUDGET)
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
                msg = f"국가법령정보센터 응답이 늦어 법령을 불러오지 못했습니다({round(budget)}초 초과). 잠시 후 다시 시도해 주세요." if out[i] is None else f"국가법령정보센터 응답 지연({round(budget)}초 초과) — 공식 원문 스냅샷({DATASET_DATE} 수집)으로 표시했습니다. 잠시 후 다시 검색하면 실시간 원문으로 표시됩니다."
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

    def search_cases(self, query: str, limit: int = 5, budget: float = CASE_BUDGET) -> list[dict]:
        """판례·법령해석례: 사건명 검색 우선, 부족하면 본문 검색(search=2) 보완.
        판례·해석례를 병렬로, 전체 budget 초 안에서만 기다림(넘으면 생략 — 요청은 계속되어 캐시에 저장)."""
        if not self.oc or not query.strip():
            return []
        display = str(min(max(int(limit), 1), 20))
        oc = self.oc

        def name_search(target, kind):
            return parse_case_list(drf_get("lawSearch.do", {"target": target, "query": query, "display": display}, oc, 8, 1), kind)

        def text_search(target, kind):
            return parse_case_list(drf_get("lawSearch.do", {"target": target, "query": query, "display": display, "search": "2"}, oc, CASE_TIMEOUT, 1), kind)

        deadline = time.time() + budget
        names = {t: _POOL.submit(name_search, t, k) for t, k in (("prec", "판례"), ("expc", "법령해석례"))}
        result: dict[str, list[dict]] = {}
        slow = False
        for t, k in (("prec", "판례"), ("expc", "법령해석례")):
            try:
                result[t] = names[t].result(timeout=max(0.1, deadline - time.time()))
            except cf.TimeoutError:
                result[t], slow = [], True
            except LawApiError as e:
                result[t] = []
                if str(e) not in self.warnings:
                    self.warnings.append(str(e))
        need = [(t, k) for t, k in (("prec", "판례"), ("expc", "법령해석례")) if len(result[t]) < 2 and not self.warnings]
        if need and deadline - time.time() <= 1.5:
            slow, need = True, []  # 본문 검색을 시작할 시간이 부족 → 생략 안내
        texts = {t: _POOL.submit(text_search, t, k) for t, k in need}
        for t, f in texts.items():
            try:
                extra = f.result(timeout=max(0.1, deadline - time.time()))
                result[t] = (result[t] + [c for c in extra if not any(b["id"] == c["id"] for b in result[t])])[: int(display)]
            except cf.TimeoutError:
                slow = True
            except LawApiError as e:
                if str(e) not in self.warnings:
                    self.warnings.append(str(e))
        if slow:
            self.warnings.append("국가법령정보센터 본문 검색이 지연되어 일부 결과를 생략했습니다. 잠시 후 다시 검색하면 더 많은 판례가 표시됩니다.")
        return result["prec"] + result["expc"]

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
