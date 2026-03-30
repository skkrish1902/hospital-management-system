import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/features/auth/authStore'

type MessageHandler = (data: unknown) => void

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_ATTEMPTS = 10

/**
 * useWebSocket
 *
 * Connects to /ws/{tenantSchema}/{channel}?token=<jwt>
 * Automatically reconnects with a fixed delay on unexpected close.
 */
export function useWebSocket(channel: string, onMessage: MessageHandler) {
  const { accessToken, user } = useAuthStore()
  const wsRef = useRef<WebSocket | null>(null)
  const attemptsRef = useRef(0)
  const unmountedRef = useRef(false)

  const connect = useCallback(() => {
    if (!accessToken || !user?.tenantSchema) return
    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/ws/${user.tenantSchema}/${channel}?token=${accessToken}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        onMessage(data)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = (event) => {
      if (unmountedRef.current) return
      if (event.wasClean) return // closed intentionally
      attemptsRef.current += 1
      setTimeout(connect, RECONNECT_DELAY_MS)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [accessToken, user?.tenantSchema, channel, onMessage])

  useEffect(() => {
    unmountedRef.current = false
    attemptsRef.current = 0
    connect()

    return () => {
      unmountedRef.current = true
      wsRef.current?.close(1000, 'Component unmounted')
    }
  }, [connect])
}
