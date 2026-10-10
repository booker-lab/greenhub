import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateVarietyDto } from './dto/create-variety.dto';
import { UpdateVarietyDto } from './dto/update-variety.dto';

/** 품종 목록 한 번에 돌려주는 최대 건수(참조 데이터라 수백 건 이내를 전제로 한다). */
export const VARIETIES_LIST_LIMIT = 500;

@Injectable()
export class VarietiesService {
  private readonly logger = new Logger(VarietiesService.name);

  constructor(private readonly firestore: FirestoreService) {}

  async findAll(category?: string) {
    try {
      let ref = this.firestore.collection('varieties') as any;
      if (category) {
        ref = ref.where('category', '==', category);
      }
      const ordered = ref.orderBy('subCategory').orderBy('name');
      const snap = await ordered.limit(VARIETIES_LIST_LIMIT).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e: unknown) {
      this.logger.error(
        `품종 목록 조회 실패 (category=${category ?? 'all'}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new InternalServerErrorException('품종 목록을 불러오지 못했습니다.');
    }
  }

  async findOne(id: string) {
    const doc = await this.firestore.collection('varieties').doc(id).get();
    if (!doc.exists) throw new NotFoundException(`품종을 찾을 수 없습니다: ${id}`);
    return { id: doc.id, ...doc.data() };
  }

  async create(dto: CreateVarietyDto) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const data = { ...dto, notes: dto.notes ?? '', createdAt: now };
    await this.firestore.collection('varieties').doc(id).set(data);
    return { id, ...data };
  }

  async update(id: string, dto: UpdateVarietyDto) {
    const doc = await this.firestore.collection('varieties').doc(id).get();
    if (!doc.exists) throw new NotFoundException(`품종을 찾을 수 없습니다: ${id}`);
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    await this.firestore
      .collection('varieties')
      .doc(id)
      .update(changes);
    return { id, ...doc.data(), ...changes };
  }
}
