"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container py-24 text-center" role="alert">
      <h1 className="text-xl font-bold">일시적인 오류가 발생했습니다</h1>
      <button onClick={reset} className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        다시 시도
      </button>
    </div>
  );
}
