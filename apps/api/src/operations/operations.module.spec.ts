import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { OperationIssuesModule } from './operation-issues.module';
import { OperationsController } from './operations.controller';
import { OperationsModule } from './operations.module';
import { OperationsService } from './operations.service';

function metadata<T>(target: object, key: string): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('운영 예외 모듈 연결', () => {
  it('OperationsModule은 서비스와 컨트롤러를 등록하고 서비스를 내보낸다', () => {
    expect(metadata(OperationsModule, MODULE_METADATA.PROVIDERS)).toContain(OperationsService);
    expect(metadata(OperationsModule, MODULE_METADATA.CONTROLLERS)).toContain(OperationsController);
    expect(metadata(OperationsModule, MODULE_METADATA.EXPORTS)).toContain(OperationsService);
  });

  it('OperationsModule은 결제와 알림 모듈을 가져온다', () => {
    const imports = metadata<unknown>(OperationsModule, MODULE_METADATA.IMPORTS);
    expect(imports).toContain(OperationIssuesModule);
  });

  it('AppModule과 기존 생성 경로 모듈은 OperationsModule을 연결한다', () => {
    expect(metadata(AppModule, MODULE_METADATA.IMPORTS)).toContain(OperationsModule);
    expect(metadata(NotificationsModule, MODULE_METADATA.IMPORTS)).toContain(OperationIssuesModule);
    expect(metadata(OrdersModule, MODULE_METADATA.IMPORTS)).toContain(OperationIssuesModule);
  });
});
