import { useCallback, useId, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button } from "../components/ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command.js";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";

export interface ComboboxRepository {
  connectionId: string;
  repositoryId: number;
  fullName: string;
  defaultBranch: string;
}

export function RepositoryCombobox({
  repositories,
  loading,
  selected,
  placeholder,
  disabled,
  onSelect,
}: {
  repositories: ComboboxRepository[];
  loading: boolean;
  selected: ComboboxRepository | null;
  placeholder: string;
  disabled?: boolean;
  onSelect: (repository: ComboboxRepository) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const handleSelect = useCallback(
    (fullName: string) => {
      const repository = repositories.find((candidate) => candidate.fullName === fullName);
      if (repository === undefined) return;
      onSelect(repository);
      setOpen(false);
    },
    [repositories, onSelect],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className="truncate">{selected?.fullName ?? placeholder}</span>
          {loading ? (
            <Loader2Icon className="size-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popper-anchor-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search repositories…" />
          <CommandList id={listId}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading repositories…
              </div>
            ) : (
              <>
                <CommandEmpty>No repositories found.</CommandEmpty>
                {repositories.map((repository) => (
                  <CommandItem
                    key={`${repository.connectionId}-${repository.repositoryId}`}
                    value={repository.fullName}
                    onSelect={handleSelect}
                  >
                    <CheckIcon
                      className={cn(
                        selected !== null &&
                          selected.connectionId === repository.connectionId &&
                          selected.repositoryId === repository.repositoryId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="truncate">{repository.fullName}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {repository.defaultBranch}
                    </span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
