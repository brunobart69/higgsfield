"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** Mostra uma notificação de sucesso após um redirecionamento (?saved=1) e limpa o parâmetro da URL. */
export function FlashToast({ message, param }: { message: string; param: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.success(message);
    const next = new URLSearchParams(search.toString());
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [message, param, pathname, router, search]);
  return null;
}
