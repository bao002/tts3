import { Link, useRouterState } from "@tanstack/react-router";
import { AudioLines, Menu, Moon, Sun, SunMoon, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

type Theme = "system" | "light" | "dark";

const navigation = [
  { to: "/", label: "Playground", exact: true },
  { to: "/docs", label: "API docs" },
  { to: "/reports", label: "Usage" },
  { to: "/tokens", label: "Tokens" },
  { to: "/account", label: "Account" },
] as const;

const themeOrder: Theme[] = ["system", "light", "dark"];

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("speak-api-theme");
    const initialTheme: Theme =
      savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
        ? savedTheme
        : "system";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemTheme = () => applyTheme("system");
    media.addEventListener("change", handleSystemTheme);
    return () => media.removeEventListener("change", handleSystemTheme);
  }, [theme]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  function cycleTheme() {
    const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length] ?? "system";
    setTheme(nextTheme);
    window.localStorage.setItem("speak-api-theme", nextTheme);
    applyTheme(nextTheme);
  }

  const ThemeIcon = theme === "system" ? SunMoon : theme === "dark" ? Moon : Sun;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight"
            aria-label="Speak API home"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <AudioLines aria-hidden="true" className="size-5" />
            </span>
            <span className="truncate">Speak API</span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {navigation.map(({ to, label }) => {
              const active = to === "/" ? pathname === to : pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={cycleTheme}
              className="inline-flex size-10 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Theme: ${theme}. Activate to change theme.`}
              title={`Theme: ${theme}`}
            >
              <ThemeIcon aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? (
                <X aria-hidden="true" className="size-5" />
              ) : (
                <Menu aria-hidden="true" className="size-5" />
              )}
            </button>
          </div>
        </div>
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          hidden={!menuOpen}
          className="border-t border-border px-4 py-3 md:hidden"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {navigation.map(({ to, label }) => {
              const active = to === "/" ? pathname === to : pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-3 text-sm ${
                    active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
