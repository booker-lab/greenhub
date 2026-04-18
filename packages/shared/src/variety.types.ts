import type { Category, ColorOption, FragranceLevel } from './product.types.js'

export type CareLevel = 'easy' | 'normal' | 'hard'

export interface Variety {
  id: string
  name: string
  category: Category
  subCategory: string          // "phalaenopsis", "dendrobium" 등
  hasFragrance: boolean
  fragranceLevel: FragranceLevel
  bloomDuration: string        // "60~90일"
  careLevel: CareLevel
  typicalColors: ColorOption[]
  notes: string
  createdAt: string            // ISO8601
}
