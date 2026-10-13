package sh.clisbot.trace

import android.os.Trace
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClisbotNativeTraceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClisbotNativeTrace")

    Function("beginSection") { name: String ->
      Trace.beginSection(name.take(127))
    }

    Function("endSection") {
      Trace.endSection()
    }
  }
}
