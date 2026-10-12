import { useEffect, useState } from "react";
import { AppState } from "react-native";
function localDay() {
  return new Date().toDateString();
}
/** Retained filters must move to today's boundary after midnight and background resume. */
export function useLocalDay() {
  const [day, setDay] = useState(localDay);
  useEffect(() => {
    const update = () => setDay(localDay());
    const timer = setInterval(update, 30000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return day;
}
