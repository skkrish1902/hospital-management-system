import apiClient from './apiClient'
import type { NurseDepartment } from '@/types/common'

export const nurseDeptService = {
  list: () =>
    apiClient.get<NurseDepartment[]>('/nurse-departments').then(r => r.data),

  assign: (user_id: string, department_id: string) =>
    apiClient.post<NurseDepartment>('/nurse-departments', { user_id, department_id }).then(r => r.data),

  unassign: (userId: string) =>
    apiClient.delete(`/nurse-departments/${userId}`),

  myDepartment: () =>
    apiClient.get<NurseDepartment | null>('/nurse-departments/my').then(r => r.data),
}
