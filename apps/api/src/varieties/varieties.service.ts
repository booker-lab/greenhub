import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateVarietyDto } from './dto/create-variety.dto';
import { UpdateVarietyDto } from './dto/update-variety.dto';

@Injectable()
export class VarietiesService {
  constructor(private readonly firestore: FirestoreService) {}

  async findAll(category?: string) {
    let ref = this.firestore.collection('varieties') as any;
    if (category) {
      ref = ref.where('category', '==', category);
    }
    const snap = await ref.orderBy('subCategory').orderBy('name').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    await this.firestore.collection('varieties').doc(id).update({ ...dto });
    return { id, ...doc.data(), ...dto };
  }
}
