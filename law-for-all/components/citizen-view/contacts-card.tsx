import { ExternalLink, Phone } from "lucide-react";
import type { Contact } from "@/lib/law-api/mock/topics";

/** 관련 기관 연락처 안내(검증된 고정 데이터 — LLM이 생성하지 않음) */
export function ContactsCard({ contacts }: { contacts: Contact[] }) {
  if (!contacts.length) return null;
  return (
    <section aria-labelledby="contacts-h" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="contacts-h" className="mb-3 flex items-center gap-2 text-base font-extrabold">
        <Phone className="h-5 w-5 text-accent" /> 도움받을 수 있는 곳
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {contacts.map((c) => (
          <li key={c.name} className="rounded-xl bg-secondary/70 p-3.5">
            <p className="font-bold">{c.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{c.desc}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm font-semibold">
              {c.phone && (
                <a href={`tel:${c.phone.replace(/-/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-accent-foreground">
                  <Phone className="h-3.5 w-3.5" /> {c.phone}
                </a>
              )}
              {c.url && (
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 hover:border-accent hover:text-accent">
                  <ExternalLink className="h-3.5 w-3.5" /> 바로가기
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
