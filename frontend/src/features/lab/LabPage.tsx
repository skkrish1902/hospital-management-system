/**
 * Lab Orders Page
 *
 * Shows lab orders for the lab technician.
 * Flow: ordered → sample_collected → processing → resulted
 * When resulted, technician enters test results via a modal.
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { labService } from '@/services/labService'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { LabOrder } from '@/types/common'

const STATUS_FLOW: Record<string, { next: string; label: string; color: string } | null> = {
  ordered:          { next: 'sample_collected', label: 'Collect Sample',   color: 'blue' },
  sample_collected: { next: 'processing',        label: 'Start Processing', color: 'purple' },
  processing:       { next: 'resulted',          label: 'Enter Results',    color: 'green' },
  resulted:         null,
}

const STATUS_BADGE: Record<string, string> = {
  ordered:          'bg-gray-100 text-gray-600',
  sample_collected: 'bg-blue-100 text-blue-700',
  processing:       'bg-purple-100 text-purple-700',
  resulted:         'bg-green-100 text-green-700',
}

export default function LabPage() {
  const qc = useQueryClient()
  const [enterResultsFor, setEnterResultsFor] = useState<LabOrder | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  const { data: orders = [], refetch } = useQuery({
    queryKey: ['lab-orders'],
    queryFn: () => labService.listOrders(),
    refetchInterval: 30_000,
  })

  useWebSocket('lab:update', useCallback(() => refetch(), [refetch]))
  useWebSocket('visit:update', useCallback(() => refetch(), [refetch]))

  const { mutate: advance } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => {
      if (status === 'resulted') {
        // Open results modal instead of advancing directly
        const order = orders.find(o => o.id === id)
        if (order) {
          const initialResults: Record<string, string> = {}
          order.tests.forEach(t => { initialResults[t.test] = '' })
          setResults(initialResults)
          setEnterResultsFor(order)
        }
        return Promise.resolve({} as any)
      }
      return labService.updateStatus(id, status)
    },
    onSuccess: (_, vars) => {
      if (vars.status !== 'resulted') {
        qc.invalidateQueries({ queryKey: ['lab-orders'] })
      }
    },
  })

  const { mutate: submitResults, isPending: submitting } = useMutation({
    mutationFn: () => labService.enterResults(enterResultsFor!.id, results),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
      setEnterResultsFor(null)
    },
  })

  const active = orders.filter(o => o.status !== 'resulted')
  const resulted = orders.filter(o => o.status === 'resulted')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Laboratory Orders</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {active.length} active · {resulted.length} resulted today
        </p>
      </div>

      {active.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          No pending lab orders
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(order => (
            <LabOrderCard key={order.id} order={order} onAdvance={advance} />
          ))}
        </div>
      )}

      {resulted.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 list-none flex items-center gap-1">
            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {resulted.length} resulted orders today
          </summary>
          <div className="mt-2 space-y-2">
            {resulted.map(order => (
              <LabOrderCard key={order.id} order={order} onAdvance={advance} />
            ))}
          </div>
        </details>
      )}

      {/* Enter Results Modal */}
      {enterResultsFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEnterResultsFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Enter Lab Results</h2>
                <p className="text-xs text-gray-500 mt-0.5">{enterResultsFor.patient_name}</p>
              </div>
              <button onClick={() => setEnterResultsFor(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="p-5 space-y-4">
              {enterResultsFor.tests.map(t => (
                <div key={t.test}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t.test}{t.notes ? ` (${t.notes})` : ''}
                  </label>
                  <input
                    value={results[t.test] || ''}
                    onChange={e => setResults(prev => ({ ...prev, [t.test]: e.target.value }))}
                    placeholder="Enter result value…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEnterResultsFor(null)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  disabled={submitting || Object.values(results).every(v => !v.trim())}
                  onClick={() => submitResults()}
                  className="flex-1 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save Results'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LabOrderCard({
  order,
  onAdvance,
}: {
  order: LabOrder
  onAdvance: (args: { id: string; status: string }) => void
}) {
  const next = STATUS_FLOW[order.status]
  const btnColor: Record<string, string> = {
    blue:   'bg-blue-600 hover:bg-blue-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
    green:  'bg-green-600 hover:bg-green-700',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-gray-900">{order.patient_name || 'Patient'}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] || ''}`}>
              {order.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            {order.doctor_name ? `Dr. ${order.doctor_name}` : ''} · {new Date(order.ordered_at).toLocaleTimeString()}
          </p>

          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Tests ordered:</p>
            <div className="flex flex-wrap gap-1.5">
              {order.tests.map((t, i) => (
                <span key={i} className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                  {t.test}{t.notes ? ` (${t.notes})` : ''}
                </span>
              ))}
            </div>
          </div>
        </div>

        {next && (
          <button
            onClick={() => onAdvance({ id: order.id, status: next.next })}
            className={`shrink-0 px-4 py-2 text-white rounded-lg text-sm font-medium ${btnColor[next.color] || 'bg-gray-600'}`}
          >
            {next.label}
          </button>
        )}
      </div>
    </div>
  )
}
