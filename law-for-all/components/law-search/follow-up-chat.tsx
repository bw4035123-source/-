"use client";
import * as React from "react";
import { Loader2, MessagesSquare, SendHorizonal, ShieldCheck, UserRound } from "lucide-react";
import type { FollowUpResult } from "@/lib/answer/followup";
import { FOLLOWUP_SUGGESTIONS } from "@/lib/answer/followup-suggestions";
import { useSettings } from "@/components/providers/settings-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fetchJson } from "@/lib/fetch-json";
import { maskPII } from "@/lib/privacy-mask";
import { MicButton } from "@/components/ui/mic-button";
import { VoiceAutoNotice, useVoiceAutoSubmit } from "@/components/ui/voice-auto";
import { CitationProvider } from "./citation-context";
import { CitedText } from "./cited-text";

type Msg = { role: "user"; text: string } | { role: "bot"; result: FollowUpResult } | { role: "error"; text: string };

const MAX_TURNS = 10;

/** 이어서 묻기 — 검색 결과 아래에서 같은 사안을 더 묻는다. 답은 근거 조문 번호와 인용 검증을 거친다 */
export function FollowUpChat({ prevQuery }: { prevQuery: string }) {
  const { mode, provider } = useSettings();
  const toast = useToast();
  const officer = mode === "officer";
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLLIElement>(null);

  const lastBot = [...msgs].reverse().find((m): m is Extract<Msg, { role: "bot" }> => m.role === "bot");
  const asked = new Set(msgs.flatMap((m) => (m.role === "user" ? [m.text] : [])));
  const suggestions = (lastBot?.result.suggestions ?? FOLLOWUP_SUGGESTIONS[mode].slice(0, 4)).filter((s) => !asked.has(s));
  const turns = msgs.filter((m) => m.role === "user").length;

  React.useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs]);

  const send = async (raw: string) => {
    // 개인정보는 서버로 보내기 전에 브라우저에서 가림(가린 내용으로 대화에 표시)
    const { text: question, found } = maskPII(raw.trim());
    if (question.length < 2 || busy || turns >= MAX_TURNS) return;
    if (found.length) toast(`개인정보 보호를 위해 ${found.join("·")}를 가리고 보냈어요`);
    setText("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: question }]);
    try {
      const result = await fetchJson<FollowUpResult>("/api/followup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, prevQuery, mode, provider: provider || undefined }),
      });
      setMsgs((m) => [...m, { role: "bot", result }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", text: (e as Error).message || "답변을 가져오지 못했습니다." }]);
    } finally {
      setBusy(false);
    }
  };

  // 음성으로 물으면 말이 끝나고 잠시 뒤 자동으로 보냄(그 사이 취소·수정 가능)
  const voice = useVoiceAutoSubmit((t) => void send(t), (t) => setText(t.slice(0, 300)));

  return (
    <section aria-labelledby="followup-h" className="no-print rounded-2xl border-2 border-accent/25 bg-card p-4 shadow-sm sm:p-5">
      <h2 id="followup-h" className="flex items-center gap-2 text-lg font-extrabold">
        <MessagesSquare className="h-5 w-5 text-accent" /> {officer ? "이어서 검토하기" : "궁금한 점, 이어서 물어보세요"}
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        이 사안(‘{prevQuery.length > 30 ? `${prevQuery.slice(0, 30)}…` : prevQuery}’)을 이어서 답해요. 답변도 근거 조문 번호가 붙고 같은 인용 검증을 거쳐요.
      </p>

      {msgs.length > 0 && (
        <ol className="mt-4 space-y-3" aria-live="polite">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <li key={i} className="flex justify-end">
                <p className="flex max-w-[85%] items-start gap-1.5 rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2 text-sm font-semibold text-accent-foreground">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  {m.text}
                </p>
              </li>
            ) : m.role === "error" ? (
              <li key={i} role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-sm text-destructive">
                {m.text}
              </li>
            ) : (
              <li key={i}>
                <CitationProvider citations={m.result.citations}>
                  <div className="rounded-2xl rounded-tl-sm border bg-secondary/40 px-4 py-3 text-[0.95rem] leading-7">
                    {m.result.answer.split("\n").map((line, li) => (
                      <p key={li} className={li === 0 ? "font-semibold" : "mt-1"}>
                        <CitedText text={line} />
                      </p>
                    ))}
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
                      {m.result.provider.label} · {m.result.citations.length ? `근거 조문 ${m.result.citations.length}건 · 번호를 누르면 원문` : "조문 인용 없는 안내"}
                      {m.result.guard.removedCitations.length > 0 && ` · 근거 밖 인용 ${m.result.guard.removedCitations.length}건 제거`}
                    </p>
                  </div>
                </CitationProvider>
              </li>
            ),
          )}
          {busy && (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 근거 조문을 찾는 중…
            </li>
          )}
          <li ref={endRef} aria-hidden />
        </ol>
      )}

      {suggestions.length > 0 && turns < MAX_TURNS && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void send(s)}
              className="rounded-full border bg-secondary/60 px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          voice.cancel();
          void send(text);
        }}
      >
        <label htmlFor="followup-input" className="sr-only">
          이어서 물어볼 내용
        </label>
        <input
          id="followup-input"
          value={text}
          onChange={(e) => {
            voice.cancel();
            setText(e.target.value.slice(0, 300));
          }}
          disabled={turns >= MAX_TURNS}
          placeholder={turns >= MAX_TURNS ? "새 질문은 위 검색창을 이용해 주세요" : officer ? "예) 시행령상 기준은? 위반 시 제재는?" : "예) 기한이 있나요? 어디에 신고하나요?"}
          className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {turns < MAX_TURNS && <MicButton size="lg" onText={voice.onVoice} />}
        <Button type="submit" variant="accent" className="h-11 shrink-0" disabled={busy || text.trim().length < 2 || turns >= MAX_TURNS} aria-label="이어서 묻기 보내기">
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizonal />} 묻기
        </Button>
      </form>
      <VoiceAutoNotice pending={voice.pending} onCancel={voice.cancel} action="보내요" />
    </section>
  );
}
