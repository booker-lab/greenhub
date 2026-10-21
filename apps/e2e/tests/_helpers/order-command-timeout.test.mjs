import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  E2E_TEST_TIMEOUT_MS,
  LOCAL_TARGET_EXPECT_TIMEOUT_MS,
  ORDER_COMMAND_SETTLE_TIMEOUT_MS,
  orderCommandsSettleTimeout,
} from './order-command-timeout.ts';

const readSpec = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('주문 상태 변경 명령 뒤 화면 대기', () => {
  it('원격 기본 대기(5초)보다 길고, 로컬 대상 모드 기본 대기보다 짧게 줄이지 않는다', () => {
    assert.ok(ORDER_COMMAND_SETTLE_TIMEOUT_MS > 5_000);
    assert.equal(orderCommandsSettleTimeout(), LOCAL_TARGET_EXPECT_TIMEOUT_MS);
    assert.equal(orderCommandsSettleTimeout(1), LOCAL_TARGET_EXPECT_TIMEOUT_MS);
  });

  it('차례로 보내는 명령은 건수만큼 늘리되 시험 제한 시간 안에 머문다', () => {
    assert.equal(orderCommandsSettleTimeout(2), ORDER_COMMAND_SETTLE_TIMEOUT_MS * 2);
    assert.ok(orderCommandsSettleTimeout(2) < E2E_TEST_TIMEOUT_MS);
  });

  it('건수가 잘못됐거나 시험 제한 시간을 넘기면 바로 실패한다', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => orderCommandsSettleTimeout(count), /1 이상의 정수/);
    }
    assert.throws(() => orderCommandsSettleTimeout(3), /시험 제한 시간/);
  });

  it('설정 파일은 시험 제한 시간·로컬 대기를 이 도우미 값으로 쓴다', () => {
    const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8');
    assert.match(config, /timeout: E2E_TEST_TIMEOUT_MS/);
    assert.match(config, /expect: \{ timeout: LOCAL_TARGET_EXPECT_TIMEOUT_MS \}/);
  });

  // 2026-10-21 원격 회차 E2E 실패 회귀: 명령 응답을 기다리는 단언이 기본 대기(5초)로 돌아가지 않게 한다.
  it('일괄 준비 시작 완료 안내는 명령 2건 대기로 기다린다', () => {
    assert.match(
      readSpec('seller-sale-rounds.spec.ts'),
      /getByText\('준비 시작을 마쳤어요'\)\)\.toBeVisible\(\{\s*timeout: orderCommandsSettleTimeout\(2\),\s*\}\)/,
    );
  });

  it('배송 재개 뒤 배송 중 표시는 명령 1건 대기로 기다린다', () => {
    assert.match(
      readSpec('driver-direct-delivery.spec.ts'),
      /getByText\('배송 중', \{ exact: true \}\)\)\.toBeVisible\(\{\s*timeout: orderCommandsSettleTimeout\(1\),\s*\}\)/,
    );
  });
});
