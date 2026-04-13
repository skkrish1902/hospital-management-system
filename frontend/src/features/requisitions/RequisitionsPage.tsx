import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ClipboardList, X, ChevronDown } from 'lucide-react'
import apiClient from '@/services/apiClient'
import { useAuthStore } from '@/features/auth/authStore'

// ── Types ──────────────────────────────────────────────────────────────────

interface Requisition {
  id: string
  seq: number
  indent_number: string
  requested_by_id: string
  requested_by_name: string
  from_location: string
  to_location: string
  request_date: string
  need_by_date: string
  items: string | null
  status: string
  created_at: string
}

interface CreatePayload {
  from_location: string
  to_location: string
  need_by_date: string
  items?: string
}

// ── Master department list ─────────────────────────────────────────────────

const HOSPITAL_DEPARTMENTS = [
  'Reception / Front Office',
  'OPD - General Medicine',
  'OPD - Paediatrics',
  'OPD - Gynaecology & Obstetrics',
  'OPD - Orthopaedics',
  'OPD - ENT',
  'OPD - Ophthalmology',
  'OPD - Dermatology',
  'OPD - Cardiology',
  'OPD - Neurology',
  'OPD - Psychiatry',
  'OPD - Oncology',
  'OPD - Urology',
  'OPD - Nephrology',
  'OPD - Endocrinology',
  'OPD - Pulmonology',
  'OPD - Gastroenterology',
  'Emergency / Casualty',
  'ICU / Critical Care',
  'Operation Theater (OT)',
  'Post-Operative Ward',
  'General Ward',
  'Private Ward',
  'Labour Room / Delivery Suite',
  'Neonatal ICU (NICU)',
  'Paediatric Ward',
  'Pharmacy',
  'Laboratory / Pathology',
  'Radiology / Imaging',
  'Physiotherapy & Rehabilitation',
  'Dietetics & Nutrition',
  'Blood Bank',
  'CSSD (Sterile Supply)',
  'Laundry',
  'Housekeeping',
  'Biomedical Engineering',
  'Medical Records',
  'Ambulance / Transport',
  'Administration',
  'Accounts & Billing',
  'HR / Staffing',
  'Security',
  'Canteen / Kitchen',
  'Mortuary',
]

// ── API helpers ────────────────────────────────────────────────────────────

const fetchRequisitions = (mine: boolean) =>
  apiClient.get<Requisition[]>('/indents', { params: mine ? { mine: true } : {} }).then(r => r.data)

const createRequisition = (payload: CreatePayload) =>
  apiClient.post<Requisition>('/indents', payload).then(r => r.data)

const updateStatus = (id: string, status: string) =>
  apiClient.patch<Requisition>(`/indents/${id}/status`, { status }).then(r => r.data)

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  approved:  'bg-blue-100 text-blue-700',
  rejected:  'bg-red-100 text-red-600',
  fulfilled: 'bg-green-100 text-green-700',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pending',
  approved:  'Approved',
  rejected:  'Rejected',
  fulfilled:  'Fulfilled',
}

const TO_LOCATIONS = ['Pharmacy', 'General Store']

// ── Add Indent Modal ──────────────────────────────────────────────────

function AddRequisitionModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose: () => void
  onSubmit: (payload: CreatePayload) => void
  submitting: boolean
}) {
  const today = new Date().toISOString().split('T')[0]
  const [fromLocation, setFromLocation] = useState('')
  const [toLocation, setToLocation] = useState(TO_LOCATIONS[0])
  const [needByDate, setNeedByDate] = useState('')
  const [items, setItems] = useState('')

  const handleSubmit = () => {
    if (!fromLocation || !needByDate) return
    onSubmit({
      from_location: fromLocation,
      to_location: toLocation,
      need_by_date: needByDate,
      items: items.trim(),
    })
  }

  const isValid = !!fromLocation && !!needByDate && !!items.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Indent</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From</label>
            <div className="relative">
              <select
                value={fromLocation}
                onChange={e => setFromLocation(e.target.value)}
                className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select department…</option>
                {HOSPITAL_DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To</label>
            <div className="flex gap-2">
              {TO_LOCATIONS.map(loc => (
                <button
                  key={loc}
                  onClick={() => setToLocation(loc)}
                  className={`flex-1 py-1.5 rounded-lg border text-sm font-medium transition-colors ${toLocation === loc ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>

          {/* Request Date (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Request Date</label>
            <input
              type="date"
              value={today}
              readOnly
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {/* Need By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Need By <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={needByDate}
              min={today}
              onChange={e => setNeedByDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Items */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Items / Notes <span className="text-red-500">*</span></label>
            <textarea
              value={items}
              onChange={e => setItems(e.target.value)}
              rows={3}
              placeholder="List items being requested…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Indent'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status Dropdown (admin only) ────────────────────────────────────────────

function StatusDropdown({ requisition, onUpdate }: { requisition: Requisition; onUpdate: (id: string, status: string) => void }) {
  const statuses = ['pending', 'approved', 'rejected', 'fulfilled']
  return (
    <div className="relative">
      <select
        value={requisition.status}
        onChange={e => onUpdate(requisition.id, e.target.value)}
        className={`appearance-none text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${STATUS_BADGE[requisition.status] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function RequisitionsPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'hospital_admin'

  const [showAdd, setShowAdd] = useState(false)
  const [viewMine, setViewMine] = useState(!isAdmin)

  const { data: requisitions = [], isLoading } = useQuery({
    queryKey: ['indents', viewMine],
    queryFn: () => fetchRequisitions(viewMine),
    refetchInterval: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: createRequisition,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['indents'] })
      setShowAdd(false)
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['indents'] }),
  })

  const handleStatusUpdate = useCallback((id: string, status: string) => {
    statusMutation.mutate({ id, status })
  }, [statusMutation])

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Indent</h1>
          <p className="text-sm text-gray-500 mt-0.5">Raise and track internal supply requests across departments.</p>
        </div>
        {!isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Indent
          </button>
        )}
      </div>

      {/* Filter toggle (admin) */}
      {isAdmin && (
        <div className="flex gap-2">
          <button
            onClick={() => setViewMine(false)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${!viewMine ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
          >
            All Indents
          </button>
          <button
            onClick={() => setViewMine(true)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${viewMine ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
          >
            My Indents
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading…</div>
        ) : requisitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
              <ClipboardList className="w-7 h-7 text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">No indents yet</p>
              <p className="text-xs text-gray-400 mt-1">{isAdmin ? 'No indents have been raised yet.' : 'Click "Add Indent" to raise your first request.'}</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">#Indent</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Order Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">From</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested To</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Need By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Items / Notes</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requisitions.map(req => (
                  <tr key={req.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{req.indent_number}</td>
                    <td className="px-4 py-3 text-gray-600">{req.request_date}</td>
                    <td className="px-4 py-3 text-gray-700">{req.requested_by_name}</td>
                    <td className="px-4 py-3 text-gray-700">{req.from_location}</td>
                    <td className="px-4 py-3 text-gray-700">{req.to_location}</td>
                    <td className="px-4 py-3 text-gray-600">{req.need_by_date}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={req.items ?? ''}>{req.items}</td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <StatusDropdown requisition={req} onUpdate={handleStatusUpdate} />
                      ) : (
                        <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[req.status] ?? req.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <AddRequisitionModal
          onClose={() => setShowAdd(false)}
          onSubmit={payload => createMutation.mutate(payload)}
          submitting={createMutation.isPending}
        />
      )}
    </div>
  )
}
