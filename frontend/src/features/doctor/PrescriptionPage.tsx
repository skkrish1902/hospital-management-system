/**
 * Prescription Builder Page
 *
 * Route: /doctor/prescription/:visitId
 * Doctor adds medicines (name, dose, frequency, duration, route) + instructions
 * then saves → visit moves to prescription_done → billing queue
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { visitService } from '@/services/visitService'
import { prescriptionService } from '@/services/clinicalService'

const FREQUENCIES = ['OD', 'BD', 'TID', 'QID', 'SOS', 'QHS', 'Q4H', 'Q6H', 'Q8H']
const ROUTES = ['oral', 'topical', 'IV', 'IM', 'SC', 'sublingual', 'inhaled', 'rectal']
const DURATIONS = ['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '1 month', 'Ongoing']

const medicineSchema = z.object({
  name: z.string().min(1, 'Drug name required'),
  dose: z.string().min(1, 'Dose required'),
  frequency: z.string().min(1, 'Frequency required'),
  duration: z.string().min(1, 'Duration required'),
  route: z.string().default('oral'),
  notes: z.string().optional(),
})

const rxSchema = z.object({
  medicines: z.array(medicineSchema).min(1, 'Add at least one medicine'),
  instructions: z.string().optional(),
})

type RxForm = z.infer<typeof rxSchema>

export default function PrescriptionPage() {
  const { visitId } = useParams<{ visitId: string }>()
  const navigate = useNavigate()

  const { data: visit } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => visitService.get(visitId!),
    enabled: !!visitId,
  })

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RxForm>({
    resolver: zodResolver(rxSchema),
    defaultValues: { medicines: [{ name: '', dose: '', frequency: 'OD', duration: '5 days', route: 'oral' }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'medicines' })

  const { mutate: savePrescription, isPending } = useMutation({
    mutationFn: (data: RxForm) => prescriptionService.create({
      visit_id: visitId!,
      medicines: data.medicines,
      instructions: data.instructions,
    }),
    onSuccess: () => navigate(`/billing?visitId=${visitId}`),
  })

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Prescription Builder</h1>
          {visit && (
            <p className="text-sm text-gray-500 mt-0.5">
              Patient: <span className="font-medium text-gray-700">{visit.patient_name}</span>
            </p>
          )}
        </div>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      <form onSubmit={handleSubmit(d => savePrescription(d))} className="space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Medicines</h2>
            <button
              type="button"
              onClick={() => append({ name: '', dose: '', frequency: 'OD', duration: '5 days', route: 'oral' })}
              className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Medicine
            </button>
          </div>

          {errors.medicines?.root && (
            <p className="text-xs text-red-600 px-5 pt-2">{errors.medicines.root.message}</p>
          )}

          <div className="divide-y divide-gray-100">
            {fields.map((field, i) => (
              <div key={field.id} className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase">Medicine {i + 1}</span>
                  {fields.length > 1 && (
                    <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Drug Name *</label>
                    <input
                      {...register(`medicines.${i}.name`)}
                      placeholder="e.g. Paracetamol 500mg"
                      className={rx_input(!!errors.medicines?.[i]?.name)}
                    />
                    {errors.medicines?.[i]?.name && (
                      <p className="text-xs text-red-600 mt-0.5">{errors.medicines[i]?.name?.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Dose *</label>
                    <input {...register(`medicines.${i}.dose`)} placeholder="e.g. 500mg" className={rx_input(!!errors.medicines?.[i]?.dose)} />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Frequency *</label>
                    <select {...register(`medicines.${i}.frequency`)} className={rx_input(false)}>
                      {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Duration *</label>
                    <select {...register(`medicines.${i}.duration`)} className={rx_input(false)}>
                      {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Route</label>
                    <select {...register(`medicines.${i}.route`)} className={rx_input(false)}>
                      {ROUTES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <input {...register(`medicines.${i}.notes`)} placeholder="e.g. Take after food" className={rx_input(false)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">General Instructions</label>
          <textarea
            {...register('instructions')}
            rows={3}
            placeholder="Diet, rest, follow-up instructions for the patient…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="border border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Back
          </button>
          <button type="submit" disabled={isPending}
            className="bg-primary text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2">
            {isPending ? 'Saving…' : (
              <>
                Save Prescription & Proceed to Billing
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

function rx_input(hasError: boolean) {
  return `w-full border ${hasError ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary`
}
