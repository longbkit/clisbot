/**
 * The one empty state: a short noun phrase and a line of context.
 */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-md text-sm text-balance text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
