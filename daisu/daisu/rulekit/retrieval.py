"""하이브리드 규정 검색: BM25(단어) + 밀집 임베딩(BGE-m3) + 최신 시행일 우선 가중치.

점수 = recency_boost × [ α · dense(정규화) + (1-α) · bm25(정규화) ]
  · bm25 / dense 는 질의마다 0~1로 최소-최대 정규화해 섞는다(fusion="weighted").
    fusion="rrf" 면 순위 역수 합(Reciprocal Rank Fusion, k=60)을 쓴다.
  · recency_boost = 1 + recency_weight · 2^(-경과일/half_life_days)
    경과일 = (말뭉치에서 가장 최근 시행일 − 이 청크 시행일). 최신본은 1 + recency_weight 배.
  · latest_only=True 면 같은 조문(version_key)의 구판은 아예 빼고 최신 시행본만 남긴다.

임베딩
  · BGEM3Embeddings: BAAI/bge-m3 (FlagEmbedding 또는 sentence-transformers, 처음 한 번 모델 내려받기 필요)
  · HashingEmbeddings: 인터넷·GPU 없는 내부망용 대체(글자 n-gram 해싱, 모델 파일 불필요)
  · 그 밖에 langchain_core.embeddings.Embeddings 를 따르는 어떤 임베딩이든 넣을 수 있다.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import math
import re
from collections import defaultdict

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict, Field, PrivateAttr
from rank_bm25 import BM25Okapi

JOSA = re.compile(r"(은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만|까지|부터|에게|하여|한다|하는|된다|되는)$")


def tokenize(text: str) -> list[str]:
    """한국어용 가벼운 토큰화: 단어(조사 떼기) + 한글 2글자 묶음(형태소 분석기 없이도 '교육시간'↔'교육 시간' 매칭)."""
    toks = []
    for w in re.findall(r"[가-힣]+|[A-Za-z]+|\d+(?:\.\d+)?", text):
        w2 = JOSA.sub("", w) if len(w) > 2 else w
        toks.append(w2.lower())
        if re.fullmatch(r"[가-힣]{3,}", w2):
            toks += [w2[i:i + 2] for i in range(len(w2) - 1)]
    return toks


class HashingEmbeddings(Embeddings):
    """모델 없이 동작하는 결정적 임베딩(글자 1~3-gram 해싱 + L2 정규화). 내부망 대체용·시험용."""

    def __init__(self, dim: int = 512):
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        s = re.sub(r"\s+", " ", text)
        for n in (1, 2, 3):
            for i in range(len(s) - n + 1):
                g = s[i:i + n]
                if g.strip():
                    h = int(hashlib.md5(g.encode()).hexdigest()[:8], 16)
                    v[h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


class BGEM3Embeddings(Embeddings):
    """BAAI/bge-m3 밀집 벡터. FlagEmbedding 이 있으면 그것을, 없으면 sentence-transformers 를 쓴다.

    pip install FlagEmbedding   (또는  pip install sentence-transformers)
    모델은 처음 한 번 내려받는다(약 2.3GB). 내부망이면 model_path 에 미리 받아 둔 폴더를 넣는다.
    """

    def __init__(self, model_path: str = "BAAI/bge-m3", use_fp16: bool = True, batch_size: int = 16):
        self.model_path, self.use_fp16, self.batch_size = model_path, use_fp16, batch_size
        self._m = None
        self._kind = ""

    def _model(self):
        if self._m is None:
            try:
                from FlagEmbedding import BGEM3FlagModel
                self._m, self._kind = BGEM3FlagModel(self.model_path, use_fp16=self.use_fp16), "flag"
            except ImportError:
                from sentence_transformers import SentenceTransformer
                self._m, self._kind = SentenceTransformer(self.model_path), "st"
        return self._m

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        m = self._model()
        if self._kind == "flag":
            return [list(map(float, v)) for v in m.encode(texts, batch_size=self.batch_size)["dense_vecs"]]
        return [list(map(float, v)) for v in m.encode(texts, batch_size=self.batch_size, normalize_embeddings=True)]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


def _cos(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def _minmax(xs: list[float]) -> list[float]:
    lo, hi = min(xs, default=0.0), max(xs, default=0.0)
    return [0.0 if hi == lo else (x - lo) / (hi - lo) for x in xs]


def _date(d) -> dt.date | None:
    if isinstance(d, dt.date):
        return d
    try:
        return dt.date.fromisoformat(d) if d else None
    except ValueError:
        return None


class HybridRegulationRetriever(BaseRetriever):
    """LangChain Retriever. `retriever.invoke("자기개발학습 인정 한도")` → Document 목록(metadata 에 점수 내역)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    documents: list[Document]
    embeddings: Embeddings = Field(default_factory=HashingEmbeddings)
    k: int = 5
    alpha: float = Field(default=0.5, ge=0, le=1, description="밀집 임베딩 비중(0=BM25만, 1=임베딩만)")
    fusion: str = Field(default="weighted", pattern="^(weighted|rrf)$")
    recency_weight: float = Field(default=0.3, ge=0)
    half_life_days: float = Field(default=365.0, gt=0)
    latest_only: bool = False

    _bm25: BM25Okapi = PrivateAttr()
    _vecs: list[list[float]] = PrivateAttr()
    _newest: dt.date | None = PrivateAttr(default=None)
    _latest_of: dict = PrivateAttr(default_factory=dict)

    def model_post_init(self, __context) -> None:
        if not self.documents:
            raise ValueError("검색할 문서가 없습니다.")
        self._bm25 = BM25Okapi([tokenize(d.page_content) for d in self.documents])
        self._vecs = self.embeddings.embed_documents([d.page_content for d in self.documents])
        dates = [_date(d.metadata.get("effective_date")) for d in self.documents]
        self._newest = max((x for x in dates if x), default=None)
        latest: dict = defaultdict(lambda: None)
        for d, x in zip(self.documents, dates):
            key = d.metadata.get("version_key")
            if key and x and (latest[key] is None or x > latest[key]):
                latest[key] = x
        self._latest_of = dict(latest)

    def recency_boost(self, doc: Document) -> float:
        d = _date(doc.metadata.get("effective_date"))
        if not d or not self._newest:
            return 1.0
        age = max(0, (self._newest - d).days)
        return 1.0 + self.recency_weight * 2 ** (-age / self.half_life_days)

    def is_superseded(self, doc: Document) -> bool:
        d, key = _date(doc.metadata.get("effective_date")), doc.metadata.get("version_key")
        latest = self._latest_of.get(key)
        return bool(d and latest and d < latest)

    def scores(self, query: str) -> list[dict]:
        bm = list(self._bm25.get_scores(tokenize(query)))
        qv = self.embeddings.embed_query(query)
        dn = [_cos(qv, v) for v in self._vecs]
        if self.fusion == "rrf":
            rank_b = {i: r for r, i in enumerate(sorted(range(len(bm)), key=lambda i: -bm[i]), 1)}
            rank_d = {i: r for r, i in enumerate(sorted(range(len(dn)), key=lambda i: -dn[i]), 1)}
            base = [(1 - self.alpha) / (60 + rank_b[i]) + self.alpha / (60 + rank_d[i]) for i in range(len(bm))]
        else:
            nb, nd = _minmax(bm), _minmax(dn)
            base = [self.alpha * nd[i] + (1 - self.alpha) * nb[i] for i in range(len(bm))]
        out = []
        for i, d in enumerate(self.documents):
            boost = self.recency_boost(d)
            out.append({"index": i, "bm25": bm[i], "dense": dn[i], "base": base[i], "recency_boost": boost,
                        "score": base[i] * boost, "superseded": self.is_superseded(d)})
        return out

    def _get_relevant_documents(self, query: str, *, run_manager: CallbackManagerForRetrieverRun | None = None) -> list[Document]:
        ranked = sorted(self.scores(query), key=lambda s: -s["score"])
        if self.latest_only:
            ranked = [s for s in ranked if not s["superseded"]]
        out = []
        for s in ranked[: self.k]:
            d = self.documents[s["index"]]
            out.append(Document(page_content=d.page_content, metadata={**d.metadata, "score": round(s["score"], 6),
                                "bm25": round(s["bm25"], 6), "dense": round(s["dense"], 6),
                                "recency_boost": round(s["recency_boost"], 6), "superseded": s["superseded"]}))
        return out
