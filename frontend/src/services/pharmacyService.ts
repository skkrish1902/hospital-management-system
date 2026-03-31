import apiClient from './apiClient'
import type { PharmacyQueueItem } from '@/types/common'

export const pharmacyService = {
  list: (params?: { status?: string }) =>
    apiClient.get<PharmacyQueueItem[]>('/pharmacy', { params }).then(r => r.data),

  updateStatus: (id: string, status: string, notes?: string) =>
    apiClient.patch<PharmacyQueueItem>(`/pharmacy/${id}/status`, { status, notes }).then(r => r.data),
}
