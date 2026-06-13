import 'reflect-metadata';
import { UpdateStoreDto } from './dto/update-store.dto';
import { StoresController } from './stores.controller';

describe('StoresController', () => {
  it('스토어 생성 본문은 UpdateStoreDto 런타임 메타타입을 유지한다', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      StoresController.prototype,
      'createStore',
    );

    expect(paramTypes?.[1]).toBe(UpdateStoreDto);
  });

  it('스토어 수정 본문은 UpdateStoreDto 런타임 메타타입을 유지한다', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      StoresController.prototype,
      'updateStore',
    );

    expect(paramTypes?.[2]).toBe(UpdateStoreDto);
  });
});
