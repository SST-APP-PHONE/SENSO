import { Link, Outlet } from "react-router-dom";
import { Brand, PoweredBy } from "./Brand";
import { ConnectionStatus } from "./ConnectionStatus";

export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <ConnectionStatus />
      <header className="bg-navy-950 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/app" aria-label="Inicio de SENSO">
            <Brand compact />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-5 safe-bottom">
        <Outlet />
        <PoweredBy className="mt-10 pb-4" />
      </main>
    </div>
  );
}
