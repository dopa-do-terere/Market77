import type { ReactNode } from "react";
import { Card } from "./Card";
import { Logo } from "./Logo";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo className="h-10 w-auto" />
      <Card title={title} className="w-full max-w-sm">
        {children}
      </Card>
    </main>
  );
}
