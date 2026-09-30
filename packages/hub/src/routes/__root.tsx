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
      { title: "Clisbot Hub" },
    ],
    links: [
      {
        rel: "icon",
        href: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227.04%22%20fill%3D%22%23153B43%22%2F%3E%3Cg%20transform%3D%22translate(4.48%206.4)%20scale(0.064)%22%20color%3D%22%23A1DFD4%22%3E%3Cpath%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20d%3D%22M44%200H246C266%200%20280%2015%20280%2035V100H204C174%20100%20155%20122%20155%20150V172C155%20196%20145%20207%20124%20207H45C19%20207%200%20188%200%20163V45C0%2019%2019%200%2044%200ZM54%2031C44.06%2031%2036%2039.06%2036%2049C36%2058.94%2044.06%2067%2054%2067H208C217.94%2067%20226%2058.94%20226%2049C226%2039.06%20217.94%2031%20208%2031H54Z%22%2F%3E%0A%20%20%3Cpath%20fill%3D%22currentColor%22%20d%3D%22M220%20135H322C344%20135%20360%20152%20360%20174V223C360%20246%20346%20263%20324%20263V289C324%20296%20320%20299%20314%20294L279%20265H205C183%20265%20166%20255%20160%20240C177%20233%20188%20221%20188%20203V172C188%20150%20200%20135%20220%20135Z%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E",
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
            This address does not match a page in Clisbot Hub. Check the address or return home.
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
