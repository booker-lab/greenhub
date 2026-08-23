import { ForbiddenException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../../firestore/firestore.service';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly firestore: FirestoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (payload.role === 'driver') {
      const userSnap = await this.firestore.doc(`users/${payload.sub}`).get();
      const user = userSnap.data();
      if (
        !userSnap.exists ||
        user?.['role'] !== 'driver' ||
        user?.['driverApproved'] !== true ||
        user?.['suspended'] === true
      ) {
        throw new ForbiddenException('승인된 드라이버만 배송 기능을 사용할 수 있습니다.');
      }
    }

    return { sub: payload.sub, role: payload.role, storeId: payload.storeId };
  }
}
