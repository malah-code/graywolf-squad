'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, ApiError } from '@/lib/api'
import type { GenerationDetail } from '@/types'

interface UseGenerationDetailResult {
  detail: GenerationDetail | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useGenerationDetail(brandId: string, generationId: string): UseGenerationDetailResult {
  const [detail, setDetail] = useState<GenerationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const requestSeqRef = useRef(0)

  const fetchDetail = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current
    try {
      setLoading(true)
      setError(null)
      setNotFound(false)
      const data = await apiRequest<GenerationDetail>(
        `/brands/${brandId}/generations/${generationId}`,
      )
      if (requestSeq !== requestSeqRef.current) return
      setDetail(data)
    } catch (err) {
      if (requestSeq !== requestSeqRef.current) return
      if (err instanceof ApiError && err.code === 'GENERATION_NOT_FOUND') {
        setDetail(null)
        setNotFound(true)
      } else {
        setDetail(null)
        setError(err instanceof Error ? err.message : 'Failed to load generation')
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false)
      }
    }
  }, [brandId, generationId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  return { detail, loading, error, notFound }
}
