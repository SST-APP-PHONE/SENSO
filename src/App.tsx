import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import HowItWorksPage from "./pages/HowItWorksPage";
import LandingPage from "./pages/LandingPage";
import MyReportsPage from "./pages/MyReportsPage";
import NewReportPage from "./pages/NewReportPage";
import PrivacyPage from "./pages/PrivacyPage";
import ReportDetailPage from "./pages/ReportDetailPage";

// El centro de monitoreo (con mapas) se carga aparte para no pesar en la app ciudadana.
const AdminApp = lazy(() => import("./admin/AdminApp"));

/** basename = /senso (o la base configurada en Vite): ninguna ruta asume la raíz. */
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacidad" element={<PrivacyPage />} />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="nuevo" element={<NewReportPage />} />
          <Route path="reportes" element={<MyReportsPage />} />
          <Route path="reportes/:id" element={<ReportDetailPage />} />
          <Route path="como-funciona" element={<HowItWorksPage />} />
        </Route>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<p className="p-6 text-center">Cargando centro de monitoreo…</p>}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
