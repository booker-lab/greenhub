'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useAddresses } from '@/hooks/useAddresses'
import type { SavedAddress } from '@greenhub/shared'
import type { AddressFormData } from '@/hooks/useAddresses'

// ── 인라인 스타일 상수 ─────────────────────────────────────────
const CARD_STYLE: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: '10px',
  padding: '14px 16px',
}

const BTN_SM: React.CSSProperties = {
  fontSize: '12px',
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid #ddd',
  background: 'none',
  cursor: 'pointer',
  color: '#555',
}

const BTN_DANGER: React.CSSProperties = { ...BTN_SM, color: '#C62828', borderColor: '#C62828' }

const BTN_PRIMARY: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: '10px',
  border: 'none',
  background: '#2D6A4F',
  color: '#fff',
  fontSize: '15px',
  fontWeight: '700',
  cursor: 'pointer',
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
}

// ── 빈 폼 ─────────────────────────────────────────────────────
const EMPTY_FORM: AddressFormData = { label: '', address: '', addressDetail: '', zipCode: '' }

// ── AddressCard ────────────────────────────────────────────────
function AddressCard({
  addr,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  addr: SavedAddress
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div style={CARD_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontWeight: '700', fontSize: '14px' }}>{addr.label}</span>
            {addr.isDefault && (
              <span
                style={{
                  fontSize: '11px',
                  color: '#2D6A4F',
                  background: '#2D6A4F18',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontWeight: '600',
                }}
              >
                기본
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: '#444', lineHeight: '1.5' }}>
            {addr.address}
            {addr.addressDetail ? ` ${addr.addressDetail}` : ''}
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{addr.zipCode}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
        {!addr.isDefault && (
          <button style={BTN_SM} onClick={onSetDefault}>
            기본으로 설정
          </button>
        )}
        <button style={BTN_SM} onClick={onEdit}>
          수정
        </button>
        <button style={BTN_DANGER} onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  )
}

// ── AddressFormModal ───────────────────────────────────────────
function AddressFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial: AddressFormData
  onSave: (data: AddressFormData) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<AddressFormData>(initial)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  function set(key: keyof AddressFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim() || !form.address.trim() || !form.zipCode.trim()) {
      setFieldError('이름, 주소, 우편번호는 필수입니다.')
      return
    }
    setSaving(true)
    setFieldError(null)
    try {
      await onSave(form)
      onClose()
    } catch (e: unknown) {
      setFieldError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          width: '100%',
          maxWidth: '480px',
          margin: '0 auto',
          borderRadius: '16px 16px 0 0',
          padding: '24px 20px 36px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ fontSize: '17px', fontWeight: '700' }}>
            {initial.label ? '배송지 수정' : '배송지 추가'}
          </h2>
          <button
            onClick={onClose}
            style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              이름 *
            </label>
            <input
              style={INPUT_STYLE}
              placeholder="예: 집, 회사"
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              우편번호 *
            </label>
            <input
              style={INPUT_STYLE}
              placeholder="예: 06232"
              value={form.zipCode}
              onChange={(e) => set('zipCode', e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              주소 *
            </label>
            <input
              style={INPUT_STYLE}
              placeholder="예: 서울 강남구 테헤란로 152"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              상세 주소
            </label>
            <input
              style={INPUT_STYLE}
              placeholder="예: 5층 502호"
              value={form.addressDetail}
              onChange={(e) => set('addressDetail', e.target.value)}
            />
          </div>

          {fieldError && (
            <p style={{ fontSize: '13px', color: '#C62828', margin: 0 }}>{fieldError}</p>
          )}

          <button style={{ ...BTN_PRIMARY, marginTop: '4px', opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 메인 클라이언트 ────────────────────────────────────────────
export default function AddressesClient() {
  const { status } = useSession()
  const router = useRouter()
  const { addresses, loading, error, addAddress, updateAddress, deleteAddress, setDefaultAddress } =
    useAddresses()

  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; addr: SavedAddress } | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  async function handleDelete(id: string) {
    if (!confirm('이 배송지를 삭제할까요?')) return
    setActionError(null)
    try {
      await deleteAddress(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    }
  }

  async function handleSetDefault(id: string) {
    setActionError(null)
    try {
      await setDefaultAddress(id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    }
  }

  function getInitialForm(addr?: SavedAddress): AddressFormData {
    if (!addr) return EMPTY_FORM
    return { label: addr.label, address: addr.address, addressDetail: addr.addressDetail, zipCode: addr.zipCode }
  }

  return (
    <main style={{ padding: '24px 16px 80px', maxWidth: '480px', margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#333', padding: '0 4px 0 0' }}
        >
          ←
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: '700' }}>배송지 관리</h1>
      </div>

      {/* 오류 */}
      {(error || actionError) && (
        <div
          style={{
            background: '#FFF3F3',
            border: '1px solid #F5C6C6',
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '13px',
            color: '#C62828',
            marginBottom: '16px',
          }}
        >
          {error ?? actionError}
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: '14px' }}>
          불러오는 중...
        </div>
      ) : addresses.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '48px 0', fontSize: '14px' }}>
          등록된 배송지가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          {addresses.map((addr) => (
            <AddressCard
              key={addr.id}
              addr={addr}
              onEdit={() => setModal({ mode: 'edit', addr })}
              onDelete={() => handleDelete(addr.id)}
              onSetDefault={() => handleSetDefault(addr.id)}
            />
          ))}
        </div>
      )}

      {/* 추가 버튼 */}
      <button style={BTN_PRIMARY} onClick={() => setModal({ mode: 'add' })}>
        + 배송지 추가
      </button>

      {/* 모달 */}
      {modal && (
        <AddressFormModal
          initial={getInitialForm(modal.mode === 'edit' ? modal.addr : undefined)}
          onSave={
            modal.mode === 'add'
              ? addAddress
              : (data) => updateAddress(modal.addr.id, data)
          }
          onClose={() => setModal(null)}
        />
      )}
    </main>
  )
}
