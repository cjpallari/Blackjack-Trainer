"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, GitBranch, Layers, LayoutDashboard, Settings, Spade, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/basic-strategy", label: "Basic Strategy", icon: Spade },
  { href: "/running-count", label: "Running Count", icon: Layers },
  { href: "/true-count", label: "True Count", icon: Calculator },
  { href: "/deviations", label: "Deviations", icon: GitBranch },
  { href: "/simulator", label: "Blackjack Simulator", icon: Table2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b border-sidebar-border bg-sidebar md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:px-5 md:py-5">
          <span className="grid size-8 place-items-center rounded-md bg-primary/15 text-lg text-primary">♠</span>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">BJ Trainer</div>
            <div className="hidden text-xs text-muted-foreground md:block">Advantage practice</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3 md:pb-0">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
