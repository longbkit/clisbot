package sh.clisbot.trace

import android.os.Trace
import android.view.MotionEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClisbotNativeTraceModule : Module() {
  private var tracedWindow: Window? = null
  private var originalCallback: Window.Callback? = null

  override fun definition() = ModuleDefinition {
    Name("ClisbotNativeTrace")

    Function("beginSection") { name: String ->
      Trace.beginSection(name.take(127))
    }

    Function("endSection") {
      Trace.endSection()
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
            if (event.actionMasked == MotionEvent.ACTION_UP) {
              Trace.beginSection("clisbot.input.up|eventMs=${event.eventTime}")
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
