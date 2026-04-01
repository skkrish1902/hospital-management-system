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
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthUser) => void
  logout: () => void
  isAuthenticated: () => boolean
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

      setTokens: (access: string, refresh: string) => {
        const payload = parseJwt(access)
        set({
          accessToken: access,
          refreshToken: refresh,
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

      logout: () => set({ accessToken: null, refreshToken: null, user: null }),

      isAuthenticated: () => {
        const token = get().accessToken
        if (!token) return false
        const payload = parseJwt(token)
        const exp = payload.exp as number | undefined
        if (!exp) return false
        return Date.now() / 1000 < exp
      },
    }),
    {
      name: 'hospital-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
)
