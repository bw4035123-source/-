"use client";
import * as React from "react";
import { Mic, X } from "lucide-react";

/** 말이 끝난 뒤 자동으로 보내기까지 기다리는 시간 — 잘못 알아들었으면 이 사이에 취소하거나 고칠 수 있게 */
export const VOICE_AUTO_MS = 1500;

/**
 * 음성으로 질문하면 자동으로 검색 — 말이 끝나면(확정 결과) 인식된 글을 입력칸에 보여 주고 잠시 뒤 보낸다.
 * 취소 단추를 누르거나 입력칸을 직접 고치기 시작하면(cancel) 보내지 않는다. 개인정보 가림은 보낼 때(submit) 그대로 적용.
 */
export function useVoiceAutoSubmit(submit: (text: string) => void, setText: (text: string) => void) {
  const [pending, setPending] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
  }, []);
  React.useEffect(() => cancel, [cancel]);

  const onVoice = React.useCallback(
    (text: string, final: boolean) => {
      cancel();
      setText(text);
      if (!final || text.trim().length < 2) return;
      setPending(text);
      timer.current = setTimeout(() => {
        timer.current = null;
        setPending(null);
        submitRef.current(text);
      }, VOICE_AUTO_MS);
    },
    [cancel, setText],
  );

  return { pending, onVoice, cancel };
}

/** 자동 검색 대기 안내 — 화면낭독기에도 읽히고, 취소 단추와 남은 시간 막대를 보여 준다 */
export function VoiceAutoNotice({ pending, onCancel, action = "검색해요" }: { pending: string | null; onCancel: () => void; action?: string }) {
  return (
    <div aria-live="assertive" className="empty:hidden">
      {pending && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-left text-sm">
          <Mic className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">‘{pending.length > 40 ? `${pending.slice(0, 40)}…` : pending}’</span> 곧 {action}
            <span className="relative mt-1 block h-1 overflow-hidden rounded-full bg-accent/15" aria-hidden>
              <span key={pending} className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-accent" style={{ animation: `voice-auto ${VOICE_AUTO_MS}ms linear forwards` }} />
            </span>
          </p>
          <button type="button" onClick={onCancel} className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-card px-2.5 py-1 text-xs font-bold hover:border-accent hover:text-accent">
            <X className="h-3.5 w-3.5" aria-hidden /> 취소
          </button>
          <style>{"@keyframes voice-auto{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}</style>
        </div>
      )}
    </div>
  );
}
