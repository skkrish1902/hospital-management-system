import apiClient from './apiClient'
import type { LabOrder, LabResult } from '@/types/common'

export const labService = {
  listOrders: (params?: { status?: string }) =>
    apiClient.get<LabOrder[]>('/lab', { params }).then(r => r.data),

  updateStatus: (orderId: string, new_status: string) =>
    apiClient.patch<LabOrder>(`/lab/${orderId}/status`, null, { params: { new_status } }).then(r => r.data),

  enterResults: (orderId: string, results: Record<string, string>) =>
    apiClient.post<LabResult>(`/lab/${orderId}/results`, { results }).then(r => r.data),

  getResults: (orderId: string) =>
    apiClient.get<LabResult>(`/lab/${orderId}/results`).then(r => r.data),
}
