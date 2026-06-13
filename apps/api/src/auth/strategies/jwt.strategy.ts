import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return {
      sub: payload.sub,
      role: payload.role,
      storeId: payload.storeId,
      hubId: payload.hubId,
      hubIds: payload.hubIds,
    };
  }
}
