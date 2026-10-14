import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";
import { getMockLaw } from "@/lib/law-api/mock";
import { LawDocument } from "@/components/officer-view/law-document";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { title: getMockLaw(params.id)?.name ?? "법령 본문" };
}

export default async function LawPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  if (!/^[a-z0-9-]{2,60}$/.test(id)) notFound();
  const svc = new LawService(serverConfig.lawApiOc);
  const h = await svc.getHierarchy(id);
  if (!h) notFound();
  return (
    <div className="container py-8">
      <LawDocument root={h.root} lawsChildren={h.children} initialLawId={id} warnings={svc.warnings} />
    </div>
  );
}
