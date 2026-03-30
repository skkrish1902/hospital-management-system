/**
 * Admin — Doctors & Departments Management
 * Two tabs: Departments (CRUD) + Doctors (CRUD with dept association)
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Department, Doctor } from '@/types/common'
import { departmentService, doctorService } from '@/services/clinicalService'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const deptSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
})
type DeptForm = z.infer<typeof deptSchema>

// Used for the Create (onboard) form — includes login credentials
const doctorOnboardSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Minimum 8 characters'),
  full_name: z.string().min(1, 'Name required'),
  specialization: z.string().min(1, 'Specialization required'),
  department_id: z.string().uuid().optional().or(z.literal('')),
  consultation_fee: z.coerce.number().min(0),
  qualification: z.string().optional(),
  experience_years: z.coerce.number().min(0).max(60).optional(),
})
type DoctorOnboardForm = z.infer<typeof doctorOnboardSchema>

// Used for the Edit form — no credentials
const doctorEditSchema = z.object({
  full_name: z.string().min(1, 'Name required'),
  specialization: z.string().min(1, 'Specialization required'),
  department_id: z.string().uuid().optional().or(z.literal('')),
  consultation_fee: z.coerce.number().min(0),
  qualification: z.string().optional(),
  experience_years: z.coerce.number().min(0).max(60).optional(),
})
type DoctorEditForm = z.infer<typeof doctorEditSchema>

// ── Reusable components ────────────────────────────────────────────────────────

const StatusBadge = ({ active }: { active: boolean }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
    active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
  }`}>
    {active ? 'Active' : 'Inactive'}
  </span>
)

const Modal = ({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  </div>
)

const FormField = ({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    {children}
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
)

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

// ── Departments Tab ────────────────────────────────────────────────────────────

function DepartmentsTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const { data: depts = [], isLoading } = useQuery({
    queryKey: ['departments', showInactive],
    queryFn: () => departmentService.list(showInactive),
  })

  const createMut = useMutation({
    mutationFn: departmentService.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setShowCreate(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof departmentService.update>[1] }) =>
      departmentService.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setEditing(null) },
  })

  const createForm = useForm<DeptForm>({ resolver: zodResolver(deptSchema) })
  const editForm = useForm<DeptForm>({ resolver: zodResolver(deptSchema) })

  const openEdit = (dept: Department) => {
    setEditing(dept)
    editForm.reset({ name: dept.name, description: dept.description ?? '' })
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
        <button
          onClick={() => { setShowCreate(true); createForm.reset() }}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + New Department
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : depts.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No departments found</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Description', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {depts.map(dept => (
                <tr key={dept.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{dept.name}</td>
                  <td className="px-4 py-3 text-gray-500">{dept.description ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge active={dept.is_active} /></td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => openEdit(dept)}
                      className="text-primary hover:underline text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => updateMut.mutate({ id: dept.id, data: { is_active: !dept.is_active } })}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      {dept.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Department" onClose={() => setShowCreate(false)}>
          <form
            onSubmit={createForm.handleSubmit(data => createMut.mutate(data))}
            className="space-y-4"
          >
            <FormField label="Name" error={createForm.formState.errors.name?.message}>
              <input {...createForm.register('name')} className={inputCls} placeholder="e.g. Cardiology" />
            </FormField>
            <FormField label="Description">
              <textarea {...createForm.register('description')} rows={2} className={inputCls} />
            </FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {createMut.isPending ? 'Saving…' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Department" onClose={() => setEditing(null)}>
          <form
            onSubmit={editForm.handleSubmit(data => updateMut.mutate({ id: editing.id, data }))}
            className="space-y-4"
          >
            <FormField label="Name" error={editForm.formState.errors.name?.message}>
              <input {...editForm.register('name')} className={inputCls} />
            </FormField>
            <FormField label="Description">
              <textarea {...editForm.register('description')} rows={2} className={inputCls} />
            </FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Doctors Tab ────────────────────────────────────────────────────────────────

function DoctorsTab({ departments }: { departments: Department[] }) {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Doctor | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ['doctors-admin', showInactive],
    queryFn: () => doctorService.list({ include_inactive: showInactive }),
  })

  const onboardMut = useMutation({
    mutationFn: doctorService.onboard,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctors-admin'] }); setShowCreate(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof doctorService.update>[1] }) =>
      doctorService.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctors-admin'] }); setEditing(null) },
  })

  const createForm = useForm<DoctorOnboardForm>({ resolver: zodResolver(doctorOnboardSchema) })
  const editForm = useForm<DoctorEditForm>({ resolver: zodResolver(doctorEditSchema) })

  const openEdit = (doc: Doctor) => {
    setEditing(doc)
    editForm.reset({
      full_name: doc.full_name,
      specialization: doc.specialization,
      department_id: doc.department_id ?? '',
      consultation_fee: doc.consultation_fee,
      qualification: doc.qualification ?? '',
      experience_years: doc.experience_years ?? undefined,
    })
  }

  const deptMap: Record<string, string> = {}
  departments.forEach(d => { deptMap[d.id] = d.name })

  // Fields shared between create and edit.
  // Typed as the superset (OnboardForm); edit form is cast at the call site.
  const DoctorProfileFields = ({ form }: { form: ReturnType<typeof useForm<DoctorOnboardForm>> }) => (
    <>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Full Name" error={form.formState.errors.full_name?.message}>
          <input {...form.register('full_name')} className={inputCls} />
        </FormField>
        <FormField label="Specialization" error={form.formState.errors.specialization?.message}>
          <input {...form.register('specialization')} className={inputCls} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Department">
          <select {...form.register('department_id')} className={inputCls}>
            <option value="">— None —</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Consultation Fee (₹)" error={form.formState.errors.consultation_fee?.message}>
          <input {...form.register('consultation_fee')} type="number" min={0} className={inputCls} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Qualification">
          <input {...form.register('qualification')} className={inputCls} placeholder="MBBS, MD…" />
        </FormField>
        <FormField label="Experience (years)">
          <input {...form.register('experience_years')} type="number" min={0} max={60} className={inputCls} />
        </FormField>
      </div>
    </>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
        <button
          onClick={() => { setShowCreate(true); createForm.reset() }}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + Add Doctor
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : doctors.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No doctors found</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Specialization', 'Department', 'Fee', 'Exp.', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {doctors.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {doc.full_name}
                    {doc.qualification && (
                      <span className="ml-1 text-xs text-gray-400">({doc.qualification})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{doc.specialization}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {doc.department_id ? (deptMap[doc.department_id] ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">₹{doc.consultation_fee}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {doc.experience_years != null ? `${doc.experience_years}y` : '—'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge active={doc.is_active} /></td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => openEdit(doc)} className="text-primary hover:underline text-xs">
                      Edit
                    </button>
                    <button
                      onClick={() => updateMut.mutate({ id: doc.id, data: { is_active: !doc.is_active } })}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      {doc.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="Add Doctor" onClose={() => setShowCreate(false)}>
          <form
            onSubmit={createForm.handleSubmit(data =>
              onboardMut.mutate({
                ...data,
                department_id: data.department_id || undefined,
              })
            )}
            className="space-y-4"
          >
            {/* Login credentials — only on create */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Login Account</p>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Email" error={createForm.formState.errors.email?.message}>
                  <input {...createForm.register('email')} type="email" className={inputCls} placeholder="doctor@hospital.in" />
                </FormField>
                <FormField label="Password" error={createForm.formState.errors.password?.message}>
                  <input {...createForm.register('password')} type="password" className={inputCls} placeholder="Min 8 characters" />
                </FormField>
              </div>
            </div>
            <DoctorProfileFields form={createForm} />
            {onboardMut.isError && (
              <p className="text-xs text-red-600">
                {(onboardMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to create doctor'}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                type="submit"
                disabled={onboardMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {onboardMut.isPending ? 'Saving…' : 'Add Doctor'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Doctor" onClose={() => setEditing(null)}>
          <form
            onSubmit={editForm.handleSubmit(data =>
              updateMut.mutate({
                id: editing.id,
                data: {
                  ...data,
                  department_id: data.department_id || undefined,
                },
              })
            )}
            className="space-y-4"
          >
            <DoctorProfileFields form={editForm as unknown as ReturnType<typeof useForm<DoctorOnboardForm>>} />
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                type="submit"
                disabled={updateMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DoctorsAdminPage() {
  const [tab, setTab] = useState<'departments' | 'doctors'>('departments')

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', false],
    queryFn: () => departmentService.list(false),
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Doctors & Departments</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage hospital departments and doctor profiles</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['departments', 'doctors'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'departments' ? (
        <DepartmentsTab />
      ) : (
        <DoctorsTab departments={departments} />
      )}
    </div>
  )
}
