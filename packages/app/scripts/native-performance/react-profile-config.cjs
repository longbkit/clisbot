// Select the installed optimized profiling renderer only for disposable Android diagnostics.
function isSyntheticReactProfileBuild(env = process.env) {
  return (
    env.APP_VARIANT === "development" &&
    env.CLISBOT_PROFILE_BUILD === "1" &&
    env.CLISBOT_REACT_PROFILE === "1"
  );
}

function isFabricProductionRenderer(resolution) {
  return (
    resolution.type === "sourceFile" &&
    /[/\\]react-native[/\\]Libraries[/\\]Renderer[/\\]implementations[/\\]ReactFabric-prod\.js$/.test(
      resolution.filePath,
    )
  );
}

module.exports = { isSyntheticReactProfileBuild, isFabricProductionRenderer };
