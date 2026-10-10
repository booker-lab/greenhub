import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateSaleRoundDto } from './sale-round.dto';

const FIELDS = [
  'orderOpenAt',
  'orderCloseAt',
  'auctionAt',
  'deliveryStartAt',
  'deliveryEndAt',
] as const;

function schedule(value: string) {
  return {
    ...Object.fromEntries(FIELDS.map((field) => [field, value])),
    timezone: 'Asia/Seoul',
  };
}

async function scheduleErrors(value: string): Promise<ValidationError[]> {
  const dto = plainToInstance(CreateSaleRoundDto, { schedule: schedule(value) });
  const errors = await validate(dto);
  return errors.find((error) => error.property === 'schedule')?.children ?? [];
}

describe('회차 일정 시각의 시차 검증', () => {
  it.each([
    '2026-11-01T01:00:00.000Z',
    '2026-11-01T01:00:00Z',
    '2026-11-01T10:00:00+09:00',
    '2026-11-01T10:00+09:00',
  ])('시차가 있는 %s는 받는다', async (value) => {
    expect(await scheduleErrors(value)).toEqual([]);
  });

  it.each([
    '2026-11-01T10:00:00',
    '2026-11-01T10:00:00.000',
    '2026-11-01',
  ])('시차가 없는 %s는 다섯 일정 모두 거부한다', async (value) => {
    const errors = await scheduleErrors(value);
    expect(errors.map((error) => error.property).sort()).toEqual([...FIELDS].sort());
    for (const error of errors) {
      expect(Object.values(error.constraints ?? {})).toContain(
        '회차 일정 시각에는 시차(Z 또는 +09:00)가 필요합니다.',
      );
    }
  });
});
