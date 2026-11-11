import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { setAuthToken } from "./services/api";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PDFUpload from "./pages/PDFUpload";
import CoderIndex from "./pages/CoderIndex";
import OpenChart from "./pages/OpenChart";
import Base from "./pages/Base";
import AuditOpenChart from "./pages/AuditOpenChart";
import AuditDashboard from "./pages/AuditDashboard";
import AtAuditOpenChart from "./pages/AtAuditOpenChart";
import AtAuditDashboard from "./pages/AtAuditDashboard";
import UserExcelUpload from "./pages/UserExcelUpload";
import QualityDashboard from "./pages/QualityDashboard";
import AuditQualityDashboard from "./pages/AuditQualityDashboard";
import InventoryManagement from "./pages/InventoryManagement";
import AuditTeamProduction from "./pages/AuditTeamProduction";
import TeamQuality from "./pages/TeamQuality";
import SearchChart from "./pages/SearchChart";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";
import Unauthorized from "./pages/Unauthorized";
import TeamProduction from "./pages/TeamProduction";
import RebuttalStatus from "./pages/RebuttalStatus";
import HourlyProductionTracker from "./pages/HourlyProductionTracker";
import ProjectConfig from "./pages/ProjectConfig";
import MyProduction from "./pages/MyProduction";
import AuditMyProduction from "./pages/AuditMyProduction";
import AtAuditMyProduction from "./pages/AtAuditMyProduction";
import ClarificationPortal from "./pages/ClarificationPortal";
import UserManagement from "./pages/UserManagement";
const token = localStorage.getItem("token");
if (token) {
  setAuthToken(token); // Axios default header
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          {/* Protected routes inside Base layout */}
          <Route
            element={
              <ProtectedRoute>
                <Base />
              </ProtectedRoute>
            }
          >
            {/* Routes accessible to all authenticated users */}
            <Route path="/" element={<Dashboard />} />
            <Route path="/chart/:chartId" element={<OpenChart />} />

            <Route
              path="/audit/chart/:chartId"
              element={<AuditOpenChart mode="audit" />}
            />
            <Route
              path="/at-audit/chart/:chartId"
              element={<AtAuditOpenChart mode="at-audit" />}
            />
            <Route
              path="/quality/chart/:chartId"
              element={<AuditOpenChart mode="quality" />}
            />
            <Route
              path="/at-audit/quality/chart/:chartId"
              element={<AtAuditOpenChart mode="quality" />}
            />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Clarification Portal — all authenticated roles */}
            <Route
              element={<RoleRoute allowedRoles={["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"]} />}
            >
              <Route path="/clarification-portal" element={<ClarificationPortal />} />
            </Route>

            {/* Managers / Roles with Upload access */}
            <Route element={<RoleRoute allowedRoles={["Manager", "VP", "AM"]} />}>
              <Route path="/upload" element={<UserExcelUpload />} />
              <Route path="/pdf-upload" element={<PDFUpload />} />
              <Route path="/inventory-management" element={<InventoryManagement />} />
              <Route path="/project-config" element={<ProjectConfig />} />
              <Route path="/user-management" element={<UserManagement />} />
            </Route>

            {/* Coder specific dashboard/prod */}
            <Route element={<RoleRoute allowedRoles={["Coder"]} />}>
              <Route path="/coder" element={<CoderIndex />} />
              <Route path="/my-production" element={<MyProduction />} />
              <Route path="/quality/dashboard" element={<QualityDashboard />} />
            </Route>

            {/* Auditor specific dashboard/prod */}
            <Route element={<RoleRoute allowedRoles={["Auditor", "SME", "TL", "Manager", "VP", "AM"]} />}>
              <Route path="/search-chart" element={<SearchChart />} />
              <Route path="/audit/dashboard" element={<AuditDashboard />} />
              <Route path="/audit/my-production" element={<AuditMyProduction />} />
              <Route path="/at-audit/dashboard" element={<AtAuditDashboard />} />
              <Route path="/at-audit/my-production" element={<AtAuditMyProduction />} />
              <Route path="/audit/quality/dashboard" element={<AuditQualityDashboard />} />
              <Route path="/quality/rebuttal-status" element={<RebuttalStatus />} />
            </Route>

            {/* Management/Production reports */}
            <Route element={<RoleRoute allowedRoles={["TL", "AM", "Manager", "VP"]} />}>
              <Route path="/team/production" element={<TeamProduction />} />
              <Route path="/team/quality" element={<TeamQuality />} />
              <Route path="/hourly-production" element={<HourlyProductionTracker />} />
              <Route path="/audit/team-production" element={<AuditTeamProduction />} />
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
      </ToastProvider>
    </BrowserRouter >
  );
}
