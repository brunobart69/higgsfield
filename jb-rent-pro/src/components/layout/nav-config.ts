import {
  BarChart3,
  Bell,
  CalendarDays,
  Car,
  ClipboardCheck,
  FileSignature,
  FileText,
  History,
  Gauge,
  Landmark,
  PiggyBank,
  Settings,
  ShieldCheck,
  Siren,
  Users,
  UserCog,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type NavKey = Exclude<keyof Dictionary["nav"], "groups">;
type GroupKey = keyof Dictionary["nav"]["groups"];

export type NavItem = {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  /** Fase do plano em que o módulo é liberado. Itens futuros aparecem desabilitados. */
  phase: number;
  ownerOnly?: boolean;
};

export type NavGroup = { key: GroupKey; items: NavItem[] };

/** Fase atualmente implantada. Atualize ao concluir cada fase. */
export const CURRENT_PHASE = 4;

export const NAV: NavGroup[] = [
  {
    key: "overview",
    items: [
      { key: "dashboard", href: "/dashboard", icon: Gauge, phase: 1 },
      { key: "calendar", href: "/calendar", icon: CalendarDays, phase: 9 },
      { key: "notifications", href: "/notifications", icon: Bell, phase: 9 },
    ],
  },
  {
    key: "operations",
    items: [
      { key: "rentals", href: "/rentals", icon: FileSignature, phase: 4 },
      { key: "customers", href: "/customers", icon: Users, phase: 3 },
      { key: "deposits", href: "/deposits", icon: Wallet, phase: 4 },
      { key: "inspections", href: "/inspections", icon: ClipboardCheck, phase: 5 },
    ],
  },
  {
    key: "fleet",
    items: [
      { key: "vehicles", href: "/vehicles", icon: Car, phase: 3 },
      { key: "maintenance", href: "/maintenance", icon: Wrench, phase: 7 },
      { key: "insurance", href: "/insurance", icon: ShieldCheck, phase: 6 },
      { key: "finesAccidents", href: "/fines", icon: Siren, phase: 7 },
      { key: "documents", href: "/documents", icon: FileText, phase: 6 },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "financial", href: "/financial", icon: Landmark, phase: 8 },
      { key: "assets", href: "/assets", icon: PiggyBank, phase: 8 },
      { key: "reports", href: "/reports", icon: BarChart3, phase: 10 },
    ],
  },
  {
    key: "admin",
    items: [
      { key: "users", href: "/users", icon: UserCog, phase: 2, ownerOnly: true },
      { key: "activity", href: "/activity", icon: History, phase: 2 },
      { key: "settings", href: "/settings", icon: Settings, phase: 2, ownerOnly: true },
    ],
  },
];

export function isEnabled(item: NavItem) {
  return item.phase <= CURRENT_PHASE;
}
