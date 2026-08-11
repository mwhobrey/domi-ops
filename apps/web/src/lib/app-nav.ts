import {
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardList,
  FolderOpen,
  Heart,
  LayoutDashboard,
  NotebookPen,
  Receipt,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: string;
};

export const APP_NAV: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: Calendar, module: "calendar_sync" },
  { href: "/school", label: "School", icon: BookOpen, module: "school" },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/chores", label: "Chores", icon: ClipboardList },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/drive", label: "Drive", icon: FolderOpen, module: "drive" },
  { href: "/health", label: "Health", icon: Heart, module: "health" },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function isNavItemVisible(
  item: AppNavItem,
  modulesEnabled: string[] | undefined,
): boolean {
  if (!item.module) return true;
  return modulesEnabled?.includes(item.module) ?? false;
}

export function filterVisibleNav(modulesEnabled: string[] | undefined): AppNavItem[] {
  return APP_NAV.filter((item) => isNavItemVisible(item, modulesEnabled));
}
