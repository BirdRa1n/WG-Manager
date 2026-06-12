import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'

const GITHUB_REPO = 'BirdRa1n/WG-Manager'
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hora
const STORAGE_KEY = 'wgm_last_update_check'

export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  releaseUrl: string
  releaseName: string
  publishedAt: string
}

export function useUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async (force = false) => {
    const now = Date.now()
    const last = parseInt(localStorage.getItem(STORAGE_KEY) || '0')

    if (!force && now - last < CHECK_INTERVAL_MS) return

    setChecking(true)
    try {
      const [versionRes, ghRes] = await Promise.all([
        api.getVersion(),
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`).then(r => r.json()),
      ])

      const current = versionRes.version
      const latest = ghRes.tag_name?.replace(/^v/, '') ?? current

      setUpdateInfo({
        current,
        latest,
        hasUpdate: latest !== current,
        releaseUrl: ghRes.html_url ?? `https://github.com/${GITHUB_REPO}/releases`,
        releaseName: ghRes.name ?? latest,
        publishedAt: ghRes.published_at ?? '',
      })

      localStorage.setItem(STORAGE_KEY, String(now))
    } catch {
      // silencia erros de rede — não bloqueia o app
    }
    setChecking(false)
  }, [])

  useEffect(() => {
    check()
    const iv = setInterval(() => check(), CHECK_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [check])

  return { updateInfo, checking, checkNow: () => check(true) }
}
