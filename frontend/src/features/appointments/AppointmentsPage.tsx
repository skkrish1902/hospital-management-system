/**
 * Appointments Page — day-view calendar, slot booking, check-in
 *
 * Layout:
 *   Top: date picker + doctor filter + "Book" button
 *   Left: list of today's appointments with status badges + check-in / cancel actions
 *   Right: slot availability grid for selected doctor
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { appointmentService, doctorService } from '@/services/clinicalService'
import { patientService } from '@/services/patientService'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Appointment, AppointmentSlot, Doctor, Patient } from '@/types/common'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  scheduled:  'bg-blue-100 text-blue-700',
  confirmed:  'bg-indigo-100 text-indigo-700',
  checked_in: 'bg-yellow-100 text-yellow-700',
  completed:  'bg-green-100 text-green-700',
  cancelled:  'bg-red-100 text-red-600',
  no_show:    'bg-gray-100 text-gray-500',
}

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}>
    {status.replace('_', ' ')}
  </span>
)

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

// ── Book Modal ─────────────────────────────────────────────────────────────────

const bookSchema = z.object({
  patient_id: z.string().min(1, 'Select a patient'),
  doctor_id:  z.string().min(1, 'Select a doctor'),
  slot_time:  z.string().min(1, 'Select a slot'),
  notes:      z.string().optional(),
  type:       z.enum(['pre_booked', 'walkin']),
})
type BookForm = z.infer<typeof bookSchema>

function BookModal({
  onClose,
  selectedDate,
  doctors,
}: {
  onClose: () => void
  selectedDate: string
  doctors: Doctor[]
}) {
  const qc = useQueryClient()
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<BookForm>({
    resolver: zodResolver(bookSchema),
    defaultValues: { type: 'pre_booked', slot_time: '' },
  })

  const watchedDoctorId = watch('doctor_id')

  const { data: slots = [] } = useQuery<AppointmentSlot[]>({
    queryKey: ['slots', watchedDoctorId, selectedDate],
    queryFn: () => appointmentService.slots(watchedDoctorId, selectedDate),
    enabled: !!watchedDoctorId,
  })

  const bookMut = useMutation({
    mutationFn: appointmentService.book,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      onClose()
    },
  })

  const searchPatients = async (q: string) => {
    if (q.length < 2) { setPatientResults([]); return }
    const results = await patientService.list(q)
    setPatientResults(results)
  }

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p)
    setValue('patient_id', p.id)
    setPatientSearch(`${p.first_name} ${p.last_name} (${p.uhid})`)
    setPatientResults([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Book Appointment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <form
          onSubmit={handleSubmit(data => bookMut.mutate({ ...data, slot_time: data.slot_time }))}
          className="px-6 py-5 space-y-4"
        >
          {/* Patient search */}
          <div className="space-y-1 relative">
            <label className="block text-sm font-medium text-gray-700">Patient</label>
            <input
              value={patientSearch}
              onChange={e => { setPatientSearch(e.target.value); searchPatients(e.target.value) }}
              className={inputCls}
              placeholder="Search by name, phone or UHID…"
            />
            {errors.patient_id && <p className="text-xs text-red-500">Select a patient</p>}
            {patientResults.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                {patientResults.map(p => (
                  <li
                    key={p.id}
                    onClick={() => selectPatient(p)}
                    className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <span className="font-medium">{p.first_name} {p.last_name}</span>
                    <span className="text-gray-400 ml-2">{p.uhid} · {p.phone}</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedPatient && (
              <p className="text-xs text-green-600">✓ {selectedPatient.uhid} selected</p>
            )}
          </div>

          {/* Doctor */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Doctor</label>
            <select {...register('doctor_id')} className={inputCls}>
              <option value="">— Select doctor —</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.full_name} · {d.specialization}</option>
              ))}
            </select>
            {errors.doctor_id && <p className="text-xs text-red-500">{errors.doctor_id.message}</p>}
          </div>

          {/* Type */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select {...register('type')} className={inputCls}>
              <option value="pre_booked">Pre-booked</option>
              <option value="walkin">Walk-in</option>
            </select>
          </div>

          {/* Slot picker */}
          {watchedDoctorId && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Available slots — {format(parseISO(selectedDate), 'dd MMM yyyy')}
              </label>
              {slots.length === 0 ? (
                <p className="text-xs text-gray-400">No slots generated. Select a doctor first.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {slots.map(slot => {
                    const t = format(parseISO(slot.slot_time), 'HH:mm')
                    const isSelected = watch('slot_time') === slot.slot_time
                    return (
                      <button
                        key={slot.slot_time}
                        type="button"
                        disabled={!slot.is_available}
                        onClick={() => setValue('slot_time', slot.slot_time)}
                        className={`px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                          !slot.is_available
                            ? 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed'
                            : isSelected
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary'
                        }`}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              )}
              {errors.slot_time && <p className="text-xs text-red-500">Select a slot</p>}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea {...register('notes')} rows={2} className={inputCls} placeholder="Reason for visit…" />
          </div>

          {bookMut.isError && (
            <p className="text-xs text-red-500">
              {(bookMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Booking failed'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={bookMut.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {bookMut.isPending ? 'Booking…' : 'Book Appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Slot Grid (sidebar) ───────────────────────────────────────────────────────

function SlotGrid({
  doctorId,
  selectedDate,
}: {
  doctorId: string
  selectedDate: string
}) {
  const { data: slots = [], isLoading } = useQuery<AppointmentSlot[]>({
    queryKey: ['slots', doctorId, selectedDate],
    queryFn: () => appointmentService.slots(doctorId, selectedDate),
    enabled: !!doctorId,
  })

  if (isLoading) return <p className="text-sm text-gray-400 py-4 text-center">Loading slots…</p>
  if (!doctorId) return <p className="text-sm text-gray-400 py-4 text-center">Select a doctor to see slots</p>

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-3">Slot availability</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {slots.map(slot => {
          const t = format(parseISO(slot.slot_time), 'HH:mm')
          const isBooked = !slot.is_available
          return (
            <div
              key={slot.slot_time}
              className={`px-2 py-2 rounded text-xs text-center border ${
                isBooked
                  ? 'bg-red-50 text-red-500 border-red-100'
                  : 'bg-green-50 text-green-700 border-green-100'
              }`}
            >
              {t}
              <div className="text-[10px] mt-0.5">{isBooked ? 'booked' : 'free'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [filterDoctorId, setFilterDoctorId] = useState<string>('')
  const [showBook, setShowBook] = useState(false)

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => doctorService.list(),
  })

  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments', selectedDate, filterDoctorId],
    queryFn: () => appointmentService.list({
      date: selectedDate,
      doctor_id: filterDoctorId || undefined,
    }),
  })

  // Real-time: refresh when any appointment or queue event fires
  const invalidateAppts = useCallback(() =>
    qc.invalidateQueries({ queryKey: ['appointments'] }), [qc])
  useWebSocket('appointment:update', invalidateAppts)
  useWebSocket('queue:update', invalidateAppts)

  const cancelMut = useMutation({
    mutationFn: appointmentService.cancel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  })

  const checkinMut = useMutation({
    mutationFn: appointmentService.checkin,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  const prevDay = () => setSelectedDate(format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))
  const nextDay = () => setSelectedDate(format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))

  const counts = {
    total: appointments.length,
    checkedIn: appointments.filter(a => a.status === 'checked_in').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    cancelled: appointments.filter(a => a.status === 'cancelled').length,
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Schedule, manage and check-in patients</p>
        </div>
        <button
          onClick={() => setShowBook(true)}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + Book Appointment
        </button>
      </div>

      {/* Date navigator */}
      <div className="flex items-center gap-4 mb-5">
        <button onClick={prevDay} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <span className="text-sm text-gray-600 font-medium">
            {format(new Date(selectedDate), 'EEEE, dd MMMM yyyy')}
          </span>
        </div>
        <button onClick={nextDay} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
          className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5"
        >
          Today
        </button>
      </div>

      {/* Stats chips */}
      <div className="flex gap-3 mb-5">
        {[
          { label: 'Total', value: counts.total, color: 'bg-gray-100 text-gray-700' },
          { label: 'Checked In', value: counts.checkedIn, color: 'bg-yellow-100 text-yellow-700' },
          { label: 'Completed', value: counts.completed, color: 'bg-green-100 text-green-700' },
          { label: 'Cancelled', value: counts.cancelled, color: 'bg-red-100 text-red-600' },
        ].map(s => (
          <span key={s.label} className={`px-3 py-1.5 rounded-full text-xs font-medium ${s.color}`}>
            {s.label}: {s.value}
          </span>
        ))}
      </div>

      <div className="flex gap-6">
        {/* Appointment list */}
        <div className="flex-1">
          {/* Doctor filter */}
          <div className="mb-3">
            <select
              value={filterDoctorId}
              onChange={e => setFilterDoctorId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 w-64"
            >
              <option value="">All Doctors</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
          ) : appointments.length === 0 ? (
            <div className="border border-dashed border-gray-200 rounded-xl py-16 text-center">
              <p className="text-gray-400 text-sm">No appointments for this day</p>
              <button
                onClick={() => setShowBook(true)}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Book the first one →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {appointments.map(appt => (
                <div
                  key={appt.id}
                  className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4 hover:border-gray-300 transition-colors"
                >
                  {/* Time */}
                  <div className="w-14 text-center flex-shrink-0">
                    <p className="text-base font-bold text-gray-900 tabular-nums">
                      {format(parseISO(appt.slot_time), 'HH:mm')}
                    </p>
                    <p className="text-[10px] text-gray-400 capitalize">{appt.type.replace('_', ' ')}</p>
                  </div>

                  <div className="w-px h-10 bg-gray-200 flex-shrink-0" />

                  {/* Patient / Doctor */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {appt.patient_name ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      Dr. {appt.doctor_name ?? '—'}
                      {appt.notes && <span className="text-gray-400 ml-2">· {appt.notes}</span>}
                    </p>
                  </div>

                  {/* Status */}
                  <StatusBadge status={appt.status} />

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
                      <>
                        <button
                          onClick={() => checkinMut.mutate(appt.id)}
                          disabled={checkinMut.isPending}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                          Check In
                        </button>
                        <button
                          onClick={() => cancelMut.mutate(appt.id)}
                          disabled={cancelMut.isPending}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {appt.status === 'checked_in' && (
                      <span className="text-xs text-yellow-600 font-medium">In queue</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Slot grid sidebar */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-xl p-4 sticky top-6">
            <SlotGrid
              doctorId={filterDoctorId}
              selectedDate={selectedDate}
            />
          </div>
        </div>
      </div>

      {showBook && (
        <BookModal
          onClose={() => setShowBook(false)}
          selectedDate={selectedDate}
          doctors={doctors}
        />
      )}
    </div>
  )
}
