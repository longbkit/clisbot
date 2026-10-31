const { withMainApplication } = require("expo/config-plugins");

const MARKER = "// clisbot: fetch's per-host limit";

function factory(perHost) {
  return `    ${MARKER} (docs/features/offline/connection-resilience.md#cold-start-connect-path).
    com.facebook.react.modules.network.OkHttpClientProvider.setOkHttpClientFactory(
      object : com.facebook.react.modules.network.OkHttpClientFactory {
        override fun createNewNetworkModuleClient(): okhttp3.OkHttpClient {
          val dispatcher = okhttp3.Dispatcher()
          dispatcher.maxRequestsPerHost = ${perHost}
          dispatcher.maxRequests = ${perHost * 2}
          val provider = com.facebook.react.modules.network.OkHttpClientProvider
          return provider.createClientBuilder(this@MainApplication).dispatcher(dispatcher).build()
        }
      }
    )
`;
}

/**
 * React Native's shared OkHttp client runs at most 5 calls per host and queues the rest. A cold
 * start with 14 Hub-managed Hosts sends the account, the daemon list and 14 tickets to one Hub
 * host together, so they went out in four waves of one round trip each (about 400 ms apiece over
 * the VPN). The Hub speaks HTTP/2, so more calls share one connection. The factory keeps React
 * Native's default builder (cookie jar, 10 MB cache) and only widens the dispatcher.
 */
function configureHttpPerHost(source, perHost) {
  if (source.includes(MARKER)) return source;
  const call = "super.onCreate()";
  const at = source.indexOf(call);
  if (at === -1)
    throw new Error("withAndroidHttpPerHost: MainApplication.onCreate has no super.onCreate()");
  const lineEnd = source.indexOf("\n", at) + 1;
  return source.slice(0, lineEnd) + factory(perHost) + source.slice(lineEnd);
}

function withAndroidHttpPerHost(config, perHost = 32) {
  return withMainApplication(config, (modConfig) => {
    if (modConfig.modResults.language !== "kt") {
      throw new Error("withAndroidHttpPerHost expects a Kotlin MainApplication");
    }
    modConfig.modResults.contents = configureHttpPerHost(modConfig.modResults.contents, perHost);
    return modConfig;
  });
}

module.exports = withAndroidHttpPerHost;
module.exports.configureHttpPerHost = configureHttpPerHost;
