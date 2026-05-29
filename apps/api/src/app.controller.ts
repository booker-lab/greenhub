import { Controller, Get } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { AppService } from './app.service';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { BannerQueryService } from './banners/banner-query.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly banners: BannerQueryService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('banner')
  async getBanner() {
    return this.banners.getLegacyMainBanner();
  }

  @Get('banners/active')
  async getActiveBanners() {
    return this.banners.getActiveBanners();
  }
}
