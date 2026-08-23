import {
  assertRoundDirectAligoTemplateCodes,
  parseAligoTemplateCodes,
  ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES,
  resolveAligoTemplateCode,
} from './aligo-template-codes';

describe('ALIGO 템플릿 코드 설정 계약', () => {
  it('내부 논리 코드를 trim한 외부 tpl_code로 해석한다', () => {
    const raw = JSON.stringify({ ORDER_ACCEPTED: '  provider-code  ' });

    expect(resolveAligoTemplateCode(raw, 'ORDER_ACCEPTED')).toBe('provider-code');
  });

  it.each([
    ['잘못된 JSON', '{'],
    ['배열', '[]'],
    ['허용되지 않은 키', JSON.stringify({ UNKNOWN: 'provider-code' })],
    ['문자열이 아닌 값', JSON.stringify({ ORDER_ACCEPTED: 1 })],
    ['빈 값', JSON.stringify({ ORDER_ACCEPTED: '   ' })],
  ])('%s 설정을 거부한다', (_name, raw) => {
    expect(() => parseAligoTemplateCodes(raw)).toThrow();
  });

  it('요청 논리 코드의 매핑이 없으면 설정 오류로 거부한다', () => {
    expect(() => resolveAligoTemplateCode('{}', 'ORDER_ACCEPTED')).toThrow(
      'ORDER_ACCEPTED 매핑이 없습니다',
    );
  });

  it('회차 출시 준비 검증은 도달 가능한 8종의 매핑을 모두 요구한다', () => {
    const complete = Object.fromEntries(
      ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES.map((code, index) => [code, `provider-${index}`]),
    );

    expect(() => assertRoundDirectAligoTemplateCodes(JSON.stringify(complete))).not.toThrow();
    delete complete.ORDER_CANCELLED;
    expect(() => assertRoundDirectAligoTemplateCodes(JSON.stringify(complete))).toThrow(
      'ORDER_CANCELLED',
    );
  });
});
