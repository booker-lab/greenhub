import type { Category, ColorOption, FragranceLevel, StemType } from './product.types.js'

export type CareLevel = 'easy' | 'normal' | 'hard'
export type FlowerSize = 'small' | 'medium' | 'large'  // 소륜 / 중륜 / 대륜
export type PlantSize = 'small' | 'medium' | 'large'   // 소형 / 중형 / 대형

export interface Variety {
  id: string
  name: string
  category: Category
  subCategory: string          // "phalaenopsis", "dendrobium" 등
  flowerSize: FlowerSize
  plantSize: PlantSize
  availableStemTypes: StemType[]
  hasFragrance: boolean
  fragranceLevel: FragranceLevel
  bloomDuration: string        // "60~90일"
  careLevel: CareLevel
  typicalColors: ColorOption[]
  notes: string
  createdAt: string            // ISO8601
}
