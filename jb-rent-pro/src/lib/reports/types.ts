export type ColType = "text" | "money" | "number" | "date" | "datetime" | "percent";
export type Column = { key: string; label: string; type: ColType; align?: "left" | "right" };
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

/** Uma seção do relatório = uma tabela (com totais opcionais). */
export type ReportSection = { title: string; columns: Column[]; rows: Row[]; totals?: Row; empty?: string };

export type ReportDoc = {
  key: string;
  title: string;
  subtitle: string;
  /** Período ou data de referência, já formatados. */
  period: string;
  sections: ReportSection[];
  notes: string[];
  /** PDF em paisagem para tabelas largas. */
  landscape?: boolean;
};
