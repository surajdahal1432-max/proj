import { applyImageStamps, blobFromBytes } from './pdf'

/**
 * Shared signature placement model.
 *
 * The same normalized rectangle drives both the on-screen preview and the
 * exported PDF stamp, so what the user positions is exactly what is embedded.
 * All values are 0-1 with a top-left origin, matching `applyImageStamps`.
 */
export interface SignaturePlacement {
  /** Zero-based PDF page index. */
  page: number
  x: number
  y: number
  /** Width as a fraction of the page width. */
  width: number
}

export interface PageSize {
  width: number
  height: number
}

/** Height fraction that keeps the image's intrinsic aspect ratio intact. */
export function heightRatioFor(placement: SignaturePlacement, aspect: number, page: PageSize): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 3.4
  const pageWidth = page.width > 0 ? page.width : 595
  const pageHeight = page.height > 0 ? page.height : 842
  return (placement.width * pageWidth) / (safeAspect * pageHeight)
}

/** Keeps the stamp fully inside the page after a drag or resize. */
export function clampPlacement(placement: SignaturePlacement, heightRatio: number): SignaturePlacement {
  const width = Math.min(0.98, Math.max(0.04, placement.width))
  const height = Math.min(1, Math.max(0, heightRatio))
  return {
    page: placement.page,
    width,
    x: Math.min(1 - width, Math.max(0, placement.x)),
    y: Math.min(1 - height, Math.max(0, placement.y)),
  }
}

/**
 * Embeds the signature into the PDF at the exact placement shown in the
 * preview. Returns a new PDF blob; the original document is untouched.
 */
export async function signPdfWithPlacement(
  file: File,
  placement: SignaturePlacement,
  pngBytes: Uint8Array,
  page: PageSize,
  aspect: number,
): Promise<Blob> {
  // Clamp the width first so the aspect ratio survives an out-of-range value.
  const width = Math.min(0.98, Math.max(0.04, placement.width))
  const height = heightRatioFor({ ...placement, width }, aspect, page)
  const safe = clampPlacement({ ...placement, width }, height)
  return applyImageStamps(file, [
    { page: safe.page, x: safe.x, y: safe.y, width: safe.width, height, pngBytes },
  ])
}

/** Intrinsic aspect ratio (width / height) of a PNG or JPEG signature image. */
export async function imageAspect(bytes: Uint8Array): Promise<number> {
  try {
    const bitmap = await createImageBitmap(blobFromBytes(bytes, 'image/png'))
    const aspect = bitmap.width / bitmap.height
    bitmap.close()
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 3.4
  } catch {
    return 3.4
  }
}

/**
 * Normalizes an uploaded signature image to PNG bytes so it can be embedded
 * with pdf-lib regardless of whether the user supplied PNG, JPEG or WebP.
 */
export async function imageFileToPngBytes(file: File): Promise<Uint8Array> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a PNG, JPEG or WebP image of your signature.')
  }
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Your browser could not prepare this image.')
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('Your browser could not convert this image to PNG.'))
    }, 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
