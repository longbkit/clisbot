import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../lib/utils.js";

/**
 * The frame for every surface reached before the dashboard: sign-in, the organization
 * gate, invitations, and daemon approval. A product mark, then one card. The mark is
 * the branding — surfaces do not repeat it as a badge above their own title.
 */
const LAYOUT_WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

export function AuthLayout({
  children,
  width = "sm",
}: {
  children: ReactNode;
  /** `lg` is for the app setup journey, whose generated URLs need room beside a copy button. */
  width?: keyof typeof LAYOUT_WIDTHS;
}) {
  return (
    <main
      className={cn(
        "flex min-h-svh flex-col items-center gap-6 bg-background p-6",
        width === "lg" ? "justify-start py-10" : "justify-center",
      )}
    >
      <ProductMark />
      <div className={cn("min-w-0 w-full", LAYOUT_WIDTHS[width])}>{children}</div>
    </main>
  );
}

export function AuthCard({
  title,
  description,
  descriptionRole,
  children,
  titleId,
}: {
  title: string;
  description?: string;
  /** Set to "status" when the description reports account state that just changed. */
  descriptionRole?: "status";
  children: ReactNode;
  titleId?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Each of these cards is a whole screen, and they replace one another in place. Taking focus
  // on arrival is what tells a screen reader the screen changed and puts a keyboard user at the
  // top of the new card instead of back on the document body.
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      className="grid gap-6 rounded-lg border bg-card p-6 shadow-sm"
      {...(titleId === undefined ? {} : { "aria-labelledby": titleId })}
    >
      <div className="grid gap-1.5">
        <h1 ref={heading} id={titleId} tabIndex={-1} className="text-base font-medium outline-none">
          {title}
        </h1>
        {description === undefined ? null : (
          <p
            className="text-sm text-balance text-muted-foreground"
            {...(descriptionRole === undefined ? {} : { role: descriptionRole })}
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function ProductMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ClisbotGlyph />
      </span>
      <span className="text-sm">Clisbot Hub</span>
    </div>
  );
}

export function ClisbotGlyph() {
  return (
    <svg viewBox="0 0 700 700" className="size-4" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M159.6 140H442.4C470.4 140 490 161 490 189V280H383.6C341.6 280 315 310.8 315 350V380.8C315 414.4 301 429.8 271.6 429.8H161C124.6 429.8 98 403.2 98 368.2V203C98 166.6 124.6 140 159.6 140ZM173.6 183.4C159.684 183.4 148.4 194.684 148.4 208.6C148.4 222.516 159.684 233.8 173.6 233.8H389.2C403.116 233.8 414.4 222.516 414.4 208.6C414.4 194.684 403.116 183.4 389.2 183.4H173.6Z M406 329H548.8C579.6 329 602 352.8 602 383.6V452.2C602 484.4 582.4 508.2 551.6 508.2V544.6C551.6 554.4 546 558.6 537.6 551.6L488.6 511H385C354.2 511 330.4 497 322 476C345.8 466.2 361.2 449.4 361.2 424.2V380.8C361.2 350 378 329 406 329Z"
      />
    </svg>
  );
}
