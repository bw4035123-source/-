import type { Citation } from "./law-api/types";
import { articleLabel } from "./law-api/util";

/**
 * 국민 모드 서류 초안 — 상황(토픽)에 맞는 진정서·내용증명·신청서 서식.
 * 사실관계는 사용자가 입력하고, 법적 근거는 답변의 근거 조문(원문이 확인된 조문)만 인용한다.
 * 입력값은 브라우저 안에서만 쓰며 저장·전송하지 않는다.
 */
export interface FormField {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  half?: boolean;
}

export interface CitizenForm {
  topicId: string;
  title: string;
  desc: string;
  /** 제출처 안내(화면 표시) */
  submitTo: string;
  /** 서식에 인용하는 근거 조문 키 — 토픽 근거에 있는 조문만 */
  refs: string[];
  fields: FormField[];
  build: (v: Record<string, string>, cite: (key: string) => string, today: string) => string;
}

const BLANK = "○○○";
const val = (v: Record<string, string>, k: string, d = BLANK) => (v[k] ?? "").trim() || d;
const won = (s: string) => {
  const n = Number(s.replace(/[^\d]/g, ""));
  return s.trim() && Number.isFinite(n) && n > 0 ? `${n.toLocaleString("ko-KR")}원` : BLANK + "원";
};

const PERSON: FormField[] = [
  { id: "name", label: "성명", placeholder: "홍길동", half: true },
  { id: "phone", label: "연락처", placeholder: "010-0000-0000", half: true },
  { id: "addr", label: "주소", placeholder: "○○시 ○○구 ○○로 00" },
];

export const CITIZEN_FORMS: CitizenForm[] = [
  {
    topicId: "unpaid-wages",
    title: "임금체불 진정서",
    desc: "고용노동부(지방고용노동청)에 밀린 임금·퇴직금 지급을 요청하는 진정서예요.",
    submitTo: "관할 지방고용노동청(지청) 방문·우편 또는 노동포털(labor.moel.go.kr) 온라인 진정",
    refs: ["labor-standards:36", "labor-standards:107"],
    fields: [
      ...PERSON,
      { id: "company", label: "사업장 이름", placeholder: "○○편의점 ○○점", half: true },
      { id: "boss", label: "대표자(사장) 이름", placeholder: "김○○", half: true },
      { id: "companyAddr", label: "사업장 주소" },
      { id: "start", label: "입사일", placeholder: "2024. 3. 2.", half: true },
      { id: "end", label: "퇴직일", placeholder: "2025. 8. 31.", half: true },
      { id: "job", label: "담당 업무", placeholder: "매장 판매·재고 관리", half: true },
      { id: "wage", label: "못 받은 임금(원)", placeholder: "1800000", half: true },
      { id: "severance", label: "못 받은 퇴직금(원, 없으면 비움)", placeholder: "2100000", half: true },
      { id: "detail", label: "구체적인 사정", placeholder: "퇴직 후 여러 차례 지급을 요청했으나 '나중에 주겠다'는 말만 하고 날짜를 정해 주지 않음", multiline: true },
    ],
    build: (v, cite, today) =>
      [
        "진 정 서",
        "",
        "1. 진정인",
        `   성명: ${val(v, "name")}    연락처: ${val(v, "phone")}`,
        `   주소: ${val(v, "addr")}`,
        "2. 피진정인(사업주)",
        `   사업장: ${val(v, "company")}    대표자: ${val(v, "boss")}`,
        `   주소: ${val(v, "companyAddr")}`,
        "",
        "3. 진정 취지",
        `   피진정인은 진정인에게 체불 임금 ${won(v.wage ?? "")}${(v.severance ?? "").trim() ? `과 퇴직금 ${won(v.severance)}` : ""}을 지급하라.`,
        "",
        "4. 진정 내용",
        `   가. 진정인은 ${val(v, "start")}부터 ${val(v, "end")}까지 피진정인 사업장에서 ${val(v, "job")} 업무를 하였습니다.`,
        `   나. 진정인은 ${val(v, "end")} 퇴직하였으나, 피진정인은 지급 사유가 발생한 때부터 14일이 지나도록 위 금품을 지급하지 않고 있습니다.`,
        `   다. ${val(v, "detail", "퇴직 후 지급을 요청하였으나 지급되지 않았습니다.")}`,
        "",
        "5. 법적 근거",
        `   ${cite("labor-standards:36")} — 사용자는 근로자가 퇴직한 경우 지급 사유가 발생한 때부터 14일 이내에 임금 등 모든 금품을 지급하여야 합니다(당사자 합의로만 기일 연장 가능).`,
        `   ${cite("labor-standards:107")} — 위 규정을 위반한 자에 대한 벌칙.`,
        "",
        "6. 첨부(가지고 있는 자료)",
        "   근로계약서, 급여명세서, 통장 입금 내역, 출퇴근 기록·근무표, 문자·메신저 대화 등",
        "",
        `${today}`,
        `진정인 ${val(v, "name")} (서명 또는 인)`,
        "",
        "○○지방고용노동청(지청)장 귀하",
      ].join("\n"),
  },
  {
    topicId: "deposit-return",
    title: "내용증명 — 임대차보증금 반환 청구",
    desc: "계약이 끝났는데 보증금을 돌려받지 못할 때 집주인에게 보내는 내용증명이에요(우체국 내용증명 우편).",
    submitTo: "우체국 방문 또는 인터넷우체국(epost.go.kr) 내용증명 — 같은 내용 3부(본인·상대방·우체국 보관)",
    refs: ["housing-lease:4", "housing-lease:3의3", "housing-lease:3"],
    fields: [
      { id: "name", label: "발신인(임차인) 성명", placeholder: "홍길동", half: true },
      { id: "phone", label: "연락처", placeholder: "010-0000-0000", half: true },
      { id: "addr", label: "발신인 주소" },
      { id: "landlord", label: "수신인(임대인) 성명", placeholder: "김○○", half: true },
      { id: "landlordAddr", label: "수신인 주소", half: true },
      { id: "house", label: "임차 주택 주소", placeholder: "○○시 ○○구 ○○로 00, 000호" },
      { id: "contract", label: "계약일", placeholder: "2023. 9. 1.", half: true },
      { id: "expire", label: "계약 끝난 날", placeholder: "2025. 8. 31.", half: true },
      { id: "deposit", label: "보증금(원)", placeholder: "250000000", half: true },
      { id: "due", label: "반환 요청 기한", placeholder: "2025. 10. 31.", half: true },
      { id: "account", label: "받을 계좌(은행·번호·예금주)", placeholder: "○○은행 000-0000-0000 홍길동" },
    ],
    build: (v, cite, today) =>
      [
        "내 용 증 명",
        "",
        `발신인: ${val(v, "name")} (주소: ${val(v, "addr")}, 연락처: ${val(v, "phone")})`,
        `수신인: ${val(v, "landlord")} (주소: ${val(v, "landlordAddr")})`,
        "",
        "제목: 임대차보증금 반환 청구",
        "",
        `1. 발신인은 수신인과 ${val(v, "contract")} 위 주택(${val(v, "house")})에 관하여 보증금 ${won(v.deposit ?? "")}의 임대차계약을 체결하고 거주하였습니다.`,
        `2. 위 임대차계약은 ${val(v, "expire")} 기간이 끝났으나, 수신인은 현재까지 보증금을 반환하지 않고 있습니다.`,
        `3. ${cite("housing-lease:4")}에 따라 임대차기간이 끝난 경우에도 임차인이 보증금을 반환받을 때까지는 임대차관계가 존속하는 것으로 봅니다.`,
        `4. 이에 발신인은 수신인에게 ${val(v, "due")}까지 보증금 ${won(v.deposit ?? "")}을 아래 계좌로 반환하여 줄 것을 청구합니다.`,
        `   입금 계좌: ${val(v, "account")}`,
        `5. 위 기한까지 반환하지 않으면 발신인은 ${cite("housing-lease:3의3")}에 따른 임차권등기명령 신청, 보증금반환청구소송 등 법적 절차를 진행할 예정이며, 이로 인한 비용과 지연손해금도 청구할 수 있음을 알려 드립니다.`,
        `6. 참고: 발신인은 주택 인도와 주민등록(전입신고)을 마쳐 ${cite("housing-lease:3")}에 따른 대항력을 갖추고 있습니다.`,
        "",
        `${today}`,
        `발신인 ${val(v, "name")} (서명 또는 인)`,
      ].join("\n"),
  },
  {
    topicId: "floor-noise",
    title: "층간소음 피해 기록 및 조치 요청서",
    desc: "관리사무소(관리주체)에 층간소음 사실을 알리고 조사·조치를 요청하는 서식이에요. 피해 기록표를 함께 적어 두면 이후 조정에 도움이 돼요.",
    submitTo: "아파트 관리사무소(관리주체) — 해결되지 않으면 층간소음관리위원회 조정 신청, 이웃사이센터(1661-2642) 상담",
    refs: ["apartment-mgmt:20", "floor-noise-rule:3"],
    fields: [
      { id: "name", label: "신청인 성명", placeholder: "홍길동", half: true },
      { id: "phone", label: "연락처", placeholder: "010-0000-0000", half: true },
      { id: "apt", label: "아파트·동·호수(신청인)", placeholder: "○○아파트 101동 1203호", half: true },
      { id: "source", label: "소음 발생 세대(추정)", placeholder: "101동 1303호", half: true },
      { id: "kind", label: "소음 종류", placeholder: "뛰는 소리(직접충격), 음향기기 소리", half: true },
      { id: "time", label: "주로 발생하는 시간대", placeholder: "밤 10시 ~ 새벽 1시", half: true },
      { id: "log", label: "피해 기록(날짜·시간·내용)", placeholder: "2025. 9. 3. 23:10~23:50 쿵쿵 뛰는 소리\n2025. 9. 5. 22:40~00:20 음악 소리", multiline: true },
    ],
    build: (v, cite, today) =>
      [
        "층간소음 피해 사실 기록 및 조치 요청서",
        "",
        `신청인: ${val(v, "name")} (${val(v, "apt")}, 연락처 ${val(v, "phone")})`,
        `소음 발생 세대(추정): ${val(v, "source")}`,
        `소음 종류: ${val(v, "kind")}    주로 발생하는 시간대: ${val(v, "time")}`,
        "",
        "1. 요청 취지",
        `   위 세대에서 발생하는 층간소음으로 생활에 피해를 입고 있어, ${cite("apartment-mgmt:20")}에 따라 관리주체께서 소음 발생 사실을 조사하고 소음 차단 조치를 권고하여 주실 것을 요청합니다.`,
        "",
        "2. 피해 기록",
        ...val(v, "log", "(날짜·시간·소음 내용을 적어 주세요)").split("\n").map((l) => `   - ${l}`),
        "",
        "3. 참고",
        `   ${cite("floor-noise-rule:3")}의 기준(직접충격 소음 주간 39dB·야간 34dB 등, 1분 등가소음도)을 참고해 주시기 바랍니다.`,
        "   관리주체의 조치에도 소음이 계속되면 공동주택 층간소음관리위원회에 조정을 신청할 예정입니다.",
        "",
        `${today}`,
        `신청인 ${val(v, "name")} (서명 또는 인)`,
        "",
        "○○아파트 관리사무소장 귀하",
      ].join("\n"),
  },
  {
    topicId: "unfair-dismissal",
    title: "부당해고 구제신청서",
    desc: "정당한 이유 없이 해고되었을 때 노동위원회에 내는 구제신청서 초안이에요. 해고된 날부터 3개월 안에 내야 해요.",
    submitTo: "사업장 소재지 관할 지방노동위원회(방문·우편·온라인)",
    refs: ["labor-standards:28", "labor-standards:23", "labor-standards:26"],
    fields: [
      ...PERSON,
      { id: "company", label: "사업장 이름", half: true },
      { id: "boss", label: "대표자 이름", half: true },
      { id: "companyAddr", label: "사업장 주소" },
      { id: "start", label: "입사일", placeholder: "2022. 5. 2.", half: true },
      { id: "fired", label: "해고된 날", placeholder: "2025. 9. 19.", half: true },
      { id: "how", label: "해고 통보 방식", placeholder: "구두(서면 통지 없음)", half: true },
      { id: "notice", label: "해고 예고", placeholder: "예고 없이 다음 날부터 출근하지 말라고 함", half: true },
      { id: "reason", label: "들은 해고 사유와 사정", multiline: true, placeholder: "팀장이 '내일부터 나오지 말라'고 했고, 사유는 말로만 '업무 태도'라고 들음" },
    ],
    build: (v, cite, today) =>
      [
        "부당해고 구제신청서",
        "",
        `신청인(근로자): ${val(v, "name")} (주소: ${val(v, "addr")}, 연락처: ${val(v, "phone")})`,
        `피신청인(사용자): ${val(v, "company")} 대표 ${val(v, "boss")} (주소: ${val(v, "companyAddr")})`,
        "",
        "1. 신청 취지",
        "   피신청인이 신청인에게 한 해고는 부당해고임을 인정하고, 신청인을 원직에 복직시키며 해고 기간 동안 받지 못한 임금 상당액을 지급하라는 판정을 구합니다.",
        "",
        "2. 신청 이유",
        `   가. 신청인은 ${val(v, "start")} 입사하여 근무하던 중 ${val(v, "fired")} 해고되었습니다(통보 방식: ${val(v, "how")}).`,
        `   나. 해고 예고: ${val(v, "notice")}.`,
        `   다. ${val(v, "reason", "해고 사유를 구체적으로 듣지 못하였습니다.")}`,
        `   라. ${cite("labor-standards:23")}은 정당한 이유 없는 해고를 금지하고, ${cite("labor-standards:26")}은 30일 전 해고 예고(또는 30일분 이상 통상임금 지급)를 정하고 있습니다. 위 해고는 이에 비추어 부당합니다.`,
        "",
        "3. 신청 기간",
        `   ${cite("labor-standards:28")}에 따라 부당해고가 있었던 날부터 3개월 이내에 신청합니다.`,
        "",
        "4. 첨부: 근로계약서, 해고 관련 문자·녹음·통지서, 급여명세서 등",
        "",
        `${today}`,
        `신청인 ${val(v, "name")} (서명 또는 인)`,
        "",
        "○○지방노동위원회 위원장 귀하",
      ].join("\n"),
  },
  {
    topicId: "info-disclosure",
    title: "정보공개 이의신청서",
    desc: "비공개·부분공개 결정을 받았거나 청구 후 20일이 지나도 결정이 없을 때 그 공공기관에 내는 이의신청서예요.",
    submitTo: "결정을 한 공공기관(정보공개포털 open.go.kr 에서 온라인 신청 가능)",
    refs: ["info-disclosure:18", "info-disclosure:11"],
    fields: [
      ...PERSON,
      { id: "agency", label: "공공기관", placeholder: "○○시청", half: true },
      { id: "reqDate", label: "정보공개 청구일", placeholder: "2025. 9. 1.", half: true },
      { id: "info", label: "청구한 정보", placeholder: "2024년 ○○사업 용역 계약서 및 결과보고서" },
      { id: "decision", label: "받은 결정(통지일 포함)", placeholder: "2025. 9. 10. 비공개 결정 통지", half: true },
      { id: "basis", label: "기관이 든 비공개 사유", placeholder: "의사결정 과정 중인 사항", half: true },
      { id: "why", label: "이의 이유", multiline: true, placeholder: "용역이 이미 끝나 의사결정 과정에 있다고 볼 수 없고, 예산 집행의 투명성을 위해 공개가 필요함" },
    ],
    build: (v, cite, today) =>
      [
        "정보공개 이의신청서",
        "",
        `신청인: ${val(v, "name")} (주소: ${val(v, "addr")}, 연락처: ${val(v, "phone")})`,
        `처분 기관: ${val(v, "agency")}`,
        "",
        `1. 청구 내용: ${val(v, "reqDate")} 청구 — ${val(v, "info")}`,
        `2. 결정 내용: ${val(v, "decision")} (사유: ${val(v, "basis")})`,
        "",
        "3. 이의신청 취지",
        "   위 결정을 취소하고 청구한 정보를 공개하여 주시기 바랍니다.",
        "",
        "4. 이의신청 이유",
        ...val(v, "why", "(이의 이유를 적어 주세요)").split("\n").map((l) => `   ${l}`),
        "",
        "5. 근거",
        `   ${cite("info-disclosure:18")} — 비공개·부분공개 결정에 불복하거나 청구 후 20일이 지나도록 결정이 없으면, 결정 통지를 받은 날 또는 청구 후 20일이 지난 날부터 30일 이내에 이의신청할 수 있습니다.`,
        `   ${cite("info-disclosure:11")} — 공공기관은 청구를 받은 날부터 10일 이내에 공개 여부를 결정하여야 합니다.`,
        "",
        `${today}`,
        `신청인 ${val(v, "name")} (서명 또는 인)`,
        "",
        `${val(v, "agency", "○○기관")}의 장 귀하`,
      ].join("\n"),
  },
  {
    topicId: "privacy-access",
    title: "개인정보 열람 요구서",
    desc: "기관·회사가 가지고 있는 내 개인정보를 보여 달라고 요구하는 서식이에요. 열람 후 정정·삭제도 요구할 수 있어요.",
    submitTo: "개인정보를 처리하는 기관·회사(개인정보 보호책임자) — 답이 없으면 개인정보침해 신고센터(118)",
    refs: ["privacy:35", "privacy-decree:41", "privacy:36"],
    fields: [
      ...PERSON,
      { id: "org", label: "기관·회사 이름", placeholder: "○○쇼핑몰(주)", half: true },
      { id: "how", label: "받고 싶은 방법", placeholder: "전자우편(이메일)", half: true },
      { id: "items", label: "열람하려는 사항", multiline: true, placeholder: "보유 중인 나의 개인정보 항목과 내용\n수집·이용 목적과 보유 기간\n제3자에게 제공한 현황" },
    ],
    build: (v, cite, today) =>
      [
        "개인정보 열람 요구서",
        "",
        `요구인(정보주체): ${val(v, "name")} (주소: ${val(v, "addr")}, 연락처: ${val(v, "phone")})`,
        `받는 곳: ${val(v, "org")} 개인정보 보호책임자`,
        "",
        `1. 요구인은 ${cite("privacy:35")}에 따라 귀사(기관)가 처리하는 요구인의 개인정보 중 아래 사항의 열람을 요구합니다.`,
        ...val(v, "items", "(열람하려는 사항)").split("\n").map((l) => `   - ${l}`),
        `2. 열람 결과는 ${val(v, "how")}(으)로 받기를 원합니다(${cite("privacy-decree:41")}의 열람 절차).`,
        `3. 열람 후 사실과 다르거나 필요 없는 정보가 있으면 ${cite("privacy:36")}에 따라 정정·삭제를 요구할 예정입니다.`,
        "",
        `${today}`,
        `요구인 ${val(v, "name")} (서명 또는 인)`,
      ].join("\n"),
  },
  {
    topicId: "admin-appeal",
    title: "행정심판청구서",
    desc: "행정기관의 처분이 위법·부당하다고 생각할 때 내는 행정심판청구서 초안이에요. 처분을 안 날부터 90일 안에 내야 해요.",
    submitTo: "처분한 행정기관(피청구인) 또는 행정심판위원회 — 온라인행정심판(simpan.go.kr)",
    refs: ["admin-appeal:27", "admin-appeal:23"],
    fields: [
      ...PERSON,
      { id: "agency", label: "처분한 기관(피청구인)", placeholder: "○○구청장", half: true },
      { id: "knew", label: "처분을 안 날", placeholder: "2025. 9. 15.", half: true },
      { id: "action", label: "처분 내용", placeholder: "영업정지 1개월 처분" },
      { id: "aim", label: "청구 취지(원하는 결과)", placeholder: "피청구인이 2025. 9. 12. 청구인에게 한 영업정지 1개월 처분을 취소한다." },
      { id: "why", label: "청구 이유", multiline: true, placeholder: "처분 사유가 된 사실관계가 다르고, 처분이 지나치게 무거움" },
    ],
    build: (v, cite, today) =>
      [
        "행정심판청구서",
        "",
        `청구인: ${val(v, "name")} (주소: ${val(v, "addr")}, 연락처: ${val(v, "phone")})`,
        `피청구인: ${val(v, "agency")}`,
        `처분 내용: ${val(v, "action")}`,
        `처분이 있음을 안 날: ${val(v, "knew")}`,
        "",
        "1. 청구 취지",
        `   ${val(v, "aim")}`,
        "",
        "2. 청구 이유",
        ...val(v, "why", "(청구 이유를 적어 주세요)").split("\n").map((l) => `   ${l}`),
        "",
        "3. 청구 기간·제출",
        `   ${cite("admin-appeal:27")}에 따라 처분이 있음을 안 날부터 90일 이내에 청구하며, ${cite("admin-appeal:23")}에 따라 심판청구서를 피청구인 또는 위원회에 제출합니다.`,
        "",
        `${today}`,
        `청구인 ${val(v, "name")} (서명 또는 인)`,
        "",
        "○○행정심판위원회 귀중",
      ].join("\n"),
  },
];

export const formForTopic = (topicId: string | undefined) => CITIZEN_FORMS.find((f) => f.topicId === topicId);

/** 근거 조문 표기 — 답변의 근거 목록에 있으면 원문 제목으로, 없으면 키에서 조번호만 */
export function citeFrom(citations: Citation[]) {
  return (key: string) => {
    const c = citations.find((x) => x.key === key);
    if (c) return `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`;
    const no = key.split(":")[1] ?? "";
    return articleLabel(no);
  };
}

export const todayKo = (d = new Date()) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
