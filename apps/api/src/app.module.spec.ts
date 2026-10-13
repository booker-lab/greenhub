import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppModule } from './app.module';
import { OperationsModule } from './operations/operations.module';
import { RetentionModule } from './retention/retention.module';
import { SaleRoundsModule } from './sale-rounds/sale-rounds.module';

function metadata<T>(target: object, key: string): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('애플리케이션 모듈 연결 계약', () => {
  it('회차·운영 예외·보관 모듈을 각각 한 번만 가져온다', () => {
    const imports = metadata(AppModule, MODULE_METADATA.IMPORTS);

    for (const module of [SaleRoundsModule, OperationsModule, RetentionModule]) {
      expect(imports.filter((importedModule) => importedModule === module)).toHaveLength(1);
    }
  });

  it('기능 모듈의 provider를 AppModule에 중복 등록하지 않는다', () => {
    // AppService와 전역 요청 제한(APP_GUARD)·일시 오류 응답(APP_FILTER)만 둔다.
    const providers = metadata<{ provide?: string }>(AppModule, MODULE_METADATA.PROVIDERS);
    expect(providers).toHaveLength(3);
    expect(providers.map((provider) => provider.provide).filter(Boolean)).toEqual([
      APP_GUARD,
      APP_FILTER,
    ]);
  });
});
