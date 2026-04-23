import type { Category, ColorOption, FragranceLevel, StemType, CareLevel } from './product.types.js';
export type FlowerSize = 'small' | 'medium' | 'large';
export type PlantSize = 'small' | 'medium' | 'large';
export interface Variety {
    id: string;
    name: string;
    category: Category;
    subCategory: string;
    flowerSize: FlowerSize;
    plantSize: PlantSize;
    availableStemTypes: StemType[];
    hasFragrance: boolean;
    fragranceLevel: FragranceLevel;
    bloomDuration: string;
    careLevel: CareLevel;
    typicalColors: ColorOption[];
    notes: string;
    createdAt: string;
}
//# sourceMappingURL=variety.types.d.ts.map