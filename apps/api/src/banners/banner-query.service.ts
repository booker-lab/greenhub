import type { ActiveBannersResponse, AdminBanner, BannerKind } from '@greenhub/shared';
import { todayKST } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest 생성자 주입에는 런타임 클래스 값이 필요하다.
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class BannerQueryService {
  constructor(private readonly firestore: FirestoreService) {}

  async getActiveBanners(): Promise<ActiveBannersResponse> {
    const snap = await this.firestore.collection('banners').get();
    const today = todayKST();
    const banners = snap.docs.map((doc: any) => this.toBanner(doc.id, doc.data()));
    const defaultBanner =
      banners.find((banner) => banner.kind === 'default') ??
      banners.find((banner) => banner.id === 'main_hero') ??
      null;
    const scheduled = banners
      .filter((banner) => banner.kind === 'scheduled')
      .filter((banner) => this.isActiveScheduledBanner(banner, today))
      .sort((a, b) => this.createdAtMs(b.createdAt) - this.createdAtMs(a.createdAt));

    return { scheduled, default: defaultBanner };
  }

  private toBanner(id: string, data: FirebaseFirestore.DocumentData | undefined): AdminBanner {
    const kind = this.toKind(id, data?.kind);
    return { id, kind, ...data } as AdminBanner;
  }

  private toKind(id: string, value: unknown): BannerKind {
    if (value === 'scheduled' || value === 'default') return value;
    return id === 'main_hero' ? 'default' : 'scheduled';
  }

  private isActiveScheduledBanner(banner: AdminBanner, today: string): boolean {
    return Boolean(
      banner.startDate && banner.endDate && banner.startDate <= today && banner.endDate >= today,
    );
  }

  private createdAtMs(value: unknown): number {
    if (typeof value === 'object' && value !== null && 'toMillis' in value) {
      const toMillis = (value as { toMillis?: unknown }).toMillis;
      return typeof toMillis === 'function' ? toMillis() : 0;
    }
    if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
      return new Date(value).getTime();
    }
    return 0;
  }
}
