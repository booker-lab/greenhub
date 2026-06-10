import type { SelectionForm } from './TouchSelector';

export const CATEGORIES = [
  { value: 'cut_flower', label: '절화' },
  { value: 'orchid', label: '난' },
  { value: 'foliage', label: '관엽' },
] as const;

export const DELIVERY_SIZES = [
  { value: 'small', label: '소형' },
  { value: 'medium', label: '중형' },
  { value: 'large', label: '대형' },
] as const;

export const STEP_LABELS = ['사진·품종', '터치 선택', '판매자 메모', 'AI 미리보기', '가격·배송'];

export interface GroupConfigForm {
  minQuantity: string;
  targetQuantity: string;
  maxPerPerson: string;
  recruitDeadline: string;
  groupDeliveryDate: string;
  groupDeliveryMethod: 'direct' | 'parcel';
}

export interface ContentForm {
  headline: string;
  description: string;
  isEditedByUser: boolean;
}

export interface ProductFormData {
  name: string;
  category: string;
  deliverySize: string;
  price: string;
  saleType: 'normal' | 'group';
  groupConfig: GroupConfigForm;
  images: string[];
  varietyId: string;
  selection: SelectionForm;
  sellerNote: string;
  content: ContentForm;
  sellerOverride: boolean;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  productId?: string;
  storeId: string;
  token: string;
  initialData?: Partial<ProductFormData>;
  onSuccess: () => void;
}

export function defaultForm(): ProductFormData {
  return {
    name: '',
    category: 'cut_flower',
    deliverySize: 'small',
    price: '',
    saleType: 'normal',
    groupConfig: {
      minQuantity: '10',
      targetQuantity: '50',
      maxPerPerson: '5',
      recruitDeadline: '',
      groupDeliveryDate: '',
      groupDeliveryMethod: 'direct',
    },
    images: [],
    varietyId: '',
    selection: {
      colors: [],
      stemType: '외대',
      fragrance: 'none',
      bloomCondition: 'half',
      careLevel: 'normal',
    },
    sellerNote: '',
    content: { headline: '', description: '', isEditedByUser: false },
    sellerOverride: false,
  };
}
