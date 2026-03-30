import apiClient from './apiClient'
import type { Prescription, Invoice } from '@/types/common'

export interface MedicineItemCreate {
  name: string
  dose: string
  frequency: string
  duration: string
  route: string
  notes?: string
}

export interface PrescriptionCreate {
  visit_id: string
  medicines?: MedicineItemCreate[]
  instructions?: string
}

export interface InvoiceCreate {
  visit_id: string
  line_items?: { description: string; amount: number }[]
  discount?: number
  tax?: number
}

export const prescriptionService = {
  create: (data: PrescriptionCreate) =>
    apiClient.post<Prescription>('/prescriptions', data).then(r => r.data),

  update: (visitId: string, data: Omit<PrescriptionCreate, 'visit_id'>) =>
    apiClient.patch<Prescription>(`/prescriptions/${visitId}`, data).then(r => r.data),

  get: (visitId: string) =>
    apiClient.get<Prescription>(`/prescriptions/${visitId}`).then(r => r.data),
}

export const billingService = {
  createInvoice: (data: InvoiceCreate) =>
    apiClient.post<Invoice>('/billing', data).then(r => r.data),

  getByVisit: (visitId: string) =>
    apiClient.get<Invoice>(`/billing/visit/${visitId}`).then(r => r.data),

  pay: (invoiceId: string, payment_method: string) =>
    apiClient.post<Invoice>(`/billing/${invoiceId}/pay`, { payment_method }).then(r => r.data),
}

export const doctorService = {
  list: () =>
    apiClient.get('/doctors').then(r => r.data),
}
