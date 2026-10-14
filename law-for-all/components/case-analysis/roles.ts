import { Briefcase, Gavel, Shield, type LucideIcon } from "lucide-react";
import type { RoleId } from "@/lib/answer/types";

export const ROLES: Record<RoleId, { name: string; tagline: string; icon: LucideIcon; ring: string; chip: string; head: string }> = {
  lawyer: {
    name: "변호사",
    tagline: "내 편에서 · 권리와 전략",
    icon: Briefcase,
    ring: "border-sky-200 dark:border-sky-800",
    chip: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
    head: "from-sky-600 to-indigo-600",
  },
  prosecutor: {
    name: "검사",
    tagline: "공익 관점 · 위법성과 처벌",
    icon: Shield,
    ring: "border-rose-200 dark:border-rose-900",
    chip: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
    head: "from-rose-600 to-red-700",
  },
  judge: {
    name: "판사",
    tagline: "중립 · 쟁점과 요건 판단",
    icon: Gavel,
    ring: "border-amber-200 dark:border-amber-800",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
    head: "from-amber-500 to-orange-600",
  },
};

export const EXAMPLES = [
  {
    label: "전세 보증금·연락 두절",
    text: "전세 2억 5천만원에 빌라에 살고 있는데 계약이 지난달 만료됐어요. 집주인이 보증금을 안 돌려주고 연락 두절이에요. 알고 보니 집이 경매에 넘어갔고 다른 세입자들도 피해자래요. 전입신고는 했고 확정일자도 받았어요.",
  },
  {
    label: "층간소음 갈등",
    text: "아파트 윗집에서 밤마다 쿵쿵 뛰는 소리와 큰 음악 소리가 나요. 관리사무소에 두 번 말했는데도 계속되고, 직접 올라가 얘기했더니 오히려 화를 냈어요. 어떻게 대응해야 하나요?",
  },
  {
    label: "퇴사 후 월급 미지급",
    text: "편의점에서 1년 6개월 일하다가 지난달 말에 퇴사했는데, 사장님이 마지막 달 월급 180만원과 퇴직금을 3주째 안 주고 있어요. 나중에 주겠다는 말만 하고 날짜도 안 정해 줬어요.",
  },
  {
    label: "갑작스러운 해고",
    text: "회사에서 3년 근무했는데 어제 팀장이 갑자기 내일부터 나오지 말라고 했어요. 해고 사유도 말로만 들었고 서면 통지나 예고는 없었어요.",
  },
  {
    label: "음주운전 단속",
    text: "회식에서 맥주 두 잔을 마시고 30분 뒤 운전하다 단속에 걸렸는데 혈중알코올농도 0.052%가 나왔어요. 면허는 어떻게 되고 처벌은 얼마나 받나요?",
  },
];
