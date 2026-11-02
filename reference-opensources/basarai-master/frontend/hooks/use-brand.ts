'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import { Brand } from '@/types'

export function useBrand(brandId: string) {
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBrand = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Brand>(`/brands/${brandId}`)
      setBrand(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brand')
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    fetchBrand()
  }, [fetchBrand])

  const mutate = useCallback((updatedBrand: Brand) => {
    setBrand(updatedBrand)
  }, [])

  return { brand, loading, error, mutate, refetch: fetchBrand }
}
