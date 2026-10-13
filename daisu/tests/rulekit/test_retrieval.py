"""구조화 청크·하이브리드 검색 테스트(밀집 임베딩은 모델 없는 HashingEmbeddings 로 대체)."""
from __future__ import annotations

from pathlib import Path

import pytest

from daisu.rulekit.chunking import find_effective_date, split_regulation
from daisu.rulekit.retrieval import HashingEmbeddings, HybridRegulationRetriever, tokenize

FIX = Path(__file__).parent / "fixtures"
LAW = "[예시] 교육훈련 운영 지침"


@pytest.fixture(scope="module")
def docs():
    v1 = split_regulation((FIX / "example_guideline_v1.txt").read_text(encoding="utf-8"), LAW)
    v2 = split_regulation((FIX / "example_guideline_v2.txt").read_text(encoding="utf-8"), LAW)
    return v1 + v2


def test_chunks_have_structure(docs):
    a7 = [d for d in docs if d.metadata["article"] == "제7조"]
    assert {d.metadata["effective_date"] for d in a7} == {"2024-01-01", "2026-01-01"}
    assert all(d.metadata["version_key"] == f"{LAW}|제7조" for d in a7)
    assert all(d.page_content.startswith("제7조") for d in a7)
    assert len({d.metadata["chunk_id"] for d in docs}) == len(docs)


def test_long_article_split_on_paragraphs():
    body = "제12조(긴 조문)\n" + "\n".join(f"{c} " + "가나다라마바사 " * 30 for c in "①②③④")
    ds = split_regulation(body, LAW, chunk_size=300, chunk_overlap=0)
    assert len(ds) > 1 and all(d.metadata["article"] == "제12조" for d in ds)
    assert all(d.page_content.startswith("제12조") for d in ds)  # 잘린 조각에도 조문 머리


def test_effective_date():
    assert str(find_effective_date("지침\n시행 2026. 1. 1.\n")) == "2026-01-01"


def test_tokenize_korean():
    t = tokenize("자기개발학습은 연간 20시간")
    assert "자기개발학습" in t and "개발" in t and "20" in t


def test_hybrid_prefers_latest_version(docs):
    r = HybridRegulationRetriever(documents=docs, k=3)
    top = r.invoke("자기개발학습 인정 한도")
    assert top[0].metadata["article"] == "제7조" and top[0].metadata["effective_date"] == "2026-01-01"
    assert top[0].metadata["recency_boost"] > top[1].metadata["recency_boost"] or top[1].metadata["article"] != "제7조"


def test_latest_only_drops_superseded(docs):
    r = HybridRegulationRetriever(documents=docs, k=10, latest_only=True)
    got = r.invoke("기본교육 인정")
    assert all(not d.metadata["superseded"] for d in got)
    assert all(d.metadata["effective_date"] == "2026-01-01" for d in got if d.metadata["article"] in ("제5조", "제7조"))


def test_recency_weight_zero_is_neutral(docs):
    r = HybridRegulationRetriever(documents=docs, k=10, recency_weight=0)
    assert all(d.metadata["recency_boost"] == 1.0 for d in r.invoke("기본교육"))


@pytest.mark.parametrize("fusion", ["weighted", "rrf"])
def test_fusions_find_bonus_article(docs, fusion):
    r = HybridRegulationRetriever(documents=docs, k=1, fusion=fusion, embeddings=HashingEmbeddings(dim=256))
    assert r.invoke("가점은 몇 점까지")[0].metadata["article"] == "제9조"


def test_bm25_only_and_dense_only(docs):
    for a in (0.0, 1.0):
        r = HybridRegulationRetriever(documents=docs, k=1, alpha=a)
        assert r.invoke("시설직렬 전문교육")[0].metadata["article"] == "제6조"


def test_empty_corpus_rejected():
    with pytest.raises(ValueError):
        HybridRegulationRetriever(documents=[])
