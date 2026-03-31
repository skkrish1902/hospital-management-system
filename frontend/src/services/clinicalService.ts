import apiClient from './apiClient'
import type { Prescription, Invoice, Doctor, Department, Appointment, AppointmentSlot, CheckInResult } from '@/types/common'

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
  list: (params?: { include_inactive?: boolean; department_id?: string }) =>
    apiClient.get<Doctor[]>('/doctors', { params }).then(r => r.data),

  get: (id: string) =>
    apiClient.get<Doctor>(`/doctors/${id}`).then(r => r.data),

  create: (data: {
    user_id: string
    full_name: string
    specialization: string
    department_id?: string
    consultation_fee?: number
    qualification?: string
    experience_years?: number
  }) => apiClient.post<Doctor>('/doctors', data).then(r => r.data),

  /** Creates login account (role=doctor) + doctor profile in one step. */
  onboard: (data: {
    email: string
    phone: string
    username?: string
    password: string
    full_name: string
    specialization: string
    department_id?: string
    consultation_fee?: number
    qualification?: string
    experience_years?: number
  }) => apiClient.post<Doctor>('/doctors/onboard', data).then(r => r.data),

  update: (id: string, data: Partial<{
    full_name: string
    specialization: string
    department_id: string | null
    consultation_fee: number
    qualification: string
    experience_years: number
    is_active: boolean
  }>) => apiClient.patch<Doctor>(`/doctors/${id}`, data).then(r => r.data),
}

export const userService = {
  /** List non-doctor staff users, optionally filtered by role. */
  list: (params?: { role?: string; include_inactive?: boolean }) =>
    apiClient.get<import('@/types/common').StaffUser[]>('/users', { params }).then(r => r.data),

  create: (data: {
    email: string
    phone: string
    password: string
    username?: string
    full_name: string
    role: string
  }) => apiClient.post<import('@/types/common').StaffUser>('/users', data).then(r => r.data),

  update: (id: string, data: { full_name?: string; is_active?: boolean }) =>
    apiClient.patch<import('@/types/common').StaffUser>(`/users/${id}`, data).then(r => r.data),
}

export const departmentService = {
  list: (include_inactive = false) =>
    apiClient.get<Department[]>('/departments', { params: { include_inactive } }).then(r => r.data),

  get: (id: string) =>
    apiClient.get<Department>(`/departments/${id}`).then(r => r.data),

  create: (data: { name: string; description?: string }) =>
    apiClient.post<Department>('/departments', data).then(r => r.data),

  update: (id: string, data: Partial<{ name: string; description: string; is_active: boolean }>) =>
    apiClient.patch<Department>(`/departments/${id}`, data).then(r => r.data),
}

export const appointmentService = {
  list: (params?: {
    date?: string
    doctor_id?: string
    patient_id?: string
    status?: string
  }) => apiClient.get<Appointment[]>('/appointments', { params }).then(r => r.data),

  get: (id: string) =>
    apiClient.get<Appointment>(`/appointments/${id}`).then(r => r.data),

  book: (data: {
    patient_id: string
    doctor_id: string
    slot_time: string
    type?: 'walkin' | 'pre_booked'
    notes?: string
  }) => apiClient.post<Appointment>('/appointments', data).then(r => r.data),

  slots: (doctor_id: string, date: string) =>
    apiClient.get<AppointmentSlot[]>('/appointments/slots', { params: { doctor_id, date } }).then(r => r.data),

  reschedule: (id: string, slot_time: string, notes?: string) =>
    apiClient.patch<Appointment>(`/appointments/${id}/reschedule`, { slot_time, notes }).then(r => r.data),

  cancel: (id: string) =>
    apiClient.patch<Appointment>(`/appointments/${id}/cancel`, {}).then(r => r.data),

  checkin: (id: string) =>
    apiClient.post<CheckInResult>(`/appointments/${id}/checkin`, {}).then(r => r.data),
}
