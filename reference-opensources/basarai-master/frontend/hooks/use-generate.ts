'use client'

import { useState } from 'react'
import { apiRequest, ApiError } from '@/lib/api'
import type { GenerateRequest, GenerationResponse } from '@/types'

export type GenerateState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; result: GenerationResponse }
  | { status: 'error'; code: string; message: string }

interface UseGenerateResult {
  state: GenerateState
  generate: (body: GenerateRequest) => Promise<void>
  reset: () => void
}

export function useGenerate(brandId: string): UseGenerateResult {
  const [state, setState] = useState<GenerateState>({ status: 'idle' })

  async function generate(body: GenerateRequest) {
    setState({ status: 'submitting' })
    try {
      const result = await apiRequest<GenerationResponse>(
        `/brands/${brandId}/generate`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      setState({ status: 'success', result })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setState({ status: 'error', code, message })
    }
  }

  function reset() {
    setState({ status: 'idle' })
  }

  return { state, generate, reset }
}
