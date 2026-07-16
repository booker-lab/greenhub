import { MODULE_METADATA } from '@nestjs/common/constants';
import { FirestoreModule } from '../firestore/firestore.module';
import { RetentionModule } from './retention.module';
import { RetentionService } from './retention.service';

function metadata<T>(target: object, key: string): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('보관 모듈 계약', () => {
  it('FirestoreModule을 가져와 보관 서비스의 Firestore 의존성을 제공한다', () => {
    expect(metadata(RetentionModule, MODULE_METADATA.IMPORTS)).toContain(FirestoreModule);
  });

  it('RetentionService를 provider로 등록하고 다른 모듈에서 재사용할 수 있게 내보낸다', () => {
    expect(metadata(RetentionModule, MODULE_METADATA.PROVIDERS)).toContain(RetentionService);
    expect(metadata(RetentionModule, MODULE_METADATA.EXPORTS)).toContain(RetentionService);
  });
});
