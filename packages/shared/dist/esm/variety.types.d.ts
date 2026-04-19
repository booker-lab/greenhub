import type { Category, ColorOption, FragranceLevel } from './product.types.js';
export type CareLevel = 'easy' | 'normal' | 'hard';
export interface Variety {
    id: string;
    name: string;
    category: Category;
    subCategory: string;
    hasFragrance: boolean;
    fragranceLevel: FragranceLevel;
    bloomDuration: string;
    careLevel: CareLevel;
    typicalColors: ColorOption[];
    notes: string;
    createdAt: string;
}
//# sourceMappingURL=variety.types.d.ts.map