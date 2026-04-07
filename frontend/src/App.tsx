import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '@/components/shared/ProtectedRoute'
import RoleGuard from '@/components/shared/RoleGuard'
import AppLayout from '@/components/shared/Layout'
import LoginPage from '@/features/auth/LoginPage'
import PatientsPage from '@/features/patients/PatientsPage'
import QueuePage from '@/features/queue/QueuePage'
import TokenDisplayPage from '@/features/queue/TokenDisplayPage'
import NurseVitalsPage from '@/features/nurse/NurseVitalsPage'
import ConsultationPage from '@/features/doctor/ConsultationPage'
import PrescriptionPage from '@/features/doctor/PrescriptionPage'
import BillingPage from '@/features/billing/BillingPage'
import PosScreen from '@/features/billing/PosScreen'
import DoctorsAdminPage from '@/features/admin/DoctorsAdminPage'
import UsersAdminPage from '@/features/admin/UsersAdminPage'
import AppointmentsPage from '@/features/appointments/AppointmentsPage'
import ChangePasswordPage from '@/features/auth/ChangePasswordPage'
import PharmacyPage from '@/features/pharmacy/PharmacyPage'
import LabPage from '@/features/lab/LabPage'
import AdminDashboard from '@/features/admin/AdminDashboard'

import { useAuthStore } from '@/features/auth/authStore'

const ADMIN = ['hospital_admin', 'super_admin']
const DOCTOR = ['doctor', ...ADMIN]
const NURSE = ['nurse', ...ADMIN]
const LAB = ['lab_technician', ...ADMIN]
const PHARMACY = ['pharmacist', ...ADMIN]
const BILLING = ['billing_officer', ...ADMIN]
const RECEPTION = ['receptionist', ...ADMIN]
const CLINICAL = ['receptionist', 'nurse', 'doctor', ...ADMIN]

// Remaining placeholder pages
function Dashboard() {
  const role = useAuthStore((s) => s.user?.role ?? '')
  if (role === 'doctor') return <Navigate to="/doctor/consultation" replace />
  if (role === 'nurse') return <Navigate to="/nurse/vitals" replace />
  if (role === 'pharmacist') return <Navigate to="/pharmacy" replace />
  if (role === 'lab_technician') return <Navigate to="/lab" replace />
  if (role === 'receptionist') return <Navigate to="/patients" replace />
  if (role === 'hospital_admin' || role === 'super_admin') return <AdminDashboard />
  return <div className="p-6"><h1 className="text-2xl font-semibold">Command Center</h1></div>
}
const RosterPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Nurse Roster</h1></div>

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/display/:tenantSchema" element={<TokenDisplayPage />} />
        <Route path="/pos/:tenantSchema" element={<PosScreen />} />

        {/* Protected routes — all inside the app shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/patients" element={<RoleGuard allowed={CLINICAL}><PatientsPage /></RoleGuard>} />
            <Route path="/appointments" element={<RoleGuard allowed={[...RECEPTION, 'nurse', 'doctor']}><AppointmentsPage /></RoleGuard>} />
            <Route path="/queue" element={<RoleGuard allowed={[...RECEPTION, 'nurse']}><QueuePage /></RoleGuard>} />
            <Route path="/nurse/vitals" element={<RoleGuard allowed={NURSE}><NurseVitalsPage /></RoleGuard>} />
            <Route path="/nurse/roster" element={<RoleGuard allowed={NURSE}><RosterPage /></RoleGuard>} />
            <Route path="/doctor/consultation" element={<RoleGuard allowed={DOCTOR}><ConsultationPage /></RoleGuard>} />
            <Route path="/doctor/consultation/:visitId" element={<RoleGuard allowed={DOCTOR}><ConsultationPage /></RoleGuard>} />
            <Route path="/doctor/prescription/:visitId" element={<RoleGuard allowed={DOCTOR}><PrescriptionPage /></RoleGuard>} />
            <Route path="/lab" element={<RoleGuard allowed={LAB}><LabPage /></RoleGuard>} />
            <Route path="/pharmacy" element={<RoleGuard allowed={PHARMACY}><PharmacyPage /></RoleGuard>} />
            <Route path="/billing" element={<RoleGuard allowed={BILLING}><BillingPage /></RoleGuard>} />
            <Route path="/admin/doctors" element={<RoleGuard allowed={ADMIN}><DoctorsAdminPage /></RoleGuard>} />
            <Route path="/admin/users" element={<RoleGuard allowed={['hospital_admin']}><UsersAdminPage /></RoleGuard>} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
