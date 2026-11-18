import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

type Health = { configured: boolean; model: string }

/**
 * 服务端连接状态行（vibe-study 托管模式）：
 * 展示"对话由服务端托管"的事实与上游健康状态（模型名来自 /api/health）。
 * 拉不到健康信息时展示离线态，不阻塞设置页其余部分。
 */
export function ServerStatusCell() {
  const t = useTranslate()
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/health')
      .then((res) => (res.ok ? (res.json() as Promise<Health>) : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        if (live) setHealth(body)
      })
      .catch(() => {
        if (live) setOffline(true)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className={styles.cell}>
      <div className={styles.text}>
        <div className={styles.label}>{t('serverManagedLabel')}</div>
        <div className={styles.description}>
          {offline
            ? t('serverManagedOffline')
            : health?.configured
              ? `${t('serverManagedStatus')} · ${health.model}`
              : t('serverManagedStatus')}
        </div>
      </div>
    </div>
  )
}
