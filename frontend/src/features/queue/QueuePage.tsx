import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from '@/hooks/useWebSocket'
import { queueService } from '@/services/queueService'
import { patientService } from '@/services/patientService'
import { departmentService, doctorService } from '@/services/clinicalService'
import type { Doctor, Patient, QueueToken } from '@/types/common'

const PRIORITY_BADGE: Record<string, string> = {
  emergency: 'bg-red-100 text-red-700',
  senior_citizen: 'bg-yellow-100 text-yellow-700',
  normal: 'bg-gray-100 text-gray-600',
}

const STATUS_BADGE: Record<string, string> = {
  checked_in: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
}

export default function QueuePage() {
  const [issueForm, setIssueForm] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [priority, setPriority] = useState('normal')
  const [selectedDeptId, setSelectedDeptId] = useState<string>('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('')
  const [filterDeptId, setFilterDeptId] = useState<string>('')

  // Edit modal
  const [editToken, setEditToken] = useState<QueueToken | null>(null)
  const [editDeptId, setEditDeptId] = useState<string>('')
  const [editDoctorId, setEditDoctorId] = useState<string>('')
  const [editPriority, setEditPriority] = useState<string>('')

  // Cancel modal
  const [cancelToken, setCancelToken] = useState<QueueToken | null>(null)
  const [cancelStep, setCancelStep] = useState<'confirm' | 'notes'>('confirm')
  const [cancelNotes, setCancelNotes] = useState<string>('')

  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => departmentService.list(),
  })

  const { data: tokens = [], refetch } = useQuery<QueueToken[]>({
    queryKey: ['queue', filterDeptId],
    queryFn: () => queueService.list({ department_id: filterDeptId || undefined }),
    refetchInterval: 30_000,
  })

  const { data: patients = [] } = useQuery({
    queryKey: ['patients', patientSearch],
    queryFn: () => patientService.list(patientSearch || undefined),
    enabled: issueForm,
    staleTime: 10_000,
  })

  const { data: deptDoctors = [] } = useQuery<Doctor[]>({
    queryKey: ['doctors', 'by-dept', selectedDeptId],
    queryFn: () => doctorService.list({ department_id: selectedDeptId }),
    enabled: !!selectedDeptId,
    staleTime: 30_000,
  })

  const { data: editDeptDoctors = [] } = useQuery<Doctor[]>({
    queryKey: ['doctors', 'by-dept', editDeptId],
    queryFn: () => doctorService.list({ department_id: editDeptId }),
    enabled: !!editDeptId,
    staleTime: 30_000,
  })

  useWebSocket('queue:update', useCallback(() => { refetch() }, [refetch]))

  const closeIssue = () => {
    setIssueForm(false)
    setSelectedPatient(null)
    setPatientSearch('')
    setPriority('normal')
    setSelectedDeptId('')
    setSelectedDoctorId('')
  }

  const { mutate: issueToken, isPending: issuing } = useMutation({
    mutationFn: () => queueService.issue({
      patient_id: selectedPatient!.id,
      queue_type: 'consultation',
      department_id: selectedDeptId || undefined,
      doctor_id: selectedDoctorId || undefined,
      priority,
    }),
    onSuccess: (token) => {
      qc.invalidateQueries({ queryKey: ['queue'] })
      closeIssue()
      if (token.visit_id) {
        navigate(`/billing?visitId=${token.visit_id}&returnTo=queue`)
      }
    },
  })

  const { mutate: editMut, isPending: editing } = useMutation({
    mutationFn: () => queueService.edit(editToken!.id, {
      department_id: editDeptId || undefined,
      doctor_id: editDoctorId || undefined,
      priority: editPriority || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue'] }); setEditToken(null) },
  })

  const { mutate: cancelMut, isPending: cancelling } = useMutation({
    mutationFn: () => queueService.cancel(cancelToken!.id, cancelNotes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
      setCancelToken(null)
      setCancelStep('confirm')
      setCancelNotes('')
    },
  })

  const checkedIn = tokens.filter(t => t.status === 'checked_in').length
  const completed = tokens.filter(t => t.status === 'completed').length
  const cancelled = tokens.filter(t => t.status === 'cancelled').length

  const openEdit = (token: QueueToken) => {
    setEditToken(token)
    setEditDeptId(token.department_id ?? '')
    setEditDoctorId(token.doctor_id ?? '')
    setEditPriority(token.priority)
  }

  const openCancel = (token: QueueToken) => {
    setCancelToken(token)
    setCancelStep('confirm')
    setCancelNotes('')
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">OPD Queue Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time patient queue management</p>
        </div>
        <button
          onClick={() => setIssueForm(true)}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Issue Token
        </button>
      </div>

      {/* Department filter */}
      {departments.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filter by department:</span>
          <select
            value={filterDeptId}
            onChange={e => setFilterDeptId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Checked In" value={checkedIn} color="blue" />
        <StatCard label="Completed" value={completed} color="green" />
        <StatCard label="Cancelled" value={cancelled} color="red" />
      </div>

      {/* Token table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Token', 'Priority', 'Patient', 'Phone', 'Department', 'Doctor', 'Status', 'Issued', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">Queue is empty</td>
              </tr>
            ) : tokens.map((token) => (
              <tr
                key={token.id}
                className={`hover:bg-gray-50 ${token.status === 'cancelled' ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-3">
                  <span className="text-2xl font-bold text-primary tabular-nums">{token.token_no}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[token.priority] || ''}`}>
                    {token.priority.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{token.patient_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{token.patient_phone || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{token.department_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{token.doctor_name || '—'}</td>
                <td className="px-4 py-3">
                  <span
                    title={token.status === 'cancelled' && token.notes ? `Reason: ${token.notes}` : undefined}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-default ${STATUS_BADGE[token.status] || 'bg-gray-100 text-gray-600'}`}
                  >
                    {token.status.replace('_', ' ')}
                    {token.status === 'cancelled' && token.notes && (
                      <span className="ml-1 text-red-400">ⓘ</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(token.issued_at).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3">
                  {token.status === 'checked_in' && (
                    <div className="flex items-center gap-2">
                      {/* Edit icon */}
                      <button
                        onClick={() => openEdit(token)}
                        title="Edit token"
                        className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {/* Cancel icon */}
                      <button
                        onClick={() => openCancel(token)}
                        title="Cancel visit"
                        className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issue Token Modal */}
      {issueForm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={closeIssue}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Issue Queue Token</h2>
              <button onClick={closeIssue} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Search Patient</label>
                <input
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  placeholder="Name, phone or UHID…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {patientSearch && patients.length > 0 && (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {patients.map((p: Patient) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPatient(p); setPatientSearch('') }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${selectedPatient?.id === p.id ? 'bg-blue-50' : ''}`}
                    >
                      <div className="font-medium">{p.first_name} {p.last_name}</div>
                      <div className="text-xs text-gray-400">{p.uhid} · {p.phone}</div>
                    </button>
                  ))}
                </div>
              )}

              {selectedPatient && (
                <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
                  <span>
                    <span className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</span>
                    <span className="text-xs text-blue-600 ml-2">{selectedPatient.uhid}</span>
                  </span>
                  <button onClick={() => setSelectedPatient(null)} className="text-blue-400 hover:text-blue-700 text-xs">✕</button>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="normal">Normal</option>
                  <option value="senior_citizen">Senior Citizen</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>

              {departments.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                  <select value={selectedDeptId} onChange={e => { setSelectedDeptId(e.target.value); setSelectedDoctorId('') }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">— Select department —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}

              {selectedDeptId && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Doctor</label>
                  {deptDoctors.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">No doctors found for this department</p>
                  ) : (
                    <select value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="">— Select doctor —</option>
                      {deptDoctors.map((d: Doctor) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                    </select>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={closeIssue}
                  className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  disabled={!selectedPatient || issuing}
                  onClick={() => issueToken()}
                  className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {issuing ? 'Issuing…' : 'Issue Token'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Token Modal */}
      {editToken && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setEditToken(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Edit Token #{editToken.token_no}</h2>
              <button onClick={() => setEditToken(null)} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                <select value={editPriority} onChange={e => setEditPriority(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="normal">Normal</option>
                  <option value="senior_citizen">Senior Citizen</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                <select value={editDeptId} onChange={e => { setEditDeptId(e.target.value); setEditDoctorId('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">— No change —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {editDeptId && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Doctor</label>
                  {editDeptDoctors.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">No doctors found for this department</p>
                  ) : (
                    <select value={editDoctorId} onChange={e => setEditDoctorId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="">— No change —</option>
                      {editDeptDoctors.map((d: Doctor) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                    </select>
                  )}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditToken(null)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  disabled={editing}
                  onClick={() => editMut()}
                  className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {editing ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelToken && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => { setCancelToken(null); setCancelStep('confirm'); setCancelNotes('') }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            {cancelStep === 'confirm' ? (
              <>
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Cancel Visit?</h3>
                      <p className="text-sm text-gray-500">Token #{cancelToken.token_no} — {cancelToken.patient_name}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">Do you want to cancel this visit? This action cannot be undone.</p>
                </div>
                <div className="px-5 pb-5 flex gap-3">
                  <button
                    onClick={() => { setCancelToken(null); setCancelStep('confirm'); setCancelNotes('') }}
                    className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                  >
                    No, keep it
                  </button>
                  <button
                    onClick={() => setCancelStep('notes')}
                    className="flex-1 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-red-700"
                  >
                    Yes, cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Reason for Cancellation</h3>
                  <button onClick={() => setCancelStep('confirm')} className="text-gray-400 hover:text-gray-700 text-xs">← Back</button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Notes <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={cancelNotes}
                      onChange={e => setCancelNotes(e.target.value)}
                      rows={3}
                      placeholder="Enter reason for cancellation…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
                    />
                    {cancelNotes.trim() === '' && (
                      <p className="text-xs text-red-500 mt-1">Notes are required to cancel a visit</p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setCancelToken(null); setCancelStep('confirm'); setCancelNotes('') }}
                      className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                    >
                      Discard
                    </button>
                    <button
                      disabled={cancelNotes.trim() === '' || cancelling}
                      onClick={() => cancelMut()}
                      className="flex-1 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    gray: 'bg-gray-50 text-gray-700',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${colorMap[color] || ''} rounded-lg px-2 py-0.5 inline-block`}>{value}</p>
    </div>
  )
}
