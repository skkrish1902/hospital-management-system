// Auth
export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

// Common
export type UUID = string

export type Gender = 'male' | 'female' | 'other'

export type QueueType = 'registration' | 'vitals' | 'consultation' | 'pharmacy' | 'billing'

export type QueuePriority = 'emergency' | 'senior_citizen' | 'normal'

export type QueueStatus = 'waiting' | 'called' | 'in_progress' | 'completed' | 'skipped'

export type VisitStatus =
  | 'registered'
  | 'vitals_done'
  | 'in_consultation'
  | 'prescription_done'
  | 'billing_pending'
  | 'closed'

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type InvoiceStatus = 'draft' | 'paid' | 'cancelled'

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'insurance'

// Entities
export interface Patient {
  id: UUID
  uhid: string
  first_name: string
  last_name: string
  dob?: string
  gender: Gender
  phone: string
  email?: string
  address?: string
  blood_group?: string
  insurance_provider?: string
  insurance_id?: string
}

export interface Doctor {
  id: UUID
  user_id: UUID
  full_name: string
  specialization: string
  department_id?: UUID
  consultation_fee: number
  qualification?: string
  experience_years?: number
  is_active: boolean
}

export interface Department {
  id: UUID
  name: string
  description?: string
  is_active: boolean
}

export interface QueueToken {
  id: UUID
  patient_id: UUID
  appointment_id?: UUID
  token_no: number
  queue_type: QueueType
  priority: QueuePriority
  status: QueueStatus
  issued_at: string
  called_at?: string
  completed_at?: string
  patient?: Patient
}

export interface Visit {
  id: UUID
  patient_id: UUID
  doctor_id: UUID
  appointment_id?: UUID
  status: VisitStatus
  created_at: string
  closed_at?: string
  patient?: Patient
  doctor?: Doctor
}

export interface Vitals {
  id: UUID
  visit_id: UUID
  bp_systolic?: number
  bp_diastolic?: number
  temperature?: number
  weight?: number
  height?: number
  spo2?: number
  pulse?: number
  recorded_at: string
}

export interface MedicineItem {
  name: string
  dose: string
  frequency: string
  duration: string
  route: string
  instructions?: string
}

export interface Prescription {
  id: UUID
  visit_id: UUID
  medicines: MedicineItem[]
  instructions?: string
  created_at: string
}

export interface InvoiceLineItem {
  description: string
  quantity: number
  unit_price: number
  amount: number
}

export interface Invoice {
  id: UUID
  visit_id: UUID
  line_items: InvoiceLineItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  payment_method?: PaymentMethod
  status: InvoiceStatus
  paid_at?: string
}
