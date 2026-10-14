import { describe, expect, it } from "vitest";
import { parseArticles, parseCaseList, parseLawList } from "@/lib/law-api/drf";

/** 국가법령정보 DRF JSON 응답 형태(축약 샘플) */
const lawSearchSample = {
  LawSearch: {
    totalCnt: "2",
    law: [
      { 법령명한글: "주택임대차보호법", 법령일련번호: "111", 법령ID: "001", 법령구분명: "법률", 소관부처명: "법무부", 시행일자: "20230719", 현행연혁코드: "현행" },
      { 법령명한글: "주택임대차보호법 시행령", 법령일련번호: "222", 법령ID: "002", 법령구분명: "대통령령", 소관부처명: "법무부", 시행일자: "20230221", 현행연혁코드: "현행" },
    ],
  },
};

const lawServiceSample = {
  법령: {
    기본정보: { 법령명_한글: "주택임대차보호법" },
    조문: {
      조문단위: [
        { 조문여부: "전문", 조문내용: "제1장 총칙" },
        {
          조문여부: "조문",
          조문번호: "3",
          조문제목: "대항력 등",
          조문내용: "제3조(대항력 등)",
          항: [
            { 항내용: "① 임대차는 그 등기가 없는 경우에도 ..." },
            { 항내용: "② 주택도시기금을 ...", 호: [{ 호내용: "1. 첫째 호", 목: { 목내용: "가. 목 내용" } }] },
          ],
        },
        { 조문여부: "조문", 조문번호: "3", 조문가지번호: "2", 조문제목: "보증금의 회수", 조문내용: "제3조의2(보증금의 회수) ① 임차인이 ..." },
      ],
    },
  },
};

describe("DRF 응답 파서", () => {
  it("법령 목록", () => {
    const list = parseLawList(lawSearchSample);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: "주택임대차보호법", mst: "111", kind: "법률" });
  });

  it("조문: 전문 제외, 가지번호, 항·호·목 들여쓰기, 머리말 제거", () => {
    const arts = parseArticles(lawServiceSample);
    expect(arts.map((a) => a.no)).toEqual(["3", "3의2"]);
    expect(arts[0].text.split("\n")).toEqual(["① 임대차는 그 등기가 없는 경우에도 ...", "② 주택도시기금을 ...", "  1. 첫째 호", "    가. 목 내용"]);
    expect(arts[1].text.startsWith("① 임차인이")).toBe(true);
  });

  it("판례 목록 → 공개 주소(인증키 미포함)", () => {
    const cases = parseCaseList({ PrecSearch: { prec: { 사건명: "보증금반환", 사건번호: "2020다12345", 법원명: "대법원", 선고일자: "20210101" } } }, "판례");
    expect(cases[0].url).toContain("law.go.kr/판례/");
    expect(cases[0].url).not.toContain("OC=");
  });
});
