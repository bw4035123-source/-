"use client";
import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { LawDoc } from "@/lib/law-api/types";
import { LawDocument } from "./law-document";

type Data = { root: LawDoc; children: LawDoc[]; warnings: string[] };

/** 법령 본문 페이지 — 실제 주소(/laws/<id>)에서 id를 읽어 /api/laws/<id> 조회 */
export function LawPageClient() {
  const [state, setState] = React.useState<{ id: string; data?: Data; error?: string } | null>(null);
  React.useEffect(() => {
    const id = decodeURIComponent(window.location.pathname.replace(/\/$/, "").split("/").pop() ?? "").replace(/\.html$/, "");
    fetch(`/api/laws/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "법령을 찾을 수 없습니다.");
        setState({ id, data: j });
        document.title = `${j.root.id === id ? j.root.name : j.children.find((c: LawDoc) => c.id === id)?.name ?? j.root.name} · 법이음`;
      })
      .catch((e) => setState({ id, error: (e as Error).message }));
  }, []);

  if (!state)
    return (
      <p className="container flex items-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> 법령을 불러오는 중…
      </p>
    );
  if (state.error || !state.data)
    return (
      <div className="container py-20 text-center">
        <p className="font-bold">{state.error}</p>
        <Link href="/laws" className="mt-4 inline-block text-accent underline">
          법령 목록으로
        </Link>
      </div>
    );
  return (
    <div className="container py-8">
      <LawDocument root={state.data.root} lawsChildren={state.data.children} initialLawId={state.id} warnings={state.data.warnings ?? []} />
    </div>
  );
}
