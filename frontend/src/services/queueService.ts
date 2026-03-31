import apiClient from './apiClient'
import type { QueueToken } from '@/types/common'

export interface QueueTokenCreate {
  patient_id: string
  appointment_id?: string
  department_id?: string
  queue_type?: string
  priority?: string
}

export const queueService = {
  list: (params?: { queue_type?: string; department_id?: string; status?: string }) =>
    apiClient.get<QueueToken[]>('/queue', { params }).then(r => r.data),

  issue: (data: QueueTokenCreate) =>
    apiClient.post<QueueToken>('/queue', data).then(r => r.data),

  updateStatus: (tokenId: string, status: string) =>
    apiClient.patch<QueueToken>(`/queue/${tokenId}/status`, { status }).then(r => r.data),
}
