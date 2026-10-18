"use client";
import { motion } from "framer-motion";
import { useSettings } from "@/components/providers/settings-provider";

const CITIZEN_LINES = [
  ["어려운 법률을", "일상의 언어로 연결합니다."],
  ["궁금한 상황을 물어보면", "관련 법 조항과 판례,", "해야 할 일을", "차근차근 알려드려요."],
];
const OFFICER_LINES = [
  ["근거 조문·판례 검토부터", "우리 기관 규정 검증까지,"],
  ["검토 보고서·기안문과", "규정 제·개정 초안을", "한 곳에서 처리하세요."],
];

export function HeroHeading() {
  const { mode } = useSettings();
  const officer = mode === "officer";
  return (
    <motion.div key={mode} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <h1 className="text-balance text-3xl font-black leading-tight tracking-tight sm:text-5xl">
        <span className="inline-block">{officer ? "정확한 근거로," : "법은 가깝게,"}</span>{" "}
        <span className="inline-block bg-gradient-to-r from-navy-700 to-sage-600 bg-clip-text text-transparent">{officer ? "빠른 행정 판단" : "권리는 든든하게."}</span>
      </h1>
      {/* 말 묶음 단위로만 줄이 바뀌게 — 글자 크기(가·가+·가++)나 화면 폭이 바뀌어도 낱말이 어색하게 끊기지 않음 */}
      <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
        {(officer ? OFFICER_LINES : CITIZEN_LINES).map((line) => (
          <span key={line.join("")} className="block text-balance">
            {line.map((phrase, i) => (
              <span key={phrase}>
                {i > 0 && " "}
                <span className="inline-block">{phrase}</span>
              </span>
            ))}
          </span>
        ))}
      </p>
    </motion.div>
  );
}
