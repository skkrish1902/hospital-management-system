import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from '@/hooks/useWebSocket'
import { queueService } from '@/services/queueService'
import { patientService } from '@/services/patientService'
import { departmentService, doctorService } from '@/services/clinicalService'
import type { Doctor, Patient, QueueType } from '@/types/common'

const QUEUE_TYPES: { value: QueueType; label: string; color: string }[] = [
  { value: 'registration', label: 'Registration', color: 'blue' },
  { value: 'vitals', label: 'Vitals', color: 'purple' },
  { value: 'consultation', label: 'Consultation', color: 'green' },
  { value: 'pharmacy', label: 'Pharmacy', color: 'orange' },
  { value: 'billing', label: 'Billing', color: 'yellow' },
]

const PRIORITY_BADGE: Record<string, string> = {
  emergency: 'bg-red-100 text-red-700',
  senior_citizen: 'bg-yellow-100 text-yellow-700',
  normal: 'bg-gray-100 text-gray-600',
}

const STATUS_BADGE: Record<string, string> = {
  waiting: 'bg-blue-50 text-blue-700',
  called: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-purple-50 text-purple-700',
  completed: 'bg-green-50 text-green-700',
  skipped: 'bg-gray-50 text-gray-500',
}

export default function QueuePage() {
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as QueueType) ?? 'registration'
  const [activeTab, setActiveTab] = useState<QueueType>(initialTab)
  const [issueForm, setIssueForm] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [priority, setPriority] = useState('normal')
  const [selectedDeptId, setSelectedDeptId] = useState<string>('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('')
  const [filterDeptId, setFilterDeptId] = useState<string>('')
  const qc = useQueryClient()

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => departmentService.list(),
  })

  const { data: tokens = [], refetch } = useQuery({
    queryKey: ['queue', activeTab, filterDeptId],
    queryFn: () => queueService.list({ queue_type: activeTab, department_id: filterDeptId || undefined }),
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

  // Real-time updates
  useWebSocket('queue:update', useCallback(() => {
    refetch()
  }, [refetch]))

  const { mutate: issueToken, isPending: issuing } = useMutation({
    mutationFn: () => queueService.issue({
      patient_id: selectedPatient!.id,
      queue_type: activeTab,
      department_id: selectedDeptId || undefined,
      doctor_id: selectedDoctorId || undefined,
      priority,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
      setIssueForm(false)
      setSelectedPatient(null)
      setPatientSearch('')
      setPriority('normal')
      setSelectedDeptId('')
      setSelectedDoctorId('')
    },
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ tokenId, status }: { tokenId: string; status: string }) =>
      queueService.updateStatus(tokenId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  })

  const { mutate: checkIn } = useMutation({
    mutationFn: (tokenId: string) => queueService.checkIn(tokenId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  })

  const waitingCount = tokens.filter(t => t.status === 'waiting').length
  const calledToken = tokens.find(t => t.status === 'called' || t.status === 'in_progress')

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

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Waiting" value={waitingCount} color="blue" />
        <StatCard label="Now Serving" value={calledToken?.token_no ?? '—'} color="green" />
        <StatCard label="Total Today" value={tokens.length} color="gray" />
      </div>

      {/* Queue type tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {QUEUE_TYPES.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === tab.value
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
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
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">Queue is empty</td>
              </tr>
            ) : tokens.map((token: any) => (
              <tr key={token.id} className="hover:bg-gray-50">
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[token.status] || ''}`}>
                    {token.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(token.issued_at).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {token.status === 'waiting' && (
                      <>
                        <ActionBtn onClick={() => checkIn(token.id)} label="Check-in" color="green" />
                        <ActionBtn onClick={() => updateStatus({ tokenId: token.id, status: 'called' })} label="Call" color="blue" />
                      </>
                    )}
                    {token.status === 'called' && (
                      <>
                        <ActionBtn onClick={() => updateStatus({ tokenId: token.id, status: 'in_progress' })} label="Start" color="green" />
                        <ActionBtn onClick={() => updateStatus({ tokenId: token.id, status: 'skipped' })} label="Skip" color="gray" />
                      </>
                    )}
                    {token.status === 'in_progress' && (
                      <ActionBtn onClick={() => updateStatus({ tokenId: token.id, status: 'completed' })} label="Done" color="green" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issue token modal */}
      {issueForm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => { setIssueForm(false); setSelectedDoctorId(''); setSelectedDeptId('') }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Issue Queue Token</h2>
              <button onClick={() => { setIssueForm(false); setSelectedDoctorId(''); setSelectedDeptId('') }} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Patient search */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Search Patient</label>
                <input
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  placeholder="Name, phone or UHID…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Patient results */}
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
                <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</span>
                  <span className="text-xs text-blue-600 ml-2">{selectedPatient.uhid}</span>
                </div>
              )}

              {/* Priority */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="normal">Normal</option>
                  <option value="senior_citizen">Senior Citizen</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>

              {/* Department */}
              {departments.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                  <select
                    value={selectedDeptId}
                    onChange={e => { setSelectedDeptId(e.target.value); setSelectedDoctorId('') }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">— Select department —</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Doctor — shown once a department is selected */}
              {selectedDeptId && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Doctor</label>
                  {deptDoctors.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">No doctors found for this department</p>
                  ) : (
                    <select
                      value={selectedDoctorId}
                      onChange={e => setSelectedDoctorId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">— Select doctor —</option>
                      {deptDoctors.map((d: Doctor) => (
                        <option key={d.id} value={d.id}>{d.full_name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setIssueForm(false); setSelectedDoctorId(''); setSelectedDeptId('') }}
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
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    gray: 'bg-gray-50 text-gray-700',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${colorMap[color] || ''} rounded-lg px-2 py-0.5 inline-block`}>{value}</p>
    </div>
  )
}

function ActionBtn({ onClick, label, color }: { onClick: () => void; label: string; color: string }) {
  const cls: Record<string, string> = {
    blue: 'text-blue-600 hover:bg-blue-50',
    green: 'text-green-600 hover:bg-green-50',
    gray: 'text-gray-500 hover:bg-gray-100',
  }
  return (
    <button onClick={onClick} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${cls[color] || ''}`}>
      {label}
    </button>
  )
}
