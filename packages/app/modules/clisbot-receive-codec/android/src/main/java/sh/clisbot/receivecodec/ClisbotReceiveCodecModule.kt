package sh.clisbot.receivecodec

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.CharacterCodingException
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel

class ClisbotReceiveCodecModule : Module() {
  // Dedicated to this codec, never Expo's shared modulesQueue or the UI thread.
  // The app adapter submits at most one call and bounds its waiting byte budget.
  private val dispatcher = Executors.newSingleThreadExecutor { task -> Thread(task, "clisbot.receive") }.asCoroutineDispatcher()
  private val scope = CoroutineScope(SupervisorJob() + dispatcher)
  private var linked = false
  private external fun openAuthenticated(key: ByteArray, bundle: ByteArray): ByteArray?

  private fun open(key: ByteArray, bytes: ByteArray, binary: Boolean): Map<String, Any> {
    try {
      if (!linked) { System.loadLibrary("clisbot_receive_codec"); linked = true }
      if (bytes.size > 32 * 1024 * 1024 || bytes.size < 40 || key.size != 32)
        throw CodedException("ERR_CODEC_PROTOCOL", "Invalid encrypted frame", null)
      val plaintext = openAuthenticated(key, bytes)
        ?: throw CodedException("ERR_CODEC_MAC", "Encrypted frame authentication failed", null)
      val result: Any = if (binary) plaintext else {
        try {
          // WHATWG TextDecoder strips exactly the leading UTF-8 BOM. JVM String
          // conversion preserves supplementary code points and embedded NUL.
          decodeAuthenticatedText(plaintext)
        } catch (_: CharacterCodingException) {
          throw CodedException("ERR_CODEC_PROTOCOL", "Invalid authenticated UTF-8", null)
        } finally { plaintext.fill(0) }
      }
      return mapOf("nonce" to bytes.copyOfRange(0, 24), "plaintext" to result)
    } catch (error: CodedException) { throw error
    } catch (error: Throwable) {
      throw CodedException("ERR_CODEC_INFRA", "Native receive codec unavailable", error)
    } finally { key.fill(0) }
  }

  override fun definition() = ModuleDefinition {
    Name("ClisbotReceiveCodec")
    AsyncFunction("openText") { key: ByteArray, text: String ->
      val bytes = try {
        if (text.length > 32 * 1024 * 1024) throw IllegalArgumentException()
        // Match ECMAScript trim, URL-safe alphabet and optional padding. Reject
        // malformed input rather than Android's default ignored-character decoding.
        val normalized = text.trim { it in "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF" }
          .replace('-', '+').replace('_', '/')
        if (!normalized.matches(Regex("[A-Za-z0-9+/]*={0,2}"))) throw IllegalArgumentException()
        Base64.decode(normalized, Base64.NO_WRAP)
      } catch (_: IllegalArgumentException) {
        key.fill(0)
        throw CodedException("ERR_CODEC_PROTOCOL", "Invalid encrypted text frame", null)
      }
      open(key, bytes, false)
    }.runOnQueue(scope)
    AsyncFunction("openBinary") { key: ByteArray, bytes: ByteArray -> open(key, bytes, true) }.runOnQueue(scope)
    OnDestroy { scope.cancel(); dispatcher.close() }
  }
}
