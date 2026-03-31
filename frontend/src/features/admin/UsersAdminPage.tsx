/**
 * Admin — Manage Staff Users
 * hospital_admin can create / edit / deactivate non-doctor staff.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { StaffUser } from '@/types/common'
import { userService } from '@/services/clinicalService'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const MANAGEABLE_ROLES = [
  'receptionist',
  'nurse',
  'billing_officer',
  'lab_technician',
  'pharmacist',
  'hospital_admin',
] as const

const ROLE_LABELS: Record<string, string> = {
  receptionist: 'Receptionist',
  nurse: 'Nurse',
  billing_officer: 'Billing Officer',
  lab_technician: 'Lab Technician',
  pharmacist: 'Pharmacist',
  hospital_admin: 'Hospital Admin',
}

const createSchema = z.object({
  email: z.string().email('Valid email required'),
  phone: z
    .string()
    .min(1, 'Phone required')
    .regex(/^\+?[1-9]\d{9,14}$/, 'Enter a valid phone number (e.g. +91XXXXXXXXXX)'),
  password: z.string().min(8, 'Minimum 8 characters'),
  username: z
    .string()
    .min(3, 'Min 3 characters')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits, underscores only')
    .optional()
    .or(z.literal('')),
  full_name: z.string().min(1, 'Name required'),
  role: z.enum(MANAGEABLE_ROLES, { required_error: 'Role required' }),
})
type CreateForm = z.infer<typeof createSchema>

const editSchema = z.object({
  full_name: z.string().min(1, 'Name required'),
})
type EditForm = z.infer<typeof editSchema>

// ── Small reusable UI ─────────────────────────────────────────────────────────

const StatusBadge = ({ active }: { active: boolean }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}
  >
    {active ? 'Active' : 'Inactive'}
  </span>
)

const Modal = ({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
          ×
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  </div>
)

const FormField = ({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    {children}
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
)

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

// ── Credentials modal (shown after creation) ──────────────────────────────────

interface CreatedCreds {
  full_name: string
  username: string
  password: string
  phone: string
}

function CredentialsModal({ creds, onClose }: { creds: CreatedCreds; onClose: () => void }) {
  return (
    <Modal title="User Created — Credentials Sent" onClose={onClose}>
      <p className="text-sm text-gray-600 mb-4">
        An SMS with login credentials has been sent to <strong>{creds.phone}</strong>.
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Full Name</span>
          <span className="font-medium text-gray-900">{creds.full_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Username</span>
          <span className="font-mono font-medium text-gray-900">{creds.username}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Password</span>
          <span className="font-mono font-medium text-gray-900">{creds.password}</span>
        </div>
      </div>
      <div className="flex justify-end pt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsersAdminPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<StaffUser | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<CreatedCreds | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['staff-users', showInactive],
    queryFn: () => userService.list({ include_inactive: showInactive }),
  })

  const createMut = useMutation({
    mutationFn: userService.create,
    onSuccess: (created, variables) => {
      qc.invalidateQueries({ queryKey: ['staff-users'] })
      setShowCreate(false)
      setCreatedCreds({
        full_name: created.full_name,
        username: created.username,
        password: variables.password,
        phone: created.phone ?? variables.phone,
      })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof userService.update>[1] }) =>
      userService.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-users'] })
      setEditing(null)
    },
  })

  const createForm = useForm<CreateForm>({ resolver: zodResolver(createSchema) })
  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) })

  const openEdit = (user: StaffUser) => {
    setEditing(user)
    editForm.reset({ full_name: user.full_name })
  }

  const onCreateSubmit = (data: CreateForm) => {
    createMut.mutate(data)
  }

  const toggleActive = (user: StaffUser) =>
    updateMut.mutate({ id: user.id, data: { is_active: !user.is_active } })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Manage Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Create and manage hospital staff accounts
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); createForm.reset() }}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          + Add Staff
        </button>
      </div>

      {/* Toolbar */}
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={e => setShowInactive(e.target.checked)}
          className="rounded"
        />
        Show inactive users
      </label>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No staff users found</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Full Name', 'Email', 'Username', 'Phone', 'Role', 'Status', ''].map(h => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.full_name}</td>
                  <td className="px-4 py-3 text-gray-500">{user.email}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{user.username}</td>
                  <td className="px-4 py-3 text-gray-500">{user.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {ROLE_LABELS[user.role] ?? user.role}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge active={user.is_active} />
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => openEdit(user)}
                      className="text-primary hover:underline text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(user)}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      {user.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="Add Staff Member" onClose={() => setShowCreate(false)}>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Full Name"
                error={createForm.formState.errors.full_name?.message}
              >
                <input
                  {...createForm.register('full_name')}
                  className={inputCls}
                  placeholder="Priya Sharma"
                />
              </FormField>
              <FormField label="Role" error={createForm.formState.errors.role?.message}>
                <select {...createForm.register('role')} className={inputCls}>
                  <option value="">Select role…</option>
                  {MANAGEABLE_ROLES.map(r => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <FormField label="Email" error={createForm.formState.errors.email?.message}>
              <input
                {...createForm.register('email')}
                type="email"
                className={inputCls}
                placeholder="priya@hospital.com"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Phone" error={createForm.formState.errors.phone?.message}>
                <input
                  {...createForm.register('phone')}
                  type="tel"
                  className={inputCls}
                  placeholder="+91XXXXXXXXXX"
                />
              </FormField>
              <FormField
                label="Password"
                error={createForm.formState.errors.password?.message}
              >
                <input
                  {...createForm.register('password')}
                  type="password"
                  className={inputCls}
                  placeholder="Min 8 characters"
                />
              </FormField>
            </div>

            <FormField
              label="Username (optional — auto-generated if left blank)"
              error={createForm.formState.errors.username?.message}
            >
              <input
                {...createForm.register('username')}
                className={inputCls}
                placeholder="e.g. priya_sharma"
              />
            </FormField>

            {createMut.isError && (
              <p className="text-xs text-red-500">
                {(createMut.error as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? 'Failed to create user. Please try again.'}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {createMut.isPending ? 'Creating…' : 'Create Staff'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Staff Member" onClose={() => setEditing(null)}>
          <form
            onSubmit={editForm.handleSubmit(data =>
              updateMut.mutate({ id: editing.id, data })
            )}
            className="space-y-4"
          >
            <FormField label="Full Name" error={editForm.formState.errors.full_name?.message}>
              <input {...editForm.register('full_name')} className={inputCls} />
            </FormField>
            <p className="text-xs text-gray-400">
              Role and email cannot be changed after creation.
            </p>

            {updateMut.isError && (
              <p className="text-xs text-red-500">
                {(updateMut.error as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? 'Failed to update user.'}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Credentials modal */}
      {createdCreds && (
        <CredentialsModal creds={createdCreds} onClose={() => setCreatedCreds(null)} />
      )}
    </div>
  )
}
