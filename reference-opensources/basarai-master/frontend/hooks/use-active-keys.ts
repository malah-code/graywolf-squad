'use client'

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import type { ProviderKey } from '@/types'

export interface ActiveKeys {
  openaiActive: boolean
  geminiActive: boolean
}

interface UseActiveKeysResult {
  activeKeys: ActiveKeys
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useActiveKeys(brandId: string): UseActiveKeysResult {
  const [activeKeys, setActiveKeys] = useState<ActiveKeys>({
    openaiActive: false,
    geminiActive: false,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const keys = await apiRequest<ProviderKey[]>(`/brands/${brandId}/keys`)
      setActiveKeys({
        openaiActive: keys.some(k => k.provider === 'openai' && k.is_active),
        geminiActive: keys.some(k => k.provider === 'gemini' && k.is_active),
      })
    } catch (err) {
      setActiveKeys({ openaiActive: false, geminiActive: false })
      setError(err instanceof Error ? err.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  return { activeKeys, loading, error, refetch: load }
}
