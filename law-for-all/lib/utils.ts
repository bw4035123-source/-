import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** YYYYMMDD → YYYY. M. D. */
export function formatLawDate(raw?: string): string {
  if (!raw) return "";
  const m = raw.replace(/\D/g, "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return raw;
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
}
