/**
 * 회차 결제 버튼이 꺼져 있을 때 버튼 바로 위에 보일 "빠진 조건" 목록.
 *
 * 결제 버튼이 회색으로만 바뀌고 이유가 어디에도 없어 고객이 무엇을 해야 할지 몰랐다(C-03).
 * 고객이 직접 고칠 수 있는 조건만 고객 문구로 돌려준다. 회차 정보 확인 실패처럼 고객이 고칠 수 없는
 * 이유는 결제 폼의 오류 안내가 따로 보인다.
 */

export interface RoundPayReadinessInput {
  /** 배송지 주소가 채워졌는지(주소 검색 또는 직접 입력). */
  hasAddress: boolean;
  isIcheonAddress: boolean;
  /** 배송 연락처가 휴대폰 번호 형식인지. */
  phoneValid: boolean;
  /** 선물하기를 켰다면 받는 분·보내는 분 이름이 모두 있는지(끄면 true). */
  giftReady: boolean;
  /** 포장 라벨 "문구 넣기"를 골랐다면 문구가 알맞은지(고르지 않으면 true). */
  packageLabelReady: boolean;
  /** 결제 직전 확인 체크. */
  detailsConfirmed: boolean;
}

export const PAY_BLOCKER_MESSAGES = {
  address: '배송지 주소를 검색하거나 직접 입력해 주세요.',
  icheon: '경기도 이천시 주소만 주문할 수 있어요. 배송지를 바꿔 주세요.',
  phone: '배송 연락처를 휴대폰 번호로 적어 주세요.',
  gift: '선물 받는 분과 보내는 분 이름을 적어 주세요.',
  packageLabel: '포장 라벨 문구를 적어 주세요.',
  confirm: '주문 상품·수량·회차 가격을 확인하고 체크해 주세요.',
} as const;

/** 화면 위에서 아래 순서(배송지 → 연락처 → 선물·라벨 → 확인 체크)로 빠진 조건을 돌려준다. */
export function roundPayBlockers(input: RoundPayReadinessInput): string[] {
  const blockers: string[] = [];
  if (!input.hasAddress) blockers.push(PAY_BLOCKER_MESSAGES.address);
  else if (!input.isIcheonAddress) blockers.push(PAY_BLOCKER_MESSAGES.icheon);
  if (!input.phoneValid) blockers.push(PAY_BLOCKER_MESSAGES.phone);
  if (!input.giftReady) blockers.push(PAY_BLOCKER_MESSAGES.gift);
  if (!input.packageLabelReady) blockers.push(PAY_BLOCKER_MESSAGES.packageLabel);
  if (!input.detailsConfirmed) blockers.push(PAY_BLOCKER_MESSAGES.confirm);
  return blockers;
}
