const { withMainActivity } = require("expo/config-plugins");

const MARKER = "// clisbot: Back at the root moves the task to the back";
const SIGNATURE = "override fun invokeDefaultOnBackPressed()";
const OVERRIDE = `  ${MARKER}; the activity and its React surface stay.
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(false)) {
          super.invokeDefaultOnBackPressed()
      }
  }`;

/** The end of the brace block opened at or after `from`. */
function blockEnd(source, from) {
  let depth = 0;
  for (let index = source.indexOf("{", from); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index + 1;
  }
  throw new Error("Unbalanced braces in MainActivity");
}

/**
 * Home's Back calls `BackHandler.exitApp()`, which ends in `Activity.onBackPressed()`. Android 12+
 * moves the task to the back only when a launcher intent started it; a task started from a
 * notification or the Hub sign-in link finishes the activity, React Native unmounts the whole app,
 * and reopening rebuilds every screen. Expo's template moves the task to the back only on Android
 * 11 and lower. This does it on every version, as the launcher case already behaves.
 */
function configureBackKeepsTask(source) {
  if (source.includes(MARKER)) return source;
  const start = source.indexOf(SIGNATURE);
  if (start !== -1) {
    // Replace the template's doc comment too, when it sits directly above the function.
    const commentStart = source.lastIndexOf("/**", start);
    const commentEnd = source.lastIndexOf("*/", start);
    const documented =
      commentStart !== -1 &&
      commentEnd > commentStart &&
      source.slice(commentEnd + 2, start).trim() === "";
    const from = source.lastIndexOf("\n", documented ? commentStart : start) + 1;
    return source.slice(0, from) + OVERRIDE + source.slice(blockEnd(source, start));
  }
  const classEnd = source.lastIndexOf("}");
  if (classEnd === -1) throw new Error("Could not find the MainActivity class body");
  return `${source.slice(0, classEnd).trimEnd()}\n\n${OVERRIDE}\n}\n`;
}

function withAndroidBackKeepsTask(config) {
  return withMainActivity(config, (modConfig) => {
    if (modConfig.modResults.language !== "kt") {
      throw new Error("withAndroidBackKeepsTask expects a Kotlin MainActivity");
    }
    modConfig.modResults.contents = configureBackKeepsTask(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidBackKeepsTask;
module.exports.configureBackKeepsTask = configureBackKeepsTask;
