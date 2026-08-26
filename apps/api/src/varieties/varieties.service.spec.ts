import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { VarietiesService } from './varieties.service';
import { UpdateVarietyDto } from './dto/update-variety.dto';

describe('VarietiesService.update', () => {
  it('mutable 품종 속성을 PATCH하고 기존 필드도 함께 갱신한다', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existing = {
      name: '기존 품종',
      flowerSize: 'small',
      plantSize: 'medium',
      availableStemTypes: ['외대'],
      notes: '기존 메모',
    };
    const document = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => existing }),
      update,
    };
    const collection = { doc: jest.fn().mockReturnValue(document) };
    const firestore = { collection: jest.fn().mockReturnValue(collection) };
    const service = new VarietiesService(firestore as never);
    const dto = plainToInstance(UpdateVarietyDto, {
      flowerSize: 'large',
      plantSize: 'small',
      availableStemTypes: ['쌍대', '3대'],
      notes: '새 메모',
    });

    const result = await service.update('variety-1', dto);

    expect(update).toHaveBeenCalledWith({
      flowerSize: 'large',
      plantSize: 'small',
      availableStemTypes: ['쌍대', '3대'],
      notes: '새 메모',
    });
    expect(result).toMatchObject({
      flowerSize: 'large',
      plantSize: 'small',
      availableStemTypes: ['쌍대', '3대'],
      notes: '새 메모',
    });
  });

  it('생략한 필드는 기존 값을 유지한다', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existing = {
      name: '기존 품종',
      flowerSize: 'small',
      plantSize: 'medium',
      availableStemTypes: ['외대'],
      notes: '기존 메모',
    };
    const document = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => existing }),
      update,
    };
    const collection = { doc: jest.fn().mockReturnValue(document) };
    const firestore = { collection: jest.fn().mockReturnValue(collection) };
    const service = new VarietiesService(firestore as never);

    const result = await service.update(
      'variety-1',
      plainToInstance(UpdateVarietyDto, { notes: '새 메모' }),
    );

    expect(update).toHaveBeenCalledWith({ notes: '새 메모' });
    expect(result).toMatchObject({
      flowerSize: 'small',
      plantSize: 'medium',
      availableStemTypes: ['외대'],
      notes: '새 메모',
    });
  });
});
