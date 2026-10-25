import { Redirect } from "expo-router";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { TasksScreen } from "@/clisbot/navigation/tasks-screen";

export default function TasksRoute() {
  return NAVIGATION_V2_ENABLED ? <TasksScreen /> : <Redirect href="/open-project" />;
}
