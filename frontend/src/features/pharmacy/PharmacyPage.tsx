/**
 * Pharmacy Queue Page
 *
 * Shows patients dispatched to pharmacy.
 * Pharmacist progresses: pending → preparing → ready → dispensed
 * When dispensed, prints the doctor prescription and visit moves to billing_pending.
 */
import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pharmacyService } from '@/services/pharmacyService'
import { visitService, consultationService } from '@/services/visitService'
import { prescriptionService } from '@/services/clinicalService'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useAuthStore } from '@/features/auth/authStore'
import { printPrescription } from '@/utils/printPrescription'
import type { PharmacyQueueItem } from '@/types/common'

const STATUS_FLOW: Record<string, { next: string; label: string; color: string } | null> = {
  pending:   { next: 'preparing', label: 'Start Preparing', color: 'blue' },
  preparing: { next: 'ready',     label: 'Mark Ready',     color: 'amber' },
  ready:     { next: 'dispensed', label: 'Dispense',       color: 'green' },
  dispensed: null,
}

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-gray-100 text-gray-600',
  preparing: 'bg-blue-100 text-blue-700',
  ready:     'bg-amber-100 text-amber-700',
  dispensed: 'bg-green-100 text-green-700',
  partial:   'bg-yellow-100 text-yellow-700',
}

export default function PharmacyPage() {
  const qc = useQueryClient()
  const hospitalName = useAuthStore(s => s.user?.hospitalName ?? s.user?.tenantSchema ?? 'Hospital')
  const [dispensing, setDispensing] = useState<string | null>(null) // pq item id being dispensed

  const { data: items = [], refetch } = useQuery({
    queryKey: ['pharmacy'],
    queryFn: () => pharmacyService.list(),
    refetchInterval: 30_000,
  })

  useWebSocket('pharmacy:update', useCallback(() => refetch(), [refetch]))
  useWebSocket('visit:update', useCallback(() => refetch(), [refetch]))

  const { mutate: advance, isPending } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      pharmacyService.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy'] }),
  })

  // Dispense: print prescription first, then advance status
  const handleDispense = useCallback(async (item: PharmacyQueueItem) => {
    if (!item.visit_id || dispensing) return
    setDispensing(item.id)
    try {
      const visitId = String(item.visit_id)
      const [visit, prescription, consultation] = await Promise.allSettled([
        visitService.get(visitId),
        prescriptionService.get(visitId),
        consultationService.get(visitId),
      ])
      printPrescription(
        visit.status === 'fulfilled'
          ? visit.value
          : { patient_name: item.patient_name, created_at: item.updated_at, doctor_name: undefined, department_name: undefined } as any,
        prescription.status === 'fulfilled' ? prescription.value : null,
        consultation.status === 'fulfilled' ? consultation.value : null,
        hospitalName,
      )
    } finally {
      advance({ id: item.id, status: 'dispensed' })
      setDispensing(null)
    }
  }, [dispensing, hospitalName, advance])

  const active = items.filter((i: PharmacyQueueItem) => i.status !== 'dispensed')
  const dispensed = items.filter((i: PharmacyQueueItem) => i.status === 'dispensed')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Pharmacy Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {active.length} active · {dispensed.length} dispensed today
        </p>
      </div>

      {/* Active orders */}
      {active.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          No pending pharmacy orders
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((item: PharmacyQueueItem) => <PharmacyCard key={item.id} item={item} onAdvance={advance} onDispense={handleDispense} advancing={isPending || dispensing === item.id} />)}
        </div>
      )}

      {/* Dispensed (collapsed) */}
      {dispensed.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 list-none flex items-center gap-1">
            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {dispensed.length} dispensed orders today
          </summary>
          <div className="mt-2 space-y-2">
            {dispensed.map((item: PharmacyQueueItem) => <PharmacyCard key={item.id} item={item} onAdvance={advance} onDispense={handleDispense} advancing={isPending} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function PharmacyCard({
  item,
  onAdvance,
  onDispense,
  advancing,
}: {
  item: PharmacyQueueItem
  onAdvance: (args: { id: string; status: string }) => void
  onDispense: (item: PharmacyQueueItem) => void
  advancing: boolean
}) {
  const next = STATUS_FLOW[item.status]
  const btnColor: Record<string, string> = {
    blue:  'bg-blue-600 hover:bg-blue-700',
    amber: 'bg-amber-500 hover:bg-amber-600',
    green: 'bg-green-600 hover:bg-green-700',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-gray-900">{item.patient_name || 'Patient'}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[item.status] || ''}`}>
              {item.status}
            </span>
          </div>
          <p className="text-xs text-gray-400">{new Date(item.updated_at).toLocaleTimeString()}</p>

          {item.medicines && item.medicines.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-1.5">Medicines:</p>
              <div className="space-y-1">
                {item.medicines.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                    <span className="font-medium text-gray-800">{m.name}</span>
                    {m.dose && <span className="text-gray-500">{m.dose}</span>}
                    {m.frequency && <span className="text-gray-400 text-xs">— {m.frequency}</span>}
                    {m.duration && <span className="text-gray-400 text-xs">× {m.duration}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {next && (
          <button
            disabled={advancing}
            onClick={() => next.next === 'dispensed' ? onDispense(item) : onAdvance({ id: item.id, status: next.next })}
            className={`shrink-0 px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${btnColor[next.color] || 'bg-gray-600'}`}
          >
            {advancing && next.next === 'dispensed' ? 'Printing…' : next.label}
          </button>
        )}
      </div>
    </div>
  )
}
