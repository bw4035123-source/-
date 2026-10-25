"use client";
import * as React from "react";
import { Mic, MicOff } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** 브라우저 음성 인식(Web Speech API) 최소 타입 — 표준 타입 정의에 없어 직접 선언 */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "마이크 사용을 허용해 주세요(주소창 왼쪽 자물쇠 → 마이크 허용)",
  "service-not-allowed": "이 브라우저에서는 음성 인식을 쓸 수 없어요",
  "no-speech": "말씀이 들리지 않았어요. 다시 눌러 말씀해 주세요",
  "audio-capture": "마이크를 찾지 못했어요",
  network: "음성 인식 서버에 연결하지 못했어요",
};

/**
 * 음성으로 질문하기 — 글 쓰기가 어려운 분(어르신·시각장애인 등)이 말로 물을 수 있게.
 * 브라우저가 음성 인식을 지원할 때만 보이고, 인식된 글은 입력창에 채워져 사용자가 확인 후 보낸다(개인정보는 보낼 때 자동 가림).
 * onText(글, 확정 여부): 말하는 동안 중간 결과도 전달.
 */
export function MicButton({ onText, className, size = "md" }: { onText: (text: string, final: boolean) => void; className?: string; size?: "md" | "lg" }) {
  const toast = useToast();
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const rec = React.useRef<Recognition | null>(null);
  React.useEffect(() => setSupported(!!getCtor()), []);
  React.useEffect(() => () => rec.current?.stop(), []);
  if (!supported) return null;

  const toggle = () => {
    if (listening) return rec.current?.stop();
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ko-KR";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const parts = Array.from(e.results);
      const text = parts.map((x) => x[0].transcript).join("").trim();
      onText(text, parts.every((x) => x.isFinal));
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") toast(ERRORS[e.error] ?? "음성 인식 중 문제가 생겼어요");
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "듣는 중 — 누르면 멈춤" : "음성으로 질문하기"}
      title={listening ? "듣는 중이에요. 말씀을 마치면 자동으로 멈춰요" : "음성으로 질문하기(브라우저 음성 인식 사용)"}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "lg" ? "h-11 w-11" : "h-9 w-9",
        listening ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950/40" : "bg-card text-accent hover:border-accent",
        className,
      )}
    >
      {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red-400/30" />}
      {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  );
}
