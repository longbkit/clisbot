package sh.clisbot.receivecodec

import java.nio.charset.CharacterCodingException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AuthenticatedTextTest {
  @Test fun preservesEmojiAndNul() {
    assertEquals("codec 😀\u0000", decodeAuthenticatedText("codec 😀\u0000".toByteArray(Charsets.UTF_8)))
  }
  @Test fun stripsOnlyOneLeadingBom() {
    assertEquals("{}", decodeAuthenticatedText("\uFEFF{}".toByteArray(Charsets.UTF_8)))
    assertEquals("\uFEFF{}", decodeAuthenticatedText("\uFEFF\uFEFF{}".toByteArray(Charsets.UTF_8)))
    assertEquals("x\uFEFF", decodeAuthenticatedText("x\uFEFF".toByteArray(Charsets.UTF_8)))
  }
  @Test fun emptyTextIsValid() { assertEquals("", decodeAuthenticatedText(byteArrayOf())) }
  @Test fun malformedIsNeverReplacementText() {
    for (bytes in arrayOf(byteArrayOf(0xC3.toByte(), 0x28), byteArrayOf(0xF0.toByte(), 0x9F.toByte()),
        byteArrayOf(0xC0.toByte(), 0x80.toByte()), byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()))) {
      assertThrows(CharacterCodingException::class.java) { decodeAuthenticatedText(bytes) }
    }
  }
}
