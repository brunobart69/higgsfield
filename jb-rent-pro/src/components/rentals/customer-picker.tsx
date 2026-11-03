"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, User, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { searchCustomersAction } from "@/app/(app)/rentals/actions";

export type PickedCustomer = { id: string; name: string; detail: string; licence_expiry: string | null };

/** Seletor de cliente com busca no servidor (nome, documento, telefone). */
export function CustomerPicker({
  value,
  onChange,
  error,
  disabled,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const rows = await searchCustomersAction(q);
      if (id === seq.current) {
        setResults(rows);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-gold/40 bg-gold/5 p-3">
        <User className="size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.name}</p>
          {value.detail && <p className="truncate text-xs text-muted">{value.detail}</p>}
        </div>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-foreground" aria-label={t.common.clear}>
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-subtle" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={t.rentals.pickCustomer}
        aria-label={t.rentals.fields.customer}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        className="h-11 w-full rounded-md border border-border bg-surface-2 pl-10 pr-3 text-[0.95rem] placeholder:text-subtle focus-visible:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/20 aria-[invalid=true]:border-danger/70"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface-2 p-1 shadow-2xl">
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">{t.common.loading}</p>
          ) : results.length === 0 ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
              {t.rentals.noCustomer}
              <Link href="/customers/new" className="text-gold hover:underline" target="_blank">
                {t.rentals.newCustomer}
              </Link>
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-surface-3"
              >
                <span className="text-sm">{c.name}</span>
                {c.detail && <span className="text-xs text-muted">{c.detail}</span>}
              </button>
            ))
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
