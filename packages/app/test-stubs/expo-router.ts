export const router = { push: () => undefined, replace: () => undefined, back: () => undefined };
export const useRouter = () => router;
export const usePathname = () => "/";
export const useLocalSearchParams = () => ({});
// Clisbot navigation imports these; component tests never mount a navigator, so they read inert.
const navigationContainerRef = {
  current: null,
  isReady: () => false,
  getRootState: () => undefined,
  getCurrentRoute: () => undefined,
  addListener: () => () => undefined,
  dispatch: () => undefined,
  navigate: () => undefined,
};
export const useNavigationContainerRef = () => navigationContainerRef;
export const useSegments = () => [];
