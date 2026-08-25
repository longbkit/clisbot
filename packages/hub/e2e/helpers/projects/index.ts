import type { Page } from "@playwright/test";
import { ProjectConfiguration } from "./configuration.js";
import { ProjectConnections } from "./connections.js";
import { ProjectNavigation } from "./navigation.js";
import { ProjectLifecycle } from "./projects.js";

export function projectApp(page: Page) {
  return {
    navigation: new ProjectNavigation(page),
    projects: new ProjectLifecycle(page),
    connections: new ProjectConnections(page),
    configuration: new ProjectConfiguration(page),
  };
}
