// The undici option record `EnvHttpProxyAgent` accepts, declared locally so the
// Fusion fetch boundary does not pull undici's type surface into the vertical's
// public types (D-030).
export type EnvHttpProxyAgentProxyOptions = {
  httpProxy?: string;
  httpsProxy?: string;
};
