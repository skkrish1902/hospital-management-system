import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  id: string
  email: string
  fullName: string
  role: string
  tenantSchema: string
  hospitalName: string
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
  sessionExpired: boolean
  /**
   * Feature keys enabled for this tenant, as embedded in the JWT.
   * null  = old token (pre-Phase 2) — treat as full access during transition.
   * []    = new token, tenant has no features enabled.
   * [...] = new token, specific enabled features.
   */
  features: string[] | null
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthUser) => void
  logout: () => void
  markSessionExpired: () => void
  isAuthenticated: () => boolean
  /**
   * Returns true if the tenant has the given feature enabled.
   * Always returns true when features is null (old token / transition window).
   */
  hasFeature: (key: string) => boolean
}

function parseJwt(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return {}
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      sessionExpired: false,
      features: null,

      setTokens: (access: string, refresh: string) => {
        const payload = parseJwt(access)
        // features may be absent in old tokens — keep null so hasFeature allows all
        const features = Array.isArray(payload.features)
          ? (payload.features as string[])
          : null
        set({
          accessToken: access,
          refreshToken: refresh,
          features,
          user: {
            id: payload.sub as string,
            email: '',
            fullName: (payload.full_name as string) ?? '',
            role: (payload.role as string) ?? '',
            tenantSchema: (payload.tenant_schema as string) ?? '',
            hospitalName: (payload.hospital_name as string) ?? '',
          },
        })
      },

      setUser: (user: AuthUser) => set({ user }),

      logout: () => set({ accessToken: null, refreshToken: null, user: null, sessionExpired: false, features: null }),

      markSessionExpired: () => set({ accessToken: null, refreshToken: null, user: null, sessionExpired: true, features: null }),

      isAuthenticated: () => {
        const token = get().accessToken
        if (!token) return false
        const payload = parseJwt(token)
        const exp = payload.exp as number | undefined
        if (!exp) return false
        return Date.now() / 1000 < exp
      },

      hasFeature: (key: string) => {
        const features = get().features
        // null = old token (pre-entitlements) → allow everything during transition
        if (features === null) return true
        return features.includes(key)
      },
    }),
    {
      name: 'hospital-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        features: state.features,
        // sessionExpired is intentionally not persisted — always starts false on page load
      }),
    },
  ),
)
