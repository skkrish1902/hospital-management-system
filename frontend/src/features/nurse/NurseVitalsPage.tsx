/**
 * Nurse Vitals Screen
 *
 * 1. Shows visits with status "registered" (awaiting vitals)
 * 2. Nurse selects a patient → records vitals → visit moves to "vitals_done"
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { visitService, vitalsService, type VitalsCreate } from '@/services/visitService'
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

export default function NurseVitalsPage() {
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const qc = useQueryClient()

  const { data: visits = [], refetch } = useQuery({
    queryKey: ['visits', 'registered'],
    queryFn: () => visitService.list({ status: 'registered' }),
    refetchInterval: 30_000,
  })

  useWebSocket('visit:update', useCallback(() => refetch(), [refetch]))

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VitalsForm>({ resolver: zodResolver(vitalsSchema) })

  const { mutate: submitVitals, isPending, error } = useMutation({
    mutationFn: (data: VitalsCreate) => vitalsService.record(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] })
      setSelectedVisit(null)
      reset()
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Nurse Vitals Station</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Patients waiting for vitals — {visits.length} in queue
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patient list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Awaiting Vitals</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {visits.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                All caught up!
              </div>
            ) : visits.map(v => (
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
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    Waiting
                  </span>
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
              {error && (
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
