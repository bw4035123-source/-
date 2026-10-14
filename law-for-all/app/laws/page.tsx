import type { Metadata } from "next";
import { Suspense } from "react";
import { LawsCatalog } from "@/components/officer-view/laws-catalog";

export const metadata: Metadata = { title: "법령 둘러보기" };

export default function LawsPage() {
  return (
    <Suspense>
      <LawsCatalog />
    </Suspense>
  );
}
