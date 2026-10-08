"""가벼운 BM25 검색(한국어: 어절 + 글자 2-gram). 임베딩 모델 없이 동작해 모델 교체와 무관하다."""
from __future__ import annotations

import math
import re
from collections import Counter

from .extract import _JOSA


def tokens(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[가-힣]+|[A-Za-z]+|\d+", text.lower()):
        if re.match(r"[가-힣]", w):
            w = _JOSA.sub("", w) or w
            out.append(w)
            out += [w[i:i + 2] for i in range(len(w) - 1)]
        else:
            out.append(w)
    return out


class Index:
    def __init__(self, docs: list[tuple[str, str]], k1: float = 1.4, b: float = 0.75):
        self.ids = [i for i, _ in docs]
        self.tfs = [Counter(tokens(t)) for _, t in docs]
        self.lens = [sum(tf.values()) for tf in self.tfs]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1
        df = Counter()
        for tf in self.tfs:
            df.update(tf.keys())
        n = len(docs)
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}
        self.k1, self.b = k1, b

    def search(self, query: str, k: int = 6, min_score: float = 0.5) -> list[tuple[str, float]]:
        q = Counter(tokens(query))
        scores = []
        for i, tf in enumerate(self.tfs):
            s = 0.0
            for t in q:
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg))
            if s >= min_score:
                scores.append((self.ids[i], s))
        scores.sort(key=lambda x: -x[1])
        return scores[:k]
