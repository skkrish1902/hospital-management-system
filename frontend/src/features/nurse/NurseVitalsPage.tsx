/**
 * Nurse Station
 *
 * Tab 1 – "Vitals": registered patients awaiting vitals + vitals_recorded patients ready to send to doctor
 * Tab 2 – "Dispatch": prescription_done / dispatched_pharmacy / dispatched_lab — nurse dispatches
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { visitService, vitalsService, consultationService, type VitalsCreate } from '@/services/visitService'
import { nurseDeptService } from '@/services/nurseDeptService'
import { prescriptionService } from '@/services/clinicalService'
import { useAuthStore } from '@/features/auth/authStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Visit, Prescription, Consultation } from '@/types/common'

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
  const [activeDeptId, setActiveDeptId] = useState<string | undefined>(undefined)
  const [dispatchConfirm, setDispatchConfirm] = useState<{
    visitId: string; action: 'pharmacy' | 'lab'; patientName: string
  } | null>(null)
  const [closingVisit, setClosingVisit] = useState<Visit | null>(null)
  const [additionalBilling, setAdditionalBilling] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const hospitalName = useAuthStore(s => s.user?.hospitalName ?? s.user?.tenantSchema ?? 'Hospital')

  // Pre-fetch prescription + consultation when close modal opens
  const { data: closingPrescription } = useQuery({
    queryKey: ['prescription', closingVisit?.id],
    queryFn: () => prescriptionService.get(closingVisit!.id),
    enabled: !!closingVisit?.id,
  })
  const { data: closingConsultation } = useQuery({
    queryKey: ['consultation', closingVisit?.id],
    queryFn: () => consultationService.get(closingVisit!.id),
    enabled: !!closingVisit?.id,
  })

  // Fetch all departments this nurse is assigned to
  const { data: myDepts = [] } = useQuery<import('@/types/common').NurseDepartment[]>({
    queryKey: ['my-departments'],
    queryFn: () => nurseDeptService.myDepartments(),
    retry: false,
  })

  const deptId = myDepts.length === 1 ? myDepts[0].department_id : activeDeptId

  // ── Vitals tab queries ───────────────────────────────────────────────────────
  const { data: registeredVisits = [], refetch: refetchRegistered } = useQuery({
    queryKey: ['visits', 'registered', deptId],
    queryFn: () => visitService.list({ status: 'registered', department_id: deptId }),
    refetchInterval: 30_000,
  })

  const { data: vitalsRecordedVisits = [], refetch: refetchVitalsRecorded } = useQuery({
    queryKey: ['visits', 'vitals_recorded', deptId],
    queryFn: () => visitService.list({ status: 'vitals_recorded', department_id: deptId }),
    refetchInterval: 30_000,
  })

  // ── Dispatch tab queries ─────────────────────────────────────────────────────
  const { data: prescriptionDoneVisits = [], refetch: refetchPrescription } = useQuery({
    queryKey: ['visits', 'prescription_done', deptId],
    queryFn: () => visitService.list({ status: 'prescription_done', department_id: deptId }),
    refetchInterval: 30_000,
  })

  const { data: dispatchedPharmacyVisits = [], refetch: refetchPharmacy } = useQuery({
    queryKey: ['visits', 'dispatched_pharmacy', deptId],
    queryFn: () => visitService.list({ status: 'dispatched_pharmacy', department_id: deptId }),
    refetchInterval: 30_000,
  })

  const { data: dispatchedLabVisits = [], refetch: refetchLab } = useQuery({
    queryKey: ['visits', 'dispatched_lab', deptId],
    queryFn: () => visitService.list({ status: 'dispatched_lab', department_id: deptId }),
    refetchInterval: 30_000,
  })

  // Prescription for the selected dispatch visit
  const { data: prescription } = useQuery({
    queryKey: ['prescription', prescriptionVisitId],
    queryFn: () => prescriptionService.get(prescriptionVisitId!),
    enabled: !!prescriptionVisitId,
  })

  const dispatchVisits = [...prescriptionDoneVisits, ...dispatchedPharmacyVisits, ...dispatchedLabVisits]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const onUpdate = useCallback(() => {
    refetchRegistered()
    refetchVitalsRecorded()
    refetchPrescription()
    refetchPharmacy()
    refetchLab()
  }, [refetchRegistered, refetchVitalsRecorded, refetchPrescription, refetchPharmacy, refetchLab])

  useWebSocket('visit:update', onUpdate)
  useWebSocket('queue:update', onUpdate)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VitalsForm>({
    resolver: zodResolver(vitalsSchema),
  })

  // Save vitals → vitals_recorded; nurse manually sends to doctor when ready
  const { mutate: submitVitals, isPending, error: vitalsError } = useMutation({
    mutationFn: (data: VitalsCreate) => vitalsService.record(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setSelectedVisit(null)
      reset()
    },
  })

  // Explicitly send patient to doctor queue (vitals_recorded → vitals_done)
  const { mutate: sendToDoctor, isPending: sending } = useMutation({
    mutationFn: (visitId: string) => visitService.updateStatus(visitId, 'vitals_done'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visits'] }),
  })

  // Dispatch to pharmacy or lab (confirmed via modal)
  const { mutate: dispatch, isPending: dispatching } = useMutation({
    mutationFn: ({ visitId, action }: { visitId: string; action: 'pharmacy' | 'lab' }) =>
      visitService.dispatch(visitId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setDispatchConfirm(null)
      setPrescriptionVisitId(null)
    },
  })

  // Close visit or send to billing (optional additional billing checkbox)
  const { mutate: closeVisit, isPending: closing } = useMutation({
    mutationFn: ({ visitId, billing }: { visitId: string; billing: boolean }) =>
      visitService.dispatch(visitId, billing ? 'billing' : 'close'),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setClosingVisit(null)
      setAdditionalBilling(false)
      if (vars.billing) navigate(`/billing?visitId=${vars.visitId}&returnTo=nurse`)
    },
  })

  const handleCloseAndPrint = () => {
    if (!closingVisit) return
    printPrescription(closingVisit, closingPrescription ?? null, closingConsultation ?? null, hospitalName)
    closeVisit({ visitId: closingVisit.id, billing: false })
  }

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

  const vitalsTabCount = registeredVisits.length + vitalsRecordedVisits.length
  const dispatchTabCount = dispatchVisits.length

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Nurse Station</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {myDepts.length === 0
              ? 'No department assigned'
              : myDepts.length === 1
              ? `Department: ${myDepts[0].department_name}`
              : `${myDepts.length} departments assigned`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {myDepts.length > 1 && (
            <select
              value={activeDeptId ?? ''}
              onChange={e => { setActiveDeptId(e.target.value || undefined); setSelectedVisit(null) }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All departments</option>
              {myDepts.map(d => (
                <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['vitals', 'dispatch'] as ActiveTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${
                  activeTab === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'vitals' ? `Vitals (${vitalsTabCount})` : `Dispatch (${dispatchTabCount})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'vitals' ? (
        <div className="space-y-6">
          {/* Awaiting Vitals + Form */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Patient list */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700">Awaiting Vitals ({registeredVisits.length})</h2>
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
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${
                      selectedVisit?.id === v.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{v.patient_name || 'Patient'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {v.doctor_name ? `Dr. ${v.doctor_name}` : 'Unassigned'} · {new Date(v.created_at).toLocaleTimeString()}
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
                      {isPending ? 'Saving…' : 'Save Vitals'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Vitals Recorded — Send to Doctor */}
          {vitalsRecordedVisits.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-green-50">
                <h2 className="text-sm font-semibold text-green-800">
                  Vitals Done — Ready to Send to Doctor ({vitalsRecordedVisits.length})
                </h2>
                <p className="text-xs text-green-600 mt-0.5">Review and send each patient to the doctor queue when ready</p>
              </div>
              <div className="divide-y divide-gray-100">
                {vitalsRecordedVisits.map(v => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{v.patient_name || 'Patient'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {v.doctor_name ? `Dr. ${v.doctor_name}` : 'Unassigned'} · {new Date(v.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      disabled={sending}
                      onClick={() => sendToDoctor(v.id)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
                    >
                      Send to Doctor
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Dispatch tab */
        <div className="space-y-4">
          {dispatchVisits.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
              No patients awaiting dispatch
            </div>
          ) : dispatchVisits.map(v => {
            const canPharmacy = v.status === 'prescription_done' || v.status === 'dispatched_lab'
            const canLab = v.status === 'prescription_done' || v.status === 'dispatched_pharmacy'
            const badge = statusBadge(v.status)
            return (
              <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{v.patient_name || 'Patient'}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
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
                    {(prescription.instructions || prescription.notes) && (
                      <p><span className="font-medium text-gray-700">Notes:</span> {prescription.instructions || prescription.notes}</p>
                    )}
                    {prescription.medicines?.length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Medicines ({prescription.medicines.length}):</p>
                        <ul className="space-y-0.5 text-gray-600">
                          {prescription.medicines.map((m: any, i: number) => (
                            <li key={i} className="text-xs">• {m.name} {m.dosage || m.dose} — {m.frequency} × {m.duration}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(prescription.lab_tests ?? []).length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Lab Tests ({(prescription.lab_tests ?? []).length}):</p>
                        <ul className="space-y-0.5 text-gray-600">
                          {(prescription.lab_tests ?? []).map((t: any, i: number) => (
                            <li key={i} className="text-xs">• {t.test_name}{t.notes ? ` (${t.notes})` : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100 items-center">
                  <span className="text-xs text-gray-500 mr-1">Dispatch to:</span>
                  {canPharmacy && (
                    <button
                      onClick={() => setDispatchConfirm({ visitId: v.id, action: 'pharmacy', patientName: v.patient_name || 'Patient' })}
                      className="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 text-xs font-medium hover:bg-orange-100 border border-orange-200"
                    >
                      → Pharmacy
                    </button>
                  )}
                  {canLab && (
                    <button
                      onClick={() => setDispatchConfirm({ visitId: v.id, action: 'lab', patientName: v.patient_name || 'Patient' })}
                      className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 border border-purple-200"
                    >
                      → Lab
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => { setClosingVisit(v); setAdditionalBilling(false) }}
                    className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 border border-green-200"
                  >
                    Close Visit ✓
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dispatch Confirmation Modal (pharmacy / lab) */}
      {dispatchConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Send to {dispatchConfirm.action === 'pharmacy' ? 'Pharmacy' : 'Lab'}?
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Patient <span className="font-medium">{dispatchConfirm.patientName}</span> will be{' '}
              {dispatchConfirm.action === 'pharmacy'
                ? 'routed to the hospital pharmacy to collect medicines.'
                : 'sent to the lab for the ordered tests.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDispatchConfirm(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={dispatching}
                onClick={() => dispatch({ visitId: dispatchConfirm.visitId, action: dispatchConfirm.action })}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60 ${
                  dispatchConfirm.action === 'pharmacy' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-purple-500 hover:bg-purple-600'
                }`}
              >
                {dispatching ? 'Sending…' : `Yes, Send to ${dispatchConfirm.action === 'pharmacy' ? 'Pharmacy' : 'Lab'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Visit Modal */}
      {closingVisit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Close Visit</h3>
            <p className="text-sm text-gray-500 mb-4">
              {closingVisit.patient_name || 'Patient'} — hand prescription to patient and complete the visit.
            </p>
            <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer mb-5">
              <input
                type="checkbox"
                checked={additionalBilling}
                onChange={e => setAdditionalBilling(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">Add additional billing charges</p>
                <p className="text-xs text-gray-500">Check if there are extra charges to bill (injections, dressings, procedures, etc.)</p>
              </div>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => { setClosingVisit(null); setAdditionalBilling(false) }}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={closing}
                onClick={() => additionalBilling
                  ? closeVisit({ visitId: closingVisit.id, billing: true })
                  : handleCloseAndPrint()
                }
                className="flex-1 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60"
              >
                {closing ? 'Processing…' : additionalBilling ? 'Send to Billing →' : 'Close & Print'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function statusBadge(status: string) {
  if (status === 'prescription_done') return { color: 'bg-purple-100 text-purple-700', label: 'Prescription Ready' }
  if (status === 'dispatched_pharmacy') return { color: 'bg-orange-100 text-orange-700', label: 'Pharmacy ✓' }
  if (status === 'dispatched_lab') return { color: 'bg-blue-100 text-blue-700', label: 'Lab ✓' }
  return { color: 'bg-gray-100 text-gray-700', label: status }
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

function printPrescription(
  visit: Visit,
  prescription: Prescription | null,
  consultation: Consultation | null,
  hospitalName: string,
) {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const visitDate = new Date(visit.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const diagnosisStr = consultation?.diagnosis_icd10?.length
    ? consultation.diagnosis_icd10.map(d => `${d.code}${d.description ? ' — ' + d.description : ''}`).join(', ')
    : ''

  const medicinesHtml = (prescription?.medicines?.length ?? 0) > 0
    ? `<div class="section">
        <div class="section-title">Medicines</div>
        ${prescription!.medicines.map((m: any, i: number) => `
          <div class="item-row">
            <span class="item-num">${i + 1}.</span>
            <div>
              <strong>${m.name}</strong>
              <div class="medicine-detail">${[m.dose || m.dosage, m.route, m.frequency, m.duration].filter(Boolean).join(' · ')}${(m.instructions || m.notes) ? ' · <em>' + (m.instructions || m.notes) + '</em>' : ''}</div>
            </div>
          </div>`).join('')}
      </div>`
    : ''

  const labHtml = (prescription?.lab_tests?.length ?? 0) > 0
    ? `<div class="section">
        <div class="section-title">Lab Tests</div>
        ${prescription!.lab_tests!.map((t: any, i: number) => `
          <div class="item-row">
            <span class="item-num">${i + 1}.</span>
            <span>${t.test_name}${t.notes ? ` <span class="note">(${t.notes})</span>` : ''}</span>
          </div>`).join('')}
      </div>`
    : ''

  const consultHtml = consultation
    ? `<div class="section">
        <div class="section-title">Consultation Notes</div>
        ${consultation.chief_complaint ? `<div class="field-row"><span class="field-label">Chief Complaint:</span><span>${consultation.chief_complaint}</span></div>` : ''}
        ${consultation.history ? `<div class="field-row"><span class="field-label">History:</span><span>${consultation.history}</span></div>` : ''}
        ${consultation.examination ? `<div class="field-row"><span class="field-label">Examination:</span><span>${consultation.examination}</span></div>` : ''}
        ${diagnosisStr ? `<div class="field-row"><span class="field-label">Diagnosis:</span><span>${diagnosisStr}</span></div>` : ''}
        ${consultation.notes ? `<div class="field-row"><span class="field-label">Notes:</span><span>${consultation.notes}</span></div>` : ''}
        ${consultation.follow_up_date ? `<div class="field-row"><span class="field-label">Follow-up:</span><span>${new Date(consultation.follow_up_date).toLocaleDateString('en-IN')}</span></div>` : ''}
      </div>`
    : ''

  const instructionsHtml = prescription?.instructions
    ? `<div class="section">
        <div class="section-title">Instructions to Patient</div>
        <div class="instructions-box">${prescription.instructions}</div>
      </div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Prescription — ${visit.patient_name ?? 'Patient'}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm 15mm 20mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; background: #fff; }

    /* ── Header ── */
    .header { position: relative; text-align: center; padding-bottom: 10px; border-bottom: 2.5px solid #222; margin-bottom: 14px; }
    .hospital-name { font-size: 20pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
    .hospital-sub { font-size: 9.5pt; color: #555; margin-top: 2px; letter-spacing: 0.5px; }
    .print-date { position: absolute; top: 0; right: 0; font-size: 9.5pt; color: #444; line-height: 1.4; text-align: right; }

    /* ── Title ── */
    .doc-title { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 12px; color: #333; }

    /* ── Patient meta ── */
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 12px; font-size: 10.5pt; }
    .meta-row { display: flex; gap: 6px; }
    .meta-label { font-weight: bold; min-width: 95px; color: #333; }
    .meta-value { color: #111; }

    hr.dashed { border: none; border-top: 1px dashed #bbb; margin: 10px 0; }

    /* ── Sections ── */
    .section { margin: 12px 0; }
    .section-title { font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 8px; }

    /* Consultation */
    .field-row { display: flex; gap: 8px; margin: 5px 0; font-size: 10.5pt; }
    .field-label { font-weight: bold; min-width: 120px; color: #333; }

    /* Medicines */
    .item-row { display: flex; gap: 8px; margin: 6px 0; align-items: flex-start; font-size: 10.5pt; }
    .item-num { min-width: 18px; font-weight: bold; }
    .medicine-detail { font-size: 10pt; color: #444; margin-top: 1px; }
    .note { color: #666; font-size: 10pt; }

    /* Instructions */
    .instructions-box { background: #f8f8f8; border: 1px solid #ddd; border-radius: 3px; padding: 8px 12px; font-size: 10.5pt; line-height: 1.5; }

    /* Footer */
    .footer { margin-top: 40px; display: flex; justify-content: flex-end; page-break-inside: avoid; }
    .signature-box { text-align: center; width: 180px; }
    .signature-line { border-top: 1px solid #333; margin-bottom: 5px; }
    .signature-name { font-weight: bold; font-size: 10.5pt; }
    .signature-sub { font-size: 9.5pt; color: #555; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="print-date">
      Date: ${date}
    </div>
    <div class="hospital-name">${hospitalName}</div>
    <div class="hospital-sub">OPD Prescription</div>
  </div>

  <div class="doc-title">Prescription</div>

  <!-- Patient / Doctor meta -->
  <div class="meta-grid">
    <div class="meta-row"><span class="meta-label">Patient:</span><span class="meta-value">${visit.patient_name ?? '—'}</span></div>
    <div class="meta-row"><span class="meta-label">Doctor:</span><span class="meta-value">${visit.doctor_name ? 'Dr. ' + visit.doctor_name : '—'}</span></div>
    <div class="meta-row"><span class="meta-label">Department:</span><span class="meta-value">${visit.department_name ?? '—'}</span></div>
    <div class="meta-row"><span class="meta-label">Visit Date:</span><span class="meta-value">${visitDate}</span></div>
  </div>

  <hr class="dashed"/>

  ${consultHtml}
  ${consultHtml ? '<hr class="dashed"/>' : ''}
  ${medicinesHtml}
  ${medicinesHtml && labHtml ? '<hr class="dashed"/>' : ''}
  ${labHtml}
  ${instructionsHtml ? '<hr class="dashed"/>' : ''}
  ${instructionsHtml}

  <!-- Signature -->
  <div class="footer">
    <div class="signature-box">
      <div class="signature-line"></div>
      <div class="signature-name">Dr. ${visit.doctor_name ?? '—'}</div>
      <div class="signature-sub">Doctor's Signature</div>
    </div>
  </div>

</body>
</html>`

  const win = window.open('', '_blank', 'width=794,height=1123,menubar=no,toolbar=no')
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Use afterprint to auto-close the print window
  win.addEventListener('afterprint', () => win.close())
  win.print()
}
