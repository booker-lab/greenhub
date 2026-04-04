'use client'

import { SessionProvider } from 'next-auth/react'
import { MantineProvider } from '@mantine/core'
import { theme } from '@greenhub/ui'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme}>
      <SessionProvider>{children}</SessionProvider>
    </MantineProvider>
  )
}
