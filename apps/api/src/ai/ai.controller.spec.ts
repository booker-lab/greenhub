import 'reflect-metadata';
import { type ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type UserRole } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiController } from './ai.controller';
import type { GenerateContentDto } from './dto/generate-content.dto';

const dto = {
  selection: {
    colors: ['화이트'],
    stemType: '외대',
    fragrance: 'none',
    bloomCondition: 'bud',
    bundleUnit: '1단',
  },
  sellerNote: '테스트 메모',
} as unknown as GenerateContentDto;

const seller = { sub: 'seller-1', role: 'seller' as const };

function makeController(consume: jest.Mock) {
  const aiService = {
    generateProductContent: jest.fn().mockResolvedValue({ headline: 'h', description: 'd' }),
  };
  const quota = { consume };
  const validator = { validate: jest.fn().mockReturnValue([]) };
  const varietiesService = { findOne: jest.fn() };
  const controller = new AiController(
    aiService as never,
    quota as never,
    validator as never,
    varietiesService as never,
  );
  return { controller, aiService, quota };
}

function contextFor(role: UserRole): ExecutionContext {
  return {
    getHandler: () => AiController.prototype.generateContent,
    getClass: () => AiController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('AiController 접근 제어', () => {
  const guard = new RolesGuard(new Reflector());

  it('클래스 단위로 JWT·역할 가드와 seller·admin 역할을 건다', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AiController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AiController)).toEqual(['seller', 'admin']);
  });

  it.each(['consumer', 'driver'] as const)('%s는 거부된다', (role) => {
    expect(guard.canActivate(contextFor(role))).toBe(false);
  });

  it.each(['seller', 'admin'] as const)('%s는 허용된다', (role) => {
    expect(guard.canActivate(contextFor(role))).toBe(true);
  });
});

describe('AiController.generateContent', () => {
  it('한도를 차감한 뒤 AI 생성 결과를 반환한다', async () => {
    const { controller, aiService, quota } = makeController(jest.fn().mockResolvedValue(1));

    await expect(controller.generateContent(seller, dto)).resolves.toEqual({
      headline: 'h',
      description: 'd',
      conflicts: [],
    });
    expect(quota.consume).toHaveBeenCalledWith('seller-1');
    expect(aiService.generateProductContent).toHaveBeenCalledTimes(1);
  });

  it('일일 한도를 넘으면 Gemini를 호출하지 않고 429를 전파한다', async () => {
    const exceeded = new HttpException('limit', HttpStatus.TOO_MANY_REQUESTS);
    const { controller, aiService } = makeController(jest.fn().mockRejectedValue(exceeded));

    await expect(controller.generateContent(seller, dto)).rejects.toBe(exceeded);
    expect(aiService.generateProductContent).not.toHaveBeenCalled();
  });
});
