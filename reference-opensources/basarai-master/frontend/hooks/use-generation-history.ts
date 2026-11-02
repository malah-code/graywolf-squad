'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/api'
import type { GenerationHistoryItem, GenerationHistoryPage } from '@/types'

interface UseGenerationHistoryResult {
  items: GenerationHistoryItem[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasNext: boolean
  activeCursor: string | null
  loadMore: () => Promise<string | null>
  refetch: () => void
  removeItem: (id: string) => void
}

export function useGenerationHistory(
  brandId: string,
  provider?: string,
  status?: string,
  initialCursor?: string,
): UseGenerationHistoryResult {
  const [items, setItems] = useState<GenerationHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [activeCursor, setActiveCursor] = useState<string | null>(initialCursor ?? null)
  const fetchIdRef = useRef(0)

  const requestPage = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams()
      if (provider) params.set('provider', provider)
      if (status) params.set('status', status)
      if (cursor) params.set('cursor', cursor)

      const qs = params.toString()
      const endpoint = `/brands/${brandId}/generations${qs ? `?${qs}` : ''}`
      return apiRequest<GenerationHistoryPage>(endpoint)
    },
    [brandId, provider, status],
  )

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean, fetchId: number) => {
      try {
        if (append) {
          setLoadingMore(true)
        } else {
          setLoading(true)
          setItems([])
        }
        setError(null)

        const page = await requestPage(cursor)

        if (fetchIdRef.current !== fetchId) return false

        setItems((prev) => (append ? [...prev, ...page.items] : page.items))
        setNextCursor(page.next_cursor)
        if (append && cursor) setActiveCursor(cursor)
        return true
      } catch (err) {
        if (fetchIdRef.current !== fetchId) return false
        setError(err instanceof Error ? err.message : 'Failed to load history')
        return false
      } finally {
        if (fetchIdRef.current === fetchId) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [requestPage],
  )

  const loadPages = useCallback(
    async (cursorToRestore: string | null, fetchId: number) => {
      setLoading(true)
      setItems([])
      setError(null)
      try {
        const firstPage = await requestPage(null)
        if (fetchIdRef.current !== fetchId) return

        let loadedItems = firstPage.items
        let next = firstPage.next_cursor

        if (cursorToRestore) {
          let cursorFound = false
          let guard = 0
          while (next && next !== cursorToRestore && guard < 10) {
            const skippedPage = await requestPage(next)
            if (fetchIdRef.current !== fetchId) return
            loadedItems = [...loadedItems, ...skippedPage.items]
            next = skippedPage.next_cursor
            guard += 1
          }

          if (next === cursorToRestore) {
            const targetPage = await requestPage(cursorToRestore)
            if (fetchIdRef.current !== fetchId) return
            loadedItems = [...loadedItems, ...targetPage.items]
            next = targetPage.next_cursor
            cursorFound = true
          }

          if (!cursorFound && next !== cursorToRestore) {
            const targetPage = await requestPage(cursorToRestore)
            if (fetchIdRef.current !== fetchId) return
            loadedItems = targetPage.items
            next = targetPage.next_cursor
          }
        }

        setItems(loadedItems)
        setNextCursor(next)
      } catch (err) {
        if (fetchIdRef.current !== fetchId) return
        setError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        if (fetchIdRef.current === fetchId) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [requestPage],
  )

  const refetch = useCallback(() => {
    const id = ++fetchIdRef.current
    setNextCursor(null)
    loadPages(activeCursor, id)
  }, [activeCursor, loadPages])

  useEffect(() => {
    const id = ++fetchIdRef.current
    const cursorToRestore = initialCursor ?? null
    setNextCursor(null)
    setActiveCursor(cursorToRestore)
    loadPages(cursorToRestore, id)
  }, [initialCursor, loadPages])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return Promise.resolve(null)
    const id = ++fetchIdRef.current
    const cursorToLoad = nextCursor
    const loaded = await fetchPage(cursorToLoad, true, id)
    return loaded ? cursorToLoad : null
  }, [nextCursor, loadingMore, fetchPage])

  // Optimistically drop a single item (e.g. after a delete) without refetching.
  // Avoids re-walking cursors — which loses already-loaded pages when boundaries shift.
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  return {
    items,
    loading,
    loadingMore,
    error,
    hasNext: nextCursor !== null,
    activeCursor,
    loadMore,
    refetch,
    removeItem,
  }
}
