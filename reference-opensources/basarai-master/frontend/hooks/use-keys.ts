'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import { ProviderKey } from '@/types'

export function useKeys(brandId: string) {
  const [keys, setKeys] = useState<ProviderKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    if (!brandId) {
      setKeys([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<ProviderKey[]>(`/brands/${brandId}/keys`)
      setKeys(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  return { keys, loading, error, refetch: fetchKeys }
}
