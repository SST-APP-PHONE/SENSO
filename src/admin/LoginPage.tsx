import { useState, type FormEvent } from "react";
import { adminApi } from "../api/client";
import { Brand } from "../components/Brand";
import type { AdminUser } from "./types";

export default function LoginPage({ onLogin, notice }: { onLogin: (u: AdminUser) => void; notice: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await adminApi.post<AdminUser>("/login", { email, password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-950 px-4 text-white">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm">
        <Brand />
        <h1 className="mt-8 text-2xl font-black">Centro de monitoreo</h1>
        {notice && <p className="mt-3 rounded-lg bg-amber-400 p-3 text-sm font-semibold text-navy-950">{notice}</p>}
        <label className="mt-5 block">
          <span className="text-sm font-semibold">Correo</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block min-h-12 w-full rounded-xl px-3 text-base text-navy-950"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold">Contraseña</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block min-h-12 w-full rounded-xl px-3 text-base text-navy-950"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-alert-600 p-3 text-sm font-semibold">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="mt-5 min-h-14 w-full rounded-2xl bg-tech-600 text-lg font-extrabold disabled:opacity-60">
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
