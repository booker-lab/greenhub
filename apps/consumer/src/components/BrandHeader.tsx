'use client'

import { useEffect, useState } from 'react'
import { Box, Text } from '@mantine/core'
import Image from 'next/image'

export default function BrandHeader() {
  const [showLogo, setShowLogo] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setShowLogo((prev) => !prev)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <Box mb="lg" style={{ position: 'relative', height: 56 }}>
      {/* 로고 */}
      <Box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          opacity: showLogo ? 1 : 0,
          transition: 'opacity 0.8s ease-in-out',
        }}
      >
        <Image
          src="/logo.svg"
          alt="Green Love"
          width={160}
          height={44}
          priority
          style={{ objectFit: 'contain', objectPosition: 'left' }}
        />
      </Box>

      {/* 텍스트 */}
      <Box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          opacity: showLogo ? 0 : 1,
          transition: 'opacity 0.8s ease-in-out',
        }}
      >
        <Box style={{ fontSize: 26, fontWeight: 800, color: 'var(--green-primary)', lineHeight: 1.2 }}>
          Green Love
        </Box>
        <Text size="sm" c="gray.6" mt={4}>신선한 화훼, 직거래로 만나세요.</Text>
      </Box>
    </Box>
  )
}
