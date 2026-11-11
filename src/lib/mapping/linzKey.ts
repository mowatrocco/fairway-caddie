// LINZ Basemaps key handling. The key is kept on the phone only (never in the code
// or in backups). Standard keys expire after 90 days; developer keys don't.

export const LINZ_ATTRIBUTION =
  '© <a href="https://www.linz.govt.nz/linz-copyright">LINZ CC BY 4.0</a> © <a href="https://www.linz.govt.nz/data/linz-data/linz-basemaps/data-attribution">Imagery Basemap contributors</a>'

export type KeyParse = { ok: true; key: string } | { ok: false; error: string }

/** Accepts the bare key, or a whole LINZ tile/WMTS address with ?api=… in it. */
export function parseLinzKey(input: string): KeyParse {
  const text = input.trim()
  if (text === '') return { ok: false, error: 'Paste the key or the map address from LINZ Basemaps.' }
  const fromUrl = /[?&]api=([A-Za-z0-9_-]+)/.exec(text)
  const key = fromUrl ? fromUrl[1] : text
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(key)) {
    return {
      ok: false,
      error: "That doesn't look like a LINZ key. Copy the XYZ or WMTS address from the LINZ Basemaps menu and paste it here.",
    }
  }
  return { ok: true, key }
}

export function linzAerialTileUrl(key: string): string {
  return `https://basemaps.linz.govt.nz/v1/tiles/aerial/3857/{z}/{x}/{y}.webp?api=${encodeURIComponent(key)}`
}
