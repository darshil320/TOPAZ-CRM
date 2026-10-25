import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";

export default function FrontDeskLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
