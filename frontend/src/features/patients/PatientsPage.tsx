import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { patientService, type PatientCreate } from '@/services/patientService'
import type { Patient } from '@/types/common'

const patientSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  phone: z.string().min(10, 'Enter valid phone').max(15),
  gender: z.enum(['male', 'female', 'other']),
  dob: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  blood_group: z.string().optional(),
  address: z.string().optional(),
  insurance_provider: z.string().optional(),
  insurance_id: z.string().optional(),
})

type FormValues = z.infer<typeof patientSchema>

export default function PatientsPage() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Patient | null>(null)
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()

  const { data: patients = [], isFetching } = useQuery({
    queryKey: ['patients', search],
    queryFn: () => patientService.list(search || undefined),
    staleTime: 10_000,
  })

  const { mutate: registerPatient, isPending, error: createError } = useMutation({
    mutationFn: (data: PatientCreate) => patientService.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      setShowForm(false)
      reset()
    },
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(patientSchema) })

  const onSubmit = (values: FormValues) => {
    const payload: PatientCreate = {
      ...values,
      email: values.email || undefined,
      dob: values.dob || undefined,
    }
    registerPatient(payload)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Patient Registration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Register new patients or search by UHID, name, or phone</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setSelected(null) }}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Patient
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by UHID, name or phone…"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Patient list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['UHID', 'Name', 'Phone', 'Gender', 'Blood Group', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {patients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  {search ? 'No patients found' : 'No patients registered yet'}
                </td>
              </tr>
            ) : patients.map(p => (
              <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.uhid}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{p.first_name} {p.last_name}</td>
                <td className="px-4 py-3 text-gray-600">{p.phone}</td>
                <td className="px-4 py-3 capitalize text-gray-600">{p.gender}</td>
                <td className="px-4 py-3 text-gray-600">{p.blood_group || '—'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setSelected(p)}
                    className="text-primary hover:underline text-xs font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Patient detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-md h-full shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{selected.first_name} {selected.last_name}</h2>
                <span className="font-mono text-xs text-blue-600">{selected.uhid}</span>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <dl className="p-6 space-y-3">
              {[
                ['Phone', selected.phone],
                ['Email', selected.email || '—'],
                ['Gender', selected.gender],
                ['Date of Birth', selected.dob || '—'],
                ['Blood Group', selected.blood_group || '—'],
                ['Address', selected.address || '—'],
                ['Insurance Provider', selected.insurance_provider || '—'],
                ['Insurance ID', selected.insurance_id || '—'],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900 text-right max-w-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Registration form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Register New Patient</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              {createError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  Registration failed. Please try again.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name *" error={errors.first_name?.message}>
                  <input {...register('first_name')} className={inputCls(!!errors.first_name)} placeholder="First name" />
                </Field>
                <Field label="Last Name *" error={errors.last_name?.message}>
                  <input {...register('last_name')} className={inputCls(!!errors.last_name)} placeholder="Last name" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone *" error={errors.phone?.message}>
                  <input {...register('phone')} type="tel" className={inputCls(!!errors.phone)} placeholder="10-digit mobile" />
                </Field>
                <Field label="Gender *" error={errors.gender?.message}>
                  <select {...register('gender')} className={inputCls(!!errors.gender)}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Date of Birth" error={errors.dob?.message}>
                  <input {...register('dob')} type="date" className={inputCls(!!errors.dob)} />
                </Field>
                <Field label="Blood Group" error={errors.blood_group?.message}>
                  <select {...register('blood_group')} className={inputCls(false)}>
                    <option value="">Unknown</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Email" error={errors.email?.message}>
                <input {...register('email')} type="email" className={inputCls(!!errors.email)} placeholder="patient@email.com" />
              </Field>

              <Field label="Address" error={errors.address?.message}>
                <textarea {...register('address')} rows={2} className={inputCls(false) + ' resize-none'} placeholder="Full address" />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Insurance Provider" error={errors.insurance_provider?.message}>
                  <input {...register('insurance_provider')} className={inputCls(false)} placeholder="e.g. Star Health" />
                </Field>
                <Field label="Insurance ID" error={errors.insurance_id?.message}>
                  <input {...register('insurance_id')} className={inputCls(false)} placeholder="Policy number" />
                </Field>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={isPending}
                  className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60">
                  {isPending ? 'Registering…' : 'Register Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  )
}

function inputCls(hasError: boolean) {
  return `w-full border ${hasError ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${hasError ? 'focus:ring-red-200' : 'focus:ring-primary/30'} focus:border-primary`
}
