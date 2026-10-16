package sh.clisbot.trace

import android.os.Trace
import android.os.SystemClock
import android.view.MotionEvent
import android.view.Window
import com.facebook.hermes.instrumentation.HermesSamplingProfiler
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

class ClisbotNativeTraceModule : Module() {
  private var tracedWindow: Window? = null
  private var originalCallback: Window.Callback? = null
  private var samplingAttempted = false

  // Disposable synthetic process only. The external controller MUST force-stop it after the
  // acknowledgment or its independent deadline. RN 0.81.5's wrapper disable is misregistered;
  // never call it, and never leave this sampler alive for later measurements.
  @Synchronized
  private fun startArmedHermesSampling(workspaceKey: String): Boolean {
    if (!BuildConfig.SYNTHETIC_HERMES_SAMPLING || samplingAttempted) return false
    val context = appContext.reactContext ?: return false
    if (context.packageName != "com.clisbot.app.dev") return false
    val directory = context.getExternalFilesDir(null) ?: return false
    val arm = File(directory, "cto029-hermes.arm")
    if (!arm.isFile || arm.readText().trim() != workspaceKey) return false
    if (!arm.delete()) return false
    samplingAttempted = true
    val result = JSONObject().put("workspaceKey", workspaceKey)
      .put("pid", android.os.Process.myPid()).put("startElapsedNs", SystemClock.elapsedRealtimeNanos())
    fun acknowledge(error: Throwable? = null) {
      result.put("status", if (error == null) "dump-returned" else "unavailable")
        .put("ackElapsedNs", SystemClock.elapsedRealtimeNanos())
      if (error != null) result.put("error", error.toString())
      File(directory, "cto029-hermes-result.json").writeText(result.toString())
    }
    try {
      Trace.beginSection("clisbot.sampler.enable")
      try { HermesSamplingProfiler.enable() } finally { Trace.endSection() }
      result.put("enabledElapsedNs", SystemClock.elapsedRealtimeNanos())
      Thread({
        try {
          Thread.sleep(2000)
          result.put("dumpStartElapsedNs", SystemClock.elapsedRealtimeNanos())
          Trace.beginSection("clisbot.sampler.dump")
          try {
            HermesSamplingProfiler.dumpSampledTraceToFile(File(directory, "cto029-entry.cpuprofile").absolutePath)
          } finally { Trace.endSection() }
          // Only successful synchronous return is acknowledged. Existence alone is insufficient.
          acknowledge()
        } catch (error: Throwable) { acknowledge(error) }
      }, "cto029-hermes-dump").apply { isDaemon = true }.start()
    } catch (error: Throwable) { acknowledge(error) }
    return true
  }

  override fun definition() = ModuleDefinition {
    Name("ClisbotNativeTrace")

    Function("beginSection") { name: String ->
      Trace.beginSection(name.take(127))
    }

    Function("endSection") {
      Trace.endSection()
    }

    Function("startArmedHermesSampling") { workspaceKey: String ->
      startArmedHermesSampling(workspaceKey)
    }

    // Installed only by a profile build. Keep dispatch behavior and navigator ownership intact.
    Function("startInputTracing") {
      appContext.currentActivity?.runOnUiThread {
        val window = appContext.currentActivity?.window ?: return@runOnUiThread
        if (tracedWindow === window) return@runOnUiThread
        val original = window.callback ?: return@runOnUiThread
        tracedWindow = window
        originalCallback = original
        window.callback = object : Window.Callback by original {
          override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            val action = when (event.actionMasked) {
              MotionEvent.ACTION_DOWN -> "down"
              MotionEvent.ACTION_UP -> "up"
              MotionEvent.ACTION_CANCEL -> "cancel"
              else -> null
            }
            if (action != null) {
              Trace.beginSection("clisbot.input.$action|eventMs=${event.eventTime};downMs=${event.downTime};x=${event.x.toInt()};y=${event.y.toInt()}")
              Trace.endSection()
            }
            return original.dispatchTouchEvent(event)
          }
        }
      }
    }

    OnDestroy {
      val window = tracedWindow
      val callback = originalCallback
      appContext.currentActivity?.runOnUiThread {
        if (window != null && callback != null) window.callback = callback
      }
      tracedWindow = null
      originalCallback = null
    }
  }
}
