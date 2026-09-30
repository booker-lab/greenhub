import { describe, expect, it } from 'vitest';
import { displayBuyerName, displayBuyerPhone, displayRequestNote, toTelHref } from './_lib';

describe('displayBuyerName', () => {
  it('이름이 있으면 앞뒤 공백을 지우고 보여준다', () => {
    expect(displayBuyerName({ buyerName: '  김그린 ' })).toBe('김그린');
  });

  it('이름이 없거나 공백뿐이면 대체 문구를 보여준다', () => {
    expect(displayBuyerName({})).toBe('이름 없음');
    expect(displayBuyerName({ buyerName: '   ' })).toBe('이름 없음');
  });
});

describe('displayRequestNote', () => {
  it('요청사항이 있으면 앞뒤 공백만 지우고 줄바꿈은 유지한다', () => {
    expect(displayRequestNote({ requestNote: ' 받는 분 김그린\n문구: 개업 축하 ' })).toBe(
      '받는 분 김그린\n문구: 개업 축하',
    );
  });

  it('없거나 비어 있으면 null', () => {
    expect(displayRequestNote({})).toBeNull();
    expect(displayRequestNote({ requestNote: null })).toBeNull();
    expect(displayRequestNote({ requestNote: '  ' })).toBeNull();
  });
});

describe('displayBuyerPhone', () => {
  it('상세 API의 deliveryPhone을 쓴다', () => {
    expect(displayBuyerPhone({ deliveryPhone: '010-1234-5678' })).toBe('010-1234-5678');
  });

  it('없거나 비어 있으면 null', () => {
    expect(displayBuyerPhone({})).toBeNull();
    expect(displayBuyerPhone({ deliveryPhone: null })).toBeNull();
    expect(displayBuyerPhone({ deliveryPhone: ' ' })).toBeNull();
  });
});

describe('toTelHref', () => {
  it('하이픈·공백을 지운 숫자만 남긴다', () => {
    expect(toTelHref('010-1234-5678')).toBe('tel:01012345678');
    expect(toTelHref(' 010 1234 5678 ')).toBe('tel:01012345678');
  });

  it('맨 앞 +는 유지한다', () => {
    expect(toTelHref('+82 10-1234-5678')).toBe('tel:+821012345678');
  });

  it('숫자가 없으면 링크를 만들지 않는다', () => {
    expect(toTelHref('없음')).toBeNull();
  });
});
