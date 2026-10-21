import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AddressDto } from './dto/address.dto';
import { FcmTokenDto } from './dto/fcm-token.dto';
import { KakaoLoginDto } from './dto/kakao-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from './types/jwt-payload.type';

// 인증 엔드포인트는 brute-force 방어로 1분 10회 — 전역 'default'(100/분) 오버라이드.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60000 } };
// 카카오 로그인·토큰 갱신은 세 앱의 Auth.js 서버(Vercel)가 대신 호출해 접속 IP가 손님이 아니라
// Vercel 서버다. 여러 손님이 같은 서버 IP를 나눠 쓰므로 10회/분이면 오픈 직후 로그인이 막힌다.
// 유효한 카카오 토큰·리프레시 토큰이 있어야만 성공하는 경로라 대입 공격 위험이 낮아 한도를 넓힌다.
const RELAYED_AUTH_THROTTLE = { default: { limit: 120, ttl: 60000 } };
// firebase-token은 판매자·기사 앱 브라우저가 화면을 새로 열 때와 access token이 바뀔 때(약 1시간마다)
// 한 번씩 부른다. 집계는 ClientThrottlerGuard가 서명 검증된 access token의 사용자(sub) 단위로 하므로,
// 한 사용자가 여러 탭·기기를 함께 열어도 닿지 않을 만큼 두되, 전역 기본(100/분)보다는 낮춰 커스텀 토큰
// 발급이 반복 호출로 몰리지 않게 한다.
export const FIREBASE_TOKEN_THROTTLE = { default: { limit: 60, ttl: 60000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('kakao-login')
  @HttpCode(HttpStatus.OK)
  @Throttle(RELAYED_AUTH_THROTTLE)
  kakaoLogin(@Body() dto: KakaoLoginDto) {
    return this.authService.kakaoLogin(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(RELAYED_AUTH_THROTTLE)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  getSession(@CurrentUser() user: JwtPayload) {
    return this.authService.getSession(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(user.sub, dto);
  }

  // 소비자 회원 탈퇴. 진행 중인 주문이 있으면 409.
  @Delete('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('consumer')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(@CurrentUser() user: JwtPayload) {
    return this.authService.withdraw(user);
  }

  @Post('me/addresses')
  @UseGuards(JwtAuthGuard)
  addAddress(@CurrentUser() user: JwtPayload, @Body() dto: AddressDto) {
    return this.authService.addAddress(user.sub, dto);
  }

  @Patch('me/addresses/:addressId')
  @UseGuards(JwtAuthGuard)
  updateAddress(
    @CurrentUser() user: JwtPayload,
    @Param('addressId') addressId: string,
    @Body() dto: AddressDto,
  ) {
    return this.authService.updateAddress(user.sub, addressId, dto);
  }

  @Delete('me/addresses/:addressId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAddress(@CurrentUser() user: JwtPayload, @Param('addressId') addressId: string) {
    return this.authService.deleteAddress(user.sub, addressId);
  }

  @Patch('me/addresses/:addressId/default')
  @UseGuards(JwtAuthGuard)
  setDefaultAddress(@CurrentUser() user: JwtPayload, @Param('addressId') addressId: string) {
    return this.authService.setDefaultAddress(user.sub, addressId);
  }

  @Patch('me/fcm-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  updateFcmToken(@CurrentUser() user: JwtPayload, @Body() dto: FcmTokenDto) {
    return this.authService.updateFcmToken(user.sub, dto.fcmToken);
  }

  // Firebase 클라이언트(Storage·Firestore 직접 접근)를 쓰는 판매자 앱(seller·admin)과 기사 앱(driver)만 받는다.
  @Get('firebase-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'driver', 'admin')
  @Throttle(FIREBASE_TOKEN_THROTTLE)
  getFirebaseToken(@CurrentUser() user: JwtPayload) {
    return this.authService.getFirebaseToken(user.sub);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub, user.sid);
  }
}
