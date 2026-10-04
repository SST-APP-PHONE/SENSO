const iconUrl = `${import.meta.env.BASE_URL}icons/senso-mark.svg`;

export function BrandMark({ size = 36 }: { size?: number }) {
  return <img src={iconUrl} width={size} height={size} alt="" aria-hidden="true" className="shrink-0 rounded-[22%]" />;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={compact ? 32 : 40} />
      <span className="leading-tight">
        <span className="block text-xl font-black tracking-[0.18em]">SENSO</span>
        {!compact && <span className="block text-[11px] font-medium opacity-80">Sistema de Reporte y Monitoreo de Emergencias</span>}
      </span>
    </span>
  );
}

export function PoweredBy({ className = "" }: { className?: string }) {
  return <p className={`text-center text-xs opacity-60 ${className}`}>Desarrollado por LeySillaPro</p>;
}
