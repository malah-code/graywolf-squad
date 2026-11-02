'use client'

import { useCallback } from 'react'
import { apiRequest } from '@/lib/api'

export interface DeleteGenerationOutcome {
  ok: boolean
  message?: string
}

export function useDeleteGeneration(brandId: string) {
  const deleteGeneration = useCallback(
    async (generationId: string): Promise<DeleteGenerationOutcome> => {
      try {
        await apiRequest(`/brands/${brandId}/generations/${generationId}`, {
          method: 'DELETE',
        })
        return { ok: true }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete. Please try again.'
        return { ok: false, message }
      }
    },
    [brandId],
  )

  return { deleteGeneration }
}
