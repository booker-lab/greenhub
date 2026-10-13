import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { VARIETIES_LIST_LIMIT, VarietiesService } from './varieties.service';
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

describe('VarietiesService.findAll', () => {
  function makeQuery(get: jest.Mock) {
    const query: Record<string, jest.Mock> = {};
    query.where = jest.fn().mockReturnValue(query);
    query.orderBy = jest.fn().mockReturnValue(query);
    query.limit = jest.fn().mockReturnValue(query);
    query.get = get;
    return query;
  }

  it('정렬된 품종 목록을 상한 건수까지만 읽는다', async () => {
    const get = jest.fn().mockResolvedValue({
      docs: [{ id: 'variety-1', data: () => ({ name: '품종' }) }],
    });
    const query = makeQuery(get);
    const firestore = { collection: jest.fn().mockReturnValue(query) };
    const service = new VarietiesService(firestore as never);

    await expect(service.findAll('orchid')).resolves.toEqual([{ id: 'variety-1', name: '품종' }]);
    expect(query.where).toHaveBeenCalledWith('category', '==', 'orchid');
    expect(query.limit).toHaveBeenCalledWith(VARIETIES_LIST_LIMIT);
  });

  it('조회 오류를 빈 목록으로 숨기지 않고 일반 5xx 오류로 전파한다', async () => {
    const get = jest.fn().mockRejectedValue(new Error('FAILED_PRECONDITION: index missing'));
    const firestore = { collection: jest.fn().mockReturnValue(makeQuery(get)) };
    const service = new VarietiesService(firestore as never);
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      const result = service.findAll();
      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toThrow('품종 목록을 불러오지 못했습니다.');
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('index missing'));
    } finally {
      logError.mockRestore();
    }
  });
});
