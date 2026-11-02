'use client'

import { useRouter } from 'next/navigation'
import { BrandListItem } from '@/types'

interface BrandSelectorProps {
  brands: BrandListItem[]
  currentBrandId?: string
}

export function BrandSelector({ brands, currentBrandId }: BrandSelectorProps) {
  const router = useRouter()

  return (
    <select
      value={currentBrandId || ''}
      onChange={(e) => {
        if (e.target.value) {
          router.push(`/${e.target.value}`)
        }
      }}
      className="rounded-md border bg-white px-3 py-1.5 text-sm"
    >
      <option value="">Select a brand</option>
      {brands.map((brand) => (
        <option key={brand.id} value={brand.id}>
          {brand.name}
        </option>
      ))}
    </select>
  )
}
