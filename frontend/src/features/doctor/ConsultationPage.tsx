/**
 * Doctor Consultation Page
 *
 * Shows: patient info, vitals summary, SOAP notes form, ICD-10 diagnosis
 * Handles visits with status "vitals_done" → moves to "in_consultation" when opened
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { visitService, vitalsService, consultationService } from '@/services/visitService'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Visit, Vitals } from '@/types/common'

const consultSchema = z.object({
  chief_complaint: z.string().min(1, 'Required'),
  history: z.string().optional(),
  examination: z.string().optional(),
  notes: z.string().optional(),
  follow_up_date: z.string().optional(),
  diagnoses: z.array(z.object({
    code: z.string(),
    description: z.string(),
  })).optional(),
})

type ConsultForm = z.infer<typeof consultSchema>

export default function ConsultationPage() {
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const [vitals, setVitals] = useState<Vitals | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: visits = [], refetch } = useQuery({
    queryKey: ['visits', 'vitals_done'],
    queryFn: () => visitService.list({ status: 'vitals_done' }),
    refetchInterval: 30_000,
  })

  // Count of patients still being prepared by nurse (vitals_recorded → not yet sent to doctor)
  const { data: preparingVisits = [] } = useQuery({
    queryKey: ['visits', 'vitals_recorded'],
    queryFn: () => visitService.list({ status: 'vitals_recorded' }),
    refetchInterval: 30_000,
  })

  useWebSocket('visit:update', useCallback(() => refetch(), [refetch]))

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ConsultForm>({ resolver: zodResolver(consultSchema) })

  const { fields: diagFields, append: appendDiag, remove: removeDiag } = useFieldArray({
    control,
    name: 'diagnoses',
  })

  const selectVisit = async (v: Visit) => {
    setSelectedVisit(v)
    reset()
    try {
      const vData = await vitalsService.get(v.id)
      setVitals(vData)
    } catch {
      setVitals(null)
    }
  }

  const { mutate: saveConsultation, isPending } = useMutation({
    mutationFn: (data: ConsultForm) => consultationService.create({
      visit_id: selectedVisit!.id,
      chief_complaint: data.chief_complaint,
      history: data.history,
      examination: data.examination,
      notes: data.notes,
      follow_up_date: data.follow_up_date || undefined,
      diagnosis_icd10: data.diagnoses,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      navigate(`/doctor/prescription/${selectedVisit!.id}`)
    },
  })

  return (
    <div className="p-6 space-y-6 flex gap-6">
      {/* Left: patient queue */}
      <div className="w-72 shrink-0 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            Patients for Consultation
            {visits.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                {visits.length}
              </span>
            )}
          </h2>
          {preparingVisits.length > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              ⏳ {preparingVisits.length} patient{preparingVisits.length > 1 ? 's' : ''} being prepared by nurse
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {visits.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">No patients waiting</div>
            ) : visits.map(v => (
              <button
                key={v.id}
                onClick={() => selectVisit(v)}
                className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors text-sm ${
                  selectedVisit?.id === v.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                }`}
              >
                <p className="font-medium text-gray-900">{v.patient_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{v.doctor_name ? `Dr. ${v.doctor_name}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: consultation form */}
      <div className="flex-1 space-y-5">
        <h1 className="text-2xl font-semibold text-gray-900">
          {selectedVisit ? `Consultation — ${selectedVisit.patient_name}` : 'Doctor Consultation'}
        </h1>

        {!selectedVisit ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
            Select a patient from the list to begin consultation
          </div>
        ) : (
          <>
            {/* Vitals summary */}
            {vitals && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">Vitals</h3>
                <div className="grid grid-cols-4 gap-4">
                  <VitalChip label="BP" value={vitals.bp_systolic && vitals.bp_diastolic ? `${vitals.bp_systolic}/${vitals.bp_diastolic}` : '—'} unit="mmHg" />
                  <VitalChip label="Temp" value={vitals.temperature?.toString() ?? '—'} unit="°C" />
                  <VitalChip label="SpO₂" value={vitals.spo2?.toString() ?? '—'} unit="%" />
                  <VitalChip label="Pulse" value={vitals.pulse?.toString() ?? '—'} unit="bpm" />
                  <VitalChip label="Weight" value={vitals.weight?.toString() ?? '—'} unit="kg" />
                  <VitalChip label="Height" value={vitals.height?.toString() ?? '—'} unit="cm" />
                </div>
              </div>
            )}

            {/* SOAP form */}
            <form onSubmit={handleSubmit(d => saveConsultation(d))} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
              <SoapField label="Chief Complaint *" error={errors.chief_complaint?.message}>
                <textarea {...register('chief_complaint')} rows={2}
                  className={txtCls(!!errors.chief_complaint)}
                  placeholder="What brings the patient in today?" />
              </SoapField>

              <SoapField label="History of Present Illness">
                <textarea {...register('history')} rows={3}
                  className={txtCls(false)}
                  placeholder="Onset, duration, progression, associated symptoms…" />
              </SoapField>

              <SoapField label="Examination Findings">
                <textarea {...register('examination')} rows={3}
                  className={txtCls(false)}
                  placeholder="Physical examination observations…" />
              </SoapField>

              {/* ICD-10 Diagnoses */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">ICD-10 Diagnosis</label>
                  <button type="button" onClick={() => appendDiag({ code: '', description: '' })}
                    className="text-xs text-primary hover:underline font-medium">
                    + Add Diagnosis
                  </button>
                </div>
                <div className="space-y-2">
                  {diagFields.map((field, i) => (
                    <div key={field.id} className="flex gap-2 items-start">
                      <input {...register(`diagnoses.${i}.code`)}
                        placeholder="ICD code (e.g. J06.9)"
                        className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <input {...register(`diagnoses.${i}.description`)}
                        placeholder="Description"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <button type="button" onClick={() => removeDiag(i)}
                        className="text-gray-400 hover:text-red-500 mt-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <SoapField label="Clinical Notes / Instructions">
                <textarea {...register('notes')} rows={2}
                  className={txtCls(false)}
                  placeholder="Additional notes for the patient file…" />
              </SoapField>

              <SoapField label="Follow-up Date">
                <input {...register('follow_up_date')} type="date"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-48" />
              </SoapField>

              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setSelectedVisit(null)}
                  className="border border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={isPending}
                  className="bg-primary text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60">
                  {isPending ? 'Saving…' : 'Save & Write Prescription →'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function VitalChip({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="font-semibold text-gray-900">{value} <span className="text-xs text-gray-400 font-normal">{unit}</span></p>
    </div>
  )
}

function SoapField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  )
}

function txtCls(hasError: boolean) {
  return `w-full border ${hasError ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none`
}
