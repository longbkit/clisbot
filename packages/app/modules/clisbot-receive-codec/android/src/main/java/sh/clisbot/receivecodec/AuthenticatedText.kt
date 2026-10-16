package sh.clisbot.receivecodec

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** WHATWG fatal UTF-8 semantics, applied only after successful MAC verification. */
internal fun decodeAuthenticatedText(plaintext: ByteArray): String =
  Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(plaintext))
    .toString().removePrefix("\uFEFF")
