"use client";
import * as React from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/ui/mic-button";
import { EXAMPLES } from "./roles";

const MAX = 2000;

export function AnalyzeForm({ initial, onSubmit, busy }: { initial: string; onSubmit: (s: string) => void; busy: boolean }) {
  const [text, setText] = React.useState(initial);
  React.useEffect(() => setText(initial), [initial]);
  const ok = text.trim().length >= 10;
  // 음성 입력은 이미 적은 글 뒤에 이어 붙임(말하는 동안 중간 결과로 갱신)
  const base = React.useRef<string | null>(null);
  const onVoice = (t: string, final: boolean) => {
    if (base.current === null) base.current = text.trim();
    setText(`${base.current ? `${base.current} ` : ""}${t}`.slice(0, MAX));
    if (final) base.current = null;
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(text.trim());
      }}
      className="rounded-2xl border-2 bg-card p-4 shadow-lg focus-within:border-accent sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="situation" className="flex items-center gap-2 text-sm font-bold">
          <Sparkles className="h-4 w-4 text-accent" /> 어떤 일이 있었는지 편하게 적어 주세요
        </label>
        <MicButton onText={onVoice} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">누가 · 언제 · 무엇을 · 얼마(금액) · 지금까지 한 조치를 함께 적으면 분석이 정확해져요. 개인정보는 적지 않는 게 좋고, 주민번호·전화번호 등은 자동으로 가려요. 오른쪽 마이크로 말해도 돼요.</p>
      <textarea
        id="situation"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        rows={6}
        placeholder="예) 전세 계약이 끝났는데 집주인이 보증금을 돌려주지 않고 연락이 안 돼요. 전입신고와 확정일자는 받아 두었어요."
        className="mt-3 w-full resize-y rounded-xl border bg-background p-4 text-base leading-7 placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">예시 상황:</span>
        {EXAMPLES.map((e) => (
          <button key={e.label} type="button" onClick={() => setText(e.text)} className="rounded-full border bg-secondary/60 px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent">
            {e.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {text.length.toLocaleString()} / {MAX.toLocaleString()}자
        </span>
        <Button type="submit" variant="accent" size="lg" disabled={!ok || busy} className="rounded-xl">
          <Wand2 /> {busy ? "분석 중…" : "법령 추천 · 3관점 분석"}
        </Button>
      </div>
    </form>
  );
}
