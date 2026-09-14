// Tests load no Expo config; every consumer reads `expoConfig` through
// optional chaining, so an empty default keeps the module top level inert.
const Constants = {
  expoConfig: undefined,
  manifest: undefined,
  nativeAppVersion: undefined,
};

export default Constants;
