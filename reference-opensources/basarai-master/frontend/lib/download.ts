export async function downloadImageFile(imageUrl: string, filename: string): Promise<void> {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('Failed to fetch image')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revocation: revoking synchronously after click() can abort the download
  // on Firefox/Safari before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
