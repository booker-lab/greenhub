'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ImageUpload from './ImageUpload'

// ── 상수 ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: 'cut_flower', label: '절화' },
  { value: 'orchid', label: '난' },
  { value: 'foliage', label: '관엽' },
] as const

const COLOR_OPTIONS = [
  '레드', '핑크', '화이트', '옐로우', '오렌지', '퍼플',
  '블루', '그린', '무늬', '브라운', '베이지', '블랙', '그레이',
] as const

const DELIVERY_SIZES = [
  { value: 'small', label: '소형' },
  { value: 'medium', label: '중형' },
  { value: 'large', label: '대형' },
] as const

const GROUP_DELIVERY_METHODS = [
  { value: 'direct', label: '꽃차 직배송' },
  { value: 'parcel', label: '택배' },
] as const

// ── 타입 ──────────────────────────────────────────────────────────
interface GroupConfigForm {
  minParticipants: string
  maxParticipants: string
  recruitDeadline: string   // YYYY-MM-DD
  groupDeliveryDate: string // YYYY-MM-DD
  groupDeliveryMethod: 'direct' | 'parcel'
}

export interface ProductFormData {
  name: string
  category: string
  colors: string[]
  deliverySize: string
  price: string
  description: string
  saleType: 'normal' | 'group'
  groupConfig: GroupConfigForm
  images: string[]
}

export interface ProductFormProps {
  mode: 'create' | 'edit'
  productId?: string
  storeId: string
  token: string
  initialData?: Partial<ProductFormData>
  onSuccess: () => void
}

// ── 기본값 ────────────────────────────────────────────────────────
function defaultForm(): ProductFormData {
  return {
    name: '',
    category: 'cut_flower',
    colors: [],
    deliverySize: 'small',
    price: '',
    description: '',
    saleType: 'normal',
    groupConfig: {
      minParticipants: '',
      maxParticipants: '',
      recruitDeadline: '',
      groupDeliveryDate: '',
      groupDeliveryMethod: 'direct',
    },
    images: [],
  }
}

// ── 컴포넌트 ──────────────────────────────────────────────────────
export default function ProductForm({
  mode,
  productId,
  storeId,
  token,
  initialData,
  onSuccess,
}: ProductFormProps) {
  const router = useRouter()
  const draftKey = mode === 'create' ? 'product_draft_new' : `product_draft_${productId}`

  const [form, setForm] = useState<ProductFormData>(() => {
    if (initialData) return { ...defaultForm(), ...initialData }
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) return JSON.parse(saved)
    } catch {}
    return defaultForm()
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)

  // edit 모드: 서버 데이터 로드 후 폼 갱신
  useEffect(() => {
    if (initialData?.name) {
      setForm({ ...defaultForm(), ...initialData })
    }
  }, [initialData?.name])

  // ── 상태 헬퍼 ──
  function set<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function setGroupConfig<K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) {
    setForm((prev) => ({ ...prev, groupConfig: { ...prev.groupConfig, [key]: value } }))
  }

  function toggleColor(color: string) {
    setForm((prev) => ({
      ...prev,
      colors: prev.colors.includes(color)
        ? prev.colors.filter((c) => c !== color)
        : [...prev.colors, color],
    }))
  }

  // ── 임시저장 ──
  function handleDraftSave() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(form))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch {}
  }

  // ── 유효성 검사 ──
  function validate(): string | null {
    if (!form.name.trim()) return '상품명을 입력해주세요.'
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0)
      return '올바른 가격을 입력해주세요.'
    if (form.colors.length === 0) return '색상을 하나 이상 선택해주세요.'
    if (form.saleType === 'group') {
      const g = form.groupConfig
      if (!g.minParticipants || !g.maxParticipants || !g.recruitDeadline || !g.groupDeliveryDate)
        return '공동구매 필수 정보를 모두 입력해주세요.'
      if (Number(g.minParticipants) > Number(g.maxParticipants))
        return '최소 인원은 최대 인원보다 클 수 없습니다.'
    }
    return null
  }

  // ── 제출 ──
  async function handleSubmit() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSubmitting(true)
    setError(null)

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim(),
      images: form.images,
      price: Number(form.price),
      category: form.category,
      colors: form.colors,
      saleType: form.saleType,
      deliverySize: form.deliverySize,
    }

    if (form.saleType === 'group') {
      body.groupConfig = {
        minParticipants: Number(form.groupConfig.minParticipants),
        maxParticipants: Number(form.groupConfig.maxParticipants),
        recruitDeadline: form.groupConfig.recruitDeadline,
        groupDeliveryDate: form.groupConfig.groupDeliveryDate,
        groupDeliveryMethod: form.groupConfig.groupDeliveryMethod,
        deliveryFeeDiscount: 0,
      }
    }

    try {
      const url =
        mode === 'create'
          ? `/stores/${storeId}/products`
          : `/stores/${storeId}/products/${productId}`
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `서버 오류 (${res.status})`)
      }
      localStorage.removeItem(draftKey)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-gray-500 p-1 -ml-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">
              {mode === 'create' ? '상품 등록' : '상품 수정'}
            </h1>
          </div>
          <button
            onClick={handleDraftSave}
            className={`text-sm font-medium transition-colors ${draftSaved ? 'text-green-primary' : 'text-gray-500'}`}
          >
            {draftSaved ? '저장됨 ✓' : '임시저장'}
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 pb-24 space-y-3">

        {/* 이미지 업로드 */}
        <ImageUpload
          storeId={storeId}
          images={form.images}
          onChange={(images) => set('images', images)}
          onError={(msg) => setError(msg)}
        />

        {/* 상품명 */}
        <input
          type="text"
          placeholder="상품명"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className="w-full bg-white rounded-2xl shadow-sm px-4 py-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-primary"
        />

        {/* 카테고리 */}
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">카테고리</p>
          <div className="flex gap-2">
            {CATEGORIES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => set('category', value)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  form.category === value
                    ? 'border-green-primary bg-green-bg text-green-primary'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 색상 */}
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            색상 <span className="text-gray-400">(복수 선택 가능)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                onClick={() => toggleColor(color)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  form.colors.includes(color)
                    ? 'border-green-primary bg-green-bg text-green-primary'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {color}
              </button>
            ))}
          </div>
        </section>

        {/* 배송 사이즈 */}
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">배송 사이즈</p>
          <div className="flex gap-2">
            {DELIVERY_SIZES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => set('deliverySize', value)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  form.deliverySize === value
                    ? 'border-green-primary bg-green-bg text-green-primary'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 가격 */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₩</span>
          <input
            type="number"
            placeholder="가격"
            min={0}
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
            className="w-full bg-white rounded-2xl shadow-sm pl-8 pr-4 py-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-primary"
          />
        </div>

        {/* 상세 설명 */}
        <textarea
          placeholder="상품 상세 설명"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          className="w-full bg-white rounded-2xl shadow-sm px-4 py-3.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-green-primary"
        />

        {/* 판매 방식 + 공동구매 조건부 필드 */}
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">판매 방식</p>
          <div className="flex gap-6">
            {(['normal', 'group'] as const).map((type) => (
              <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="saleType"
                  checked={form.saleType === type}
                  onChange={() => set('saleType', type)}
                  className="accent-green-primary w-4 h-4"
                />
                <span className="text-sm text-gray-700">
                  {type === 'normal' ? '일반 판매' : '공동구매'}
                </span>
              </label>
            ))}
          </div>

          {/* 공동구매 전용 필드 — slide-down */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              form.saleType === 'group' ? 'max-h-[400px] mt-4' : 'max-h-0'
            }`}
          >
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">최소 인원</p>
                  <input
                    type="number"
                    placeholder="2"
                    min={2}
                    value={form.groupConfig.minParticipants}
                    onChange={(e) => setGroupConfig('minParticipants', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-primary"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">최대 인원</p>
                  <input
                    type="number"
                    placeholder="10"
                    min={2}
                    value={form.groupConfig.maxParticipants}
                    onChange={(e) => setGroupConfig('maxParticipants', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-primary"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">모집 마감일</p>
                <input
                  type="date"
                  value={form.groupConfig.recruitDeadline}
                  onChange={(e) => setGroupConfig('recruitDeadline', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-primary"
                />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">배송 예정일</p>
                <input
                  type="date"
                  value={form.groupConfig.groupDeliveryDate}
                  onChange={(e) => setGroupConfig('groupDeliveryDate', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-primary"
                />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">배송 수단</p>
                <div className="flex gap-2">
                  {GROUP_DELIVERY_METHODS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGroupConfig('groupDeliveryMethod', value as 'direct' | 'parcel')}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        form.groupConfig.groupDeliveryMethod === value
                          ? 'border-green-primary bg-green-bg text-green-primary'
                          : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 오류 */}
        {error && <p className="text-sm text-red-500 text-center px-2">{error}</p>}

        {/* 등록/저장 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-green-primary text-white text-sm font-semibold py-4 rounded-2xl disabled:opacity-50 mt-2"
        >
          {submitting ? '처리 중...' : mode === 'create' ? '등록하기' : '저장하기'}
        </button>
      </div>
    </main>
  )
}
