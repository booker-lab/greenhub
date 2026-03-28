'use client'

import { useRef, useState } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'

interface ImageUploadProps {
  storeId: string
  images: string[]
  onChange: (images: string[]) => void
  onError: (msg: string) => void
}

export default function ImageUpload({ storeId, images, onChange, onError }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || images.length >= 5) return
    const toUpload = Array.from(files).slice(0, 5 - images.length)
    setUploading(true)
    try {
      const urls = await Promise.all(
        toUpload.map(async (file) => {
          const r = storageRef(storage, `products/${storeId}/${Date.now()}_${file.name}`)
          await uploadBytes(r, file)
          return getDownloadURL(r)
        }),
      )
      onChange([...images, ...urls])
    } catch {
      onError('이미지 업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }

  function remove(idx: number) {
    onChange(images.filter((_, i) => i !== idx))
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm p-4">
      <p className="text-xs font-medium text-gray-500 mb-2">
        사진 <span className="text-gray-400">({images.length}/5 · 첫 번째가 대표 사진)</span>
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((url, idx) => (
          <div key={url} className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-gray-100">
            <img src={url} alt="" className="w-full h-full object-cover" />
            {idx === 0 && (
              <span className="absolute bottom-1 left-1 bg-green-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                대표
              </span>
            )}
            <span className="absolute top-1 left-1 bg-black/50 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {idx + 1}
            </span>
            <button
              onClick={() => remove(idx)}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-[11px]"
            >
              ✕
            </button>
          </div>
        ))}
        {images.length < 5 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 gap-1 text-xs"
          >
            {uploading ? (
              <div className="w-5 h-5 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>사진 추가</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </section>
  )
}
