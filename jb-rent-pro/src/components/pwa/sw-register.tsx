"use client";
import { useEffect } from "react";

/** Registra o service worker (somente em produção) para tornar o app instalável. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* sem service worker o app continua funcionando, apenas não fica instalável */
    });
  }, []);
  return null;
}
