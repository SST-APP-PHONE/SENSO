import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { adminApi, HttpError } from "../api/client";
import { BrandMark } from "../components/Brand";
import DashboardPage from "./DashboardPage";
import EventsPage from "./EventsPage";
import LoginPage from "./LoginPage";
import type { AdminUser } from "./types";

/** Centro de monitoreo: requiere sesión. No se indexa (meta robots + X-Robots-Tag + robots.txt). */
export default function AdminApp() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    document.title = "Centro de monitoreo · SENSO";
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    adminApi.get<AdminUser>("/me").then(
      (u) => {
        if (!alive) return;
        setUser(u);
        setError(null);
      },
      (e) => {
        if (!alive) return;
        setUser(null);
        if (!(e instanceof HttpError && e.status === 401)) {
          setError(navigator.onLine ? "No se pudo contactar al servidor." : "Sin conexión: el centro de monitoreo requiere internet.");
        }
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (user === undefined) return <p className="p-6 text-center">Verificando sesión…</p>;
  if (!user) return <LoginPage onLogin={setUser} notice={error} />;

  const logout = async () => {
    await adminApi.post("/logout", {}).catch(() => undefined);
    setUser(null);
  };

  const tab = ({ isActive }: { isActive: boolean }) =>
    `min-h-11 inline-flex items-center rounded-lg px-3 text-sm font-bold ${isActive ? "bg-white text-navy-950" : "text-white/80 hover:text-white"}`;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="bg-navy-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={36} />
            <div className="min-w-0">
              <p className="text-lg font-black tracking-wider">CENTRO DE MONITOREO SENSO</p>
              <p className="truncate text-xs opacity-70">
                {user.name} · {user.role === "ADMIN" ? "Administrador" : "Consulta"}
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            <NavLink to="/admin" end className={tab}>
              Monitoreo
            </NavLink>
            <NavLink to="/admin/eventos" className={tab}>
              Eventos
            </NavLink>
            <button type="button" onClick={() => void logout()} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-white/80 hover:text-white">
              Salir
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Routes>
          <Route index element={<DashboardPage user={user} />} />
          <Route path="eventos" element={<EventsPage user={user} />} />
        </Routes>
      </main>
    </div>
  );
}
