import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '@/components/shared/ProtectedRoute'
import AppLayout from '@/components/shared/Layout'
import LoginPage from '@/features/auth/LoginPage'
import PatientsPage from '@/features/patients/PatientsPage'
import QueuePage from '@/features/queue/QueuePage'
import TokenDisplayPage from '@/features/queue/TokenDisplayPage'
import NurseVitalsPage from '@/features/nurse/NurseVitalsPage'
import ConsultationPage from '@/features/doctor/ConsultationPage'
import PrescriptionPage from '@/features/doctor/PrescriptionPage'
import BillingPage from '@/features/billing/BillingPage'
import DoctorsAdminPage from '@/features/admin/DoctorsAdminPage'
import UsersAdminPage from '@/features/admin/UsersAdminPage'
import AppointmentsPage from '@/features/appointments/AppointmentsPage'
import ChangePasswordPage from '@/features/auth/ChangePasswordPage'

// Remaining placeholder pages
const Dashboard = () => <div className="p-6"><h1 className="text-2xl font-semibold">Command Center</h1></div>
const RosterPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Nurse Roster</h1></div>
const LabPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Lab Orders</h1></div>
const PharmacyPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Pharmacy Queue</h1></div>

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/display/:tenantSchema" element={<TokenDisplayPage />} />

        {/* Protected routes — all inside the app shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/nurse/vitals" element={<NurseVitalsPage />} />
            <Route path="/nurse/roster" element={<RosterPage />} />
            <Route path="/doctor/consultation" element={<ConsultationPage />} />
            <Route path="/doctor/consultation/:visitId" element={<ConsultationPage />} />
            <Route path="/doctor/prescription/:visitId" element={<PrescriptionPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/pharmacy" element={<PharmacyPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/admin/doctors" element={<DoctorsAdminPage />} />
            <Route path="/admin/users" element={<UsersAdminPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
