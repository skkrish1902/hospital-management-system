import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '@/components/shared/ProtectedRoute'
import AppLayout from '@/components/shared/Layout'
import LoginPage from '@/features/auth/LoginPage'

// Placeholder pages — each replaced during phase implementation
const Dashboard = () => <div className="p-6"><h1 className="text-2xl font-semibold">Command Center</h1></div>
const PatientsPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Patient Registration</h1></div>
const AppointmentsPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Appointments</h1></div>
const QueuePage = () => <div className="p-6"><h1 className="text-2xl font-semibold">OPD Queue</h1></div>
const TokenDisplayPage = () => <div className="p-6 bg-gray-900 text-white min-h-screen"><h1 className="text-4xl font-bold text-center pt-20">Token Display Board</h1></div>
const VitalsPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Nurse Vitals</h1></div>
const RosterPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Nurse Roster</h1></div>
const ConsultationPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Doctor Consultation</h1></div>
const PrescriptionPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Prescription Builder</h1></div>
const LabPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Lab Orders</h1></div>
const PharmacyPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Pharmacy Queue</h1></div>
const BillingPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Billing</h1></div>
const DoctorsAdminPage = () => <div className="p-6"><h1 className="text-2xl font-semibold">Doctors & Departments</h1></div>

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
            <Route path="/nurse/vitals" element={<VitalsPage />} />
            <Route path="/nurse/roster" element={<RosterPage />} />
            <Route path="/doctor/consultation" element={<ConsultationPage />} />
            <Route path="/doctor/consultation/:visitId" element={<ConsultationPage />} />
            <Route path="/doctor/prescription/:visitId" element={<PrescriptionPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/pharmacy" element={<PharmacyPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/admin/doctors" element={<DoctorsAdminPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
