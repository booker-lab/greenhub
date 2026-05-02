import { Injectable } from '@nestjs/common';
import type { Selection, Variety } from '@greenhub/shared';

export interface ConflictWarning {
  field: string;
  message: string;
  suggestion: string;
}

@Injectable()
export class GuardrailValidatorService {
  validate(sellerNote: string, selection: Selection, variety: Variety | null): ConflictWarning[] {
    if (!variety) return [];

    const warnings: ConflictWarning[] = [];
    const note = sellerNote.toLowerCase();

    // 향기 충돌 감지
    if (!variety.hasFragrance && this.mentionsFragrance(note)) {
      warnings.push({
        field: 'fragrance',
        message: `이 품종(${variety.name})은 향기가 없는 것으로 알려져 있어요.`,
        suggestion: '향기 관련 내용을 빼고, 꽃의 싱싱함이나 색감을 강조해드릴까요?',
      });
    }

    // 터치 선택 향기와 가드레일 불일치
    if (!variety.hasFragrance && selection.fragrance !== 'none') {
      warnings.push({
        field: 'selection.fragrance',
        message: `이 품종(${variety.name})은 향기가 없는 것으로 알려져 있어요.`,
        suggestion: '향기 선택을 "없음"으로 변경하시겠어요?',
      });
    }

    // 색상 충돌 감지 (typicalColors에 없는 색상 선택 시 경고)
    if (variety.typicalColors.length > 0) {
      const unusualColors = selection.colors.filter(
        (c) => !variety.typicalColors.includes(c as any),
      );
      if (unusualColors.length > 0) {
        warnings.push({
          field: 'selection.colors',
          message: `선택하신 색상(${unusualColors.join(', ')})은 이 품종에서 보기 드문 색상이에요.`,
          suggestion: '희귀 변이종이라면 그대로 등록하셔도 됩니다.',
        });
      }
    }

    return warnings;
  }

  private mentionsFragrance(text: string): boolean {
    const keywords = ['향기', '향', '향내', '냄새', '아로마', '향긋'];
    return keywords.some((k) => text.includes(k));
  }
}
