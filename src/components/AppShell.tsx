import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  children: ReactNode;
  clientName?: string;
  clientMarket?: string;
  clientId?: string;
}

export function AppShell({ children, clientName, clientMarket, clientId }: AppShellProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const isInsideClient = !!clientName;

  const navItem = (to: string, label: string) => {
    const active =
      pathname === to ||
      (to !== "/dashboard" && pathname.startsWith(to));
    return (
      <Link
        key={to}
        to={to}
        className={`px-3 py-1.5 text-sm rounded-sm transition-colors ${
          active
            ? "text-foreground bg-elevated"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="terr-wordmark shrink-0">TERRAIN</Link>

            {isInsideClient ? (
              <div className="flex items-center gap-2 text-sm">
                <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
                  ←
                </Link>
                <span className="text-border">/</span>
                {clientId ? (
                  <Link
                    to="/clients/$id"
                    params={{ id: clientId }}
                    className="font-medium hover:text-accent truncate max-w-[160px]"
                  >
                    {clientName}
                  </Link>
                ) : (
                  <span className="font-medium truncate max-w-[160px]">{clientName}</span>
                )}
                {clientMarket && (
                  <span className="text-xs text-muted-foreground hidden md:block truncate max-w-[200px]">
                    · {clientMarket}
                  </span>
                )}
              </div>
            ) : (
              <nav className="flex items-center gap-1">
                {navItem("/dashboard", "Dashboard")}
                {navItem("/clients", "Clients")}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-mono hidden sm:block">{email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
    </div>
  );
}
