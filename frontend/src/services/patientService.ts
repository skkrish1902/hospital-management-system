import apiClient from './apiClient'
import type { Patient, PatientHistoryItem } from '@/types/common'

export interface PatientCreate {
  first_name: string
  last_name: string
  dob?: string
  gender: string
  phone: string
  email?: string
  address?: string
  blood_group?: string
  insurance_provider?: string
  insurance_id?: string
}

export const patientService = {
  list: (q?: string) =>
    apiClient.get<Patient[]>('/patients', { params: q ? { q } : {} }).then(r => r.data),

  get: (id: string) =>
    apiClient.get<Patient>(`/patients/${id}`).then(r => r.data),

  create: (data: PatientCreate) =>
    apiClient.post<Patient>('/patients', data).then(r => r.data),

  update: (id: string, data: Partial<PatientCreate>) =>
    apiClient.patch<Patient>(`/patients/${id}`, data).then(r => r.data),

  getHistory: (id: string) =>
    apiClient.get<PatientHistoryItem[]>(`/patients/${id}/history`).then(r => r.data),
}
