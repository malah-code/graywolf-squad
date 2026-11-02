'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import { BrandKit, KitAnswers } from '@/types'

export function useKit(brandId: string) {
  const [kit, setKit] = useState<BrandKit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchKit = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<BrandKit>(`/brands/${brandId}/kit`)
      setKit(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brand kit')
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    fetchKit()
  }, [fetchKit])

  return { kit, loading, error, refetch: fetchKit }
}

export async function saveKit(brandId: string, answers: KitAnswers): Promise<BrandKit> {
  return apiRequest<BrandKit>(`/brands/${brandId}/kit`, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  })
}
