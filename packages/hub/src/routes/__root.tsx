import type { ReactNode } from "react";
import { Link, createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Button } from "../components/ui/button.js";
import "../styles.entry.js";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "referrer", content: "same-origin" },
      { title: "Paseo Hub" },
    ],
    links: [
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><circle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%23fafafa%22/><path d=%22M10 9h7a6 6 0 0 1 0 12h-3v4h-4V9zm4 4v4h3a2 2 0 1 0 0-4h-3z%22 fill=%22%2309090b%22/></svg>",
      },
    ],
  }),
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function NotFound() {
  return (
    <Document>
      <main className="grid min-h-svh place-items-center px-6 py-16">
        <div className="grid max-w-md gap-4 text-center">
          <p className="text-sm text-muted-foreground">404</p>
          <h1 className="text-2xl font-medium tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            This address does not match a page in Paseo Hub. Check the address or return home.
          </p>
          <div>
            <Button asChild>
              <Link to="/">Return home</Link>
            </Button>
          </div>
        </div>
      </main>
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
