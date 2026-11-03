"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{ background: "#09090b", color: "#f5f5f4", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ letterSpacing: "0.2em", color: "#c9a24b", fontWeight: 600 }}>JB RENT PRO</p>
          <p>Ocorreu um erro inesperado. / Se ha producido un error inesperado.</p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "10px 18px", borderRadius: 8, background: "#c9a24b", color: "#0b0b0c", border: 0, cursor: "pointer" }}
          >
            Tentar novamente / Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
