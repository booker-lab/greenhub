import type { AdminBanner, BannerKind } from '@greenhub/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
// biome-ignore lint/style/useImportType: Nest 생성자 주입에는 런타임 클래스 값이 필요하다.
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateBannerDto, UpdateBannerDto, UpsertBannerDto } from './dto/admin.dto';

const DEFAULT_BANNER_ID = 'main_hero';

@Injectable()
export class AdminBannersService {
  constructor(private readonly firestore: FirestoreService) {}

  async listBanners() {
    const snap = await this.firestore.collection('banners').get();
    const banners = snap.docs
      .map((doc: any) => this.toBanner(doc.id, doc.data()))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'default' ? -1 : 1;
        return this.createdAtMs(b.createdAt) - this.createdAtMs(a.createdAt);
      });

    return { banners, total: banners.length };
  }

  async getBanner() {
    const snap = await this.firestore.doc(`banners/${DEFAULT_BANNER_ID}`).get();
    return snap.exists ? this.toBanner(snap.id, snap.data()) : null;
  }

  async upsertBanner(dto: UpsertBannerDto) {
    const now = this.firestore.Timestamp.now();
    const ref = this.firestore.doc(`banners/${DEFAULT_BANNER_ID}`);
    const snap = await ref.get();
    const payload = this.toWritableFields({ ...dto, kind: 'default' });
    this.assertCtaPairs(payload);

    await ref.set(
      {
        ...payload,
        kind: 'default',
        updatedAt: now,
        ...(snap.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    );
    return this.getBanner();
  }

  async createBanner(dto: CreateBannerDto) {
    if (dto.kind === 'default') return this.upsertBanner(dto);

    const id = uuidv4();
    const now = this.firestore.Timestamp.now();
    const payload = this.toWritableFields(dto);
    this.assertBannerValid(dto.kind, payload);
    await this.firestore.doc(`banners/${id}`).set({
      ...payload,
      id,
      kind: dto.kind,
      createdAt: now,
      updatedAt: now,
    });

    const snap = await this.firestore.doc(`banners/${id}`).get();
    return this.toBanner(snap.id, snap.data());
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const ref = this.firestore.doc(`banners/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('배너를 찾을 수 없습니다.');

    const current = this.toBanner(snap.id, snap.data());
    const kind = dto.kind ?? current.kind;
    const payload = this.toWritableFields(dto);
    this.assertBannerValid(kind, { ...current, ...payload, kind });

    await ref.set({ ...payload, kind, updatedAt: this.firestore.Timestamp.now() }, { merge: true });
    const updated = await ref.get();
    const next = this.toBanner(updated.id, updated.data());
    await this.deleteStorageImageIfChanged(current.imageUrl, next.imageUrl);
    return next;
  }

  async deleteBanner(id: string) {
    const ref = this.firestore.doc(`banners/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('배너를 찾을 수 없습니다.');

    const banner = this.toBanner(snap.id, snap.data());
    if (banner.kind === 'default') {
      throw new UnprocessableEntityException('기본 배너는 삭제할 수 없습니다.');
    }

    await ref.delete();
    await this.deleteStorageImage(banner.imageUrl);
    return { ok: true, id };
  }

  private assertBannerValid(kind: BannerKind, banner: Partial<AdminBanner>) {
    this.assertCtaPairs(banner);
    if (kind !== 'scheduled') return;
    if (!banner.startDate || !banner.endDate) {
      throw new BadRequestException('기간 배너는 시작일과 종료일이 필요합니다.');
    }
    if (banner.endDate < banner.startDate) {
      throw new BadRequestException('종료일은 시작일보다 빠를 수 없습니다.');
    }
  }

  private assertCtaPairs(banner: Partial<AdminBanner>) {
    for (const cta of [banner.cta1, banner.cta2]) {
      if (!cta) continue;
      const label = cta.label?.trim();
      const href = cta.href?.trim();
      if ((label && !href) || (!label && href)) {
        throw new BadRequestException('CTA 문구와 URL은 함께 입력해야 합니다.');
      }
    }
  }

  private toWritableFields(dto: Partial<AdminBanner> & { isActive?: boolean }) {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      isActive: _isActive,
      ...fields
    } = dto;
    return fields;
  }

  private toBanner(id: string, data: FirebaseFirestore.DocumentData | undefined): AdminBanner {
    const kind = this.toKind(id, data?.kind);
    return { id, kind, ...data } as AdminBanner;
  }

  private toKind(id: string, value: unknown): BannerKind {
    if (value === 'scheduled' || value === 'default') return value;
    return id === DEFAULT_BANNER_ID ? 'default' : 'scheduled';
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

  private async deleteStorageImageIfChanged(previous?: string, next?: string) {
    if (!previous || previous === next) return;
    await this.deleteStorageImage(previous);
  }

  private async deleteStorageImage(imageUrl?: string) {
    const parsed = this.parseStorageUrl(imageUrl);
    if (!parsed) return;
    await admin.storage().bucket(parsed.bucket).file(parsed.path).delete({ ignoreNotFound: true });
  }

  private parseStorageUrl(imageUrl?: string): { bucket: string; path: string } | null {
    if (!imageUrl) return null;
    try {
      const url = new URL(imageUrl);
      if (url.hostname === 'firebasestorage.googleapis.com') {
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null;
      }
      if (url.hostname === 'storage.googleapis.com') {
        const [, bucket, ...pathParts] = url.pathname.split('/');
        return bucket && pathParts.length > 0 ? { bucket, path: pathParts.join('/') } : null;
      }
    } catch {}
    return null;
  }
}
