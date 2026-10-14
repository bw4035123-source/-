import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container py-24 text-center">
      <p className="text-5xl font-black text-accent">404</p>
      <h1 className="mt-3 text-xl font-bold">페이지를 찾을 수 없습니다</h1>
      <Link href="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        처음으로
      </Link>
    </div>
  );
}
