/**
 * Nurse Vitals Screen
 *
 * Tab 1 – "Vitals": visits with status "registered" awaiting vitals
 * Tab 2 – "Dispatch": visits with status "prescription_done" – nurse dispatches to pharmacy/lab/billing
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { visitService, vitalsService, type VitalsCreate } from '@/services/visitService'
import { nurseDeptService } from '@/services/nurseDeptService'
import { prescriptionService } from '@/services/clinicalService'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Visit } from '@/types/common'

const vitalsSchema = z.object({
  bp_systolic: z.coerce.number().int().min(40).max(300).optional().or(z.literal('')),
  bp_diastolic: z.coerce.number().int().min(20).max(200).optional().or(z.literal('')),
  temperature: z.coerce.number().min(30).max(45).optional().or(z.literal('')),
  weight: z.coerce.number().min(1).max(500).optional().or(z.literal('')),
  height: z.coerce.number().min(30).max(250).optional().or(z.literal('')),
  spo2: z.coerce.number().int().min(1).max(100).optional().or(z.literal('')),
  pulse: z.coerce.number().int().min(20).max(300).optional().or(z.literal('')),
})

type VitalsForm = z.infer<typeof vitalsSchema>
type ActiveTab = 'vitals' | 'dispatch'

export default function NurseVitalsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('vitals')
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const [prescriptionVisitId, setPrescriptionVisitId] = useState<string | null>(null)
  const qc = useQueryClient()

  // Fetch nurse's assigned department to filter visits
  const { data: myDept } = useQuery({
    queryKey: ['my-department'],
    queryFn: () => nurseDeptService.myDepartment(),
    retry: false,
  })

  const deptId = myDept?.department_id

  const { data: registeredVisits = [], refetch: refetchRegistered } = useQuery({
    queryKey: ['visits', 'registered', deptId],
    queryFn: () => visitService.list({ status: 'registered', department_id: deptId }),
    refetchInterval: 30_000,
  })

  const { data: prescriptionDoneVisits = [], refetch: refetchDispatch } = useQuery({
    queryKey: ['visits', 'prescription_done', deptId],
    queryFn: () => visitService.list({ status: 'prescription_done', department_id: deptId }),
    refetchInterval: 30_000,
  })

  // Prescription for the selected visit (in dispatch tab)
  const { data: prescription } = useQuery({
    queryKey: ['prescription', prescriptionVisitId],
    queryFn: () => prescriptionService.get(prescriptionVisitId!),
    enabled: !!prescriptionVisitId,
  })

  const onUpdate = useCallback(() => {
    refetchRegistered()
    refetchDispatch()
  }, [refetchRegistered, refetchDispatch])
  useWebSocket('visit:update', onUpdate)
  useWebSocket('queue:update', onUpdate)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VitalsForm>({ resolver: zodResolver(vitalsSchema) })

  const { mutate: submitVitals, isPending, error: vitalsError } = useMutation({
    mutationFn: (data: VitalsCreate) => vitalsService.record(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setSelectedVisit(null)
      reset()
    },
  })

  const { mutate: dispatch, isPending: dispatching } = useMutation({
    mutationFn: ({ visitId, action }: { visitId: string; action: 'billing' | 'pharmacy' | 'lab' }) =>
      visitService.dispatch(visitId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setPrescriptionVisitId(null)
    },
  })

  const onSubmit = (values: VitalsForm) => {
    if (!selectedVisit) return
    const clean = (v: number | string | undefined) =>
      v === '' || v === undefined ? undefined : Number(v)

    submitVitals({
      visit_id: selectedVisit.id,
      bp_systolic: clean(values.bp_systolic),
      bp_diastolic: clean(values.bp_diastolic),
      temperature: clean(values.temperature),
      weight: clean(values.weight),
      height: clean(values.height),
      spo2: clean(values.spo2),
      pulse: clean(values.pulse),
    })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Nurse Station</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {myDept ? `Department: ${myDept.department_name}` : 'All departments'}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['vitals', 'dispatch'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${
                activeTab === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'vitals' ? `Vitals (${registeredVisits.length})` : `Dispatch (${prescriptionDoneVisits.length})`}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'vitals' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Patient list */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">Awaiting Vitals</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {registeredVisits.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  All caught up!
                </div>
              ) : registeredVisits.map(v => (
                <button
                  key={v.id}
                  onClick={() => { setSelectedVisit(v); reset() }}
                  className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${selectedVisit?.id === v.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{v.patient_name || 'Patient'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {v.doctor_name ? `Dr. ${v.doctor_name}` : 'Unassigned'} ·{' '}
                        {new Date(v.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Waiting</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Vitals form */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">
                {selectedVisit ? `Record Vitals — ${selectedVisit.patient_name}` : 'Select a patient'}
              </h2>
            </div>

            {!selectedVisit ? (
              <div className="p-8 text-center text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Select a patient from the list
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
                {vitalsError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    Failed to save vitals. Please try again.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <VitalField label="Systolic BP (mmHg)" error={errors.bp_systolic?.message}>
                    <input {...register('bp_systolic')} type="number" placeholder="120" className={inputCls(false)} />
                  </VitalField>
                  <VitalField label="Diastolic BP (mmHg)" error={errors.bp_diastolic?.message}>
                    <input {...register('bp_diastolic')} type="number" placeholder="80" className={inputCls(false)} />
                  </VitalField>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <VitalField label="Temperature (°C)" error={errors.temperature?.message}>
                    <input {...register('temperature')} type="number" step="0.1" placeholder="37.0" className={inputCls(false)} />
                  </VitalField>
                  <VitalField label="SpO₂ (%)" error={errors.spo2?.message}>
                    <input {...register('spo2')} type="number" placeholder="98" className={inputCls(false)} />
                  </VitalField>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <VitalField label="Pulse (bpm)" error={errors.pulse?.message}>
                    <input {...register('pulse')} type="number" placeholder="72" className={inputCls(false)} />
                  </VitalField>
                  <VitalField label="Weight (kg)" error={errors.weight?.message}>
                    <input {...register('weight')} type="number" step="0.1" placeholder="70" className={inputCls(false)} />
                  </VitalField>
                </div>

                <VitalField label="Height (cm)" error={errors.height?.message}>
                  <input {...register('height')} type="number" step="0.1" placeholder="170" className={inputCls(false) + ' max-w-[50%]'} />
                </VitalField>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => { setSelectedVisit(null); reset() }}
                    className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={isPending}
                    className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60">
                    {isPending ? 'Saving…' : 'Save & Next Patient'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        /* Dispatch tab */
        <div className="space-y-4">
          {prescriptionDoneVisits.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
              No patients awaiting dispatch
            </div>
          ) : prescriptionDoneVisits.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-900">{v.patient_name || 'Patient'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {v.doctor_name ? `Dr. ${v.doctor_name}` : ''} · {v.department_name || ''} · {new Date(v.created_at).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => setPrescriptionVisitId(prescriptionVisitId === v.id ? null : v.id)}
                  className="text-xs text-blue-600 hover:underline shrink-0"
                >
                  {prescriptionVisitId === v.id ? 'Hide Prescription' : 'View Prescription'}
                </button>
              </div>

              {prescriptionVisitId === v.id && prescription && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3 text-sm space-y-2">
                  {(prescription.diagnosis || prescription.notes || prescription.instructions) && (
                    <p><span className="font-medium text-gray-700">Notes:</span> {prescription.diagnosis || prescription.notes || prescription.instructions}</p>
                  )}
                  {prescription.medicines?.length > 0 && (
                    <div>
                      <p className="font-medium text-gray-700 mb-1">Medicines:</p>
                      <ul className="space-y-0.5 text-gray-600">
                        {prescription.medicines.map((m: any, i: number) => (
                          <li key={i} className="text-xs">• {m.name} {m.dosage} — {m.frequency} × {m.duration}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(prescription.lab_tests ?? []).length > 0 && (
                    <div>
                      <p className="font-medium text-gray-700 mb-1">Lab Tests:</p>
                      <ul className="space-y-0.5 text-gray-600">
                        {(prescription.lab_tests ?? []).map((t, i: number) => (
                          <li key={i} className="text-xs">• {t.test_name}{t.notes ? ` (${t.notes})` : ''}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <span className="text-xs text-gray-500 self-center mr-1">Patient wants:</span>
                <button
                  disabled={dispatching}
                  onClick={() => dispatch({ visitId: v.id, action: 'billing' })}
                  className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 border border-green-200 disabled:opacity-50"
                >
                  Take Prescription (Done)
                </button>
                <button
                  disabled={dispatching}
                  onClick={() => dispatch({ visitId: v.id, action: 'pharmacy' })}
                  className="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 text-xs font-medium hover:bg-orange-100 border border-orange-200 disabled:opacity-50"
                >
                  → Pharmacy
                </button>
                <button
                  disabled={dispatching}
                  onClick={() => dispatch({ visitId: v.id, action: 'lab' })}
                  className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 border border-purple-200 disabled:opacity-50"
                >
                  → Lab
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VitalField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  )
}

function inputCls(hasError: boolean) {
  return `w-full border ${hasError ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary`
}
