import { useId } from "react";
import { cn } from "@/lib/utils";

/** Monograma JB: escudo facetado em dourado metálico com estrada estilizada. */
export function LogoMark({ className, title = "JB RENT PRO" }: { className?: string; title?: string }) {
  // IDs únicos: vários logotipos na mesma página (um deles oculto) não podem compartilhar gradientes.
  const uid = useId().replace(/:/g, "");
  const gold = `jb-gold-${uid}`;
  const face = `jb-face-${uid}`;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn("h-10 w-10", className)}>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3DE9F" />
          <stop offset="0.45" stopColor="#C9A24B" />
          <stop offset="1" stopColor="#7E5F22" />
        </linearGradient>
        <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C1D21" />
          <stop offset="1" stopColor="#0A0A0C" />
        </linearGradient>
      </defs>
      <path d="M32 2 58 12v20c0 15.5-10.8 26.2-26 30C16.8 58.2 6 47.5 6 32V12L32 2Z" fill={`url(#${gold})`} />
      <path d="M32 6.3 54 14.8V32c0 13.3-9.1 22.6-22 26C19.1 54.6 10 45.3 10 32V14.8L32 6.3Z" fill={`url(#${face})`} />
      <path
        d="M24.5 19h6v17.2c0 5.4-3 8.3-8.2 8.3-1.6 0-3-.2-4.3-.7l.9-4.8c.8.3 1.6.4 2.4.4 2.2 0 3.2-1.1 3.2-3.6V19Z"
        fill={`url(#${gold})`}
      />
      <path
        d="M33.5 19h8.3c5 0 7.8 2.3 7.8 6 0 2.4-1.3 4.1-3.4 4.9 2.7.7 4.3 2.7 4.3 5.4 0 4.2-3.2 6.7-8.6 6.7h-8.4V19Zm5.8 8.9h1.9c1.8 0 2.7-.8 2.7-2.1s-.9-2-2.7-2h-1.9v4.1Zm0 9.4h2.4c2 0 3-.8 3-2.3 0-1.4-1-2.2-3-2.2h-2.4v4.5Z"
        fill={`url(#${gold})`}
      />
      <path d="M20 50h24" stroke={`url(#${gold})`} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" opacity="0.7" />
    </svg>
  );
}

export function Logo({ className, compact = false, slogan }: { className?: string; compact?: boolean; slogan?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark className={compact ? "h-9 w-9" : "h-11 w-11"} />
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[1.05rem] font-semibold tracking-[0.22em] text-foreground">
            JB <span className="text-gold-gradient">RENT</span> PRO
          </div>
          {slogan && <div className="mt-1.5 text-[0.68rem] tracking-wide text-muted">{slogan}</div>}
        </div>
      )}
    </div>
  );
}
