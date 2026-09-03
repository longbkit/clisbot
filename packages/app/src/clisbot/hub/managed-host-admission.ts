export function hubManagedHostRequiresAccessTicket(managedAccessMode: "off" | "external"): boolean {
  return managedAccessMode === "external";
}
