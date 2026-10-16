#include <jni.h>
#include <sodium.h>
#include <vector>
#include <new>

// JNI copies only; no JS memory, key registry, nonce policy or plaintext fallback.
extern "C" JNIEXPORT jbyteArray JNICALL
Java_sh_clisbot_receivecodec_ClisbotReceiveCodecModule_openAuthenticated(
    JNIEnv *env, jobject, jbyteArray key, jbyteArray bundle) {
  if (sodium_init() < 0) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Sodium initialization failed");
    return nullptr;
  }
  unsigned char keyCopy[crypto_secretbox_KEYBYTES] = {};
  try {
  const auto size = env->GetArrayLength(bundle);
  if (env->GetArrayLength(key) != crypto_secretbox_KEYBYTES ||
      size < crypto_secretbox_NONCEBYTES + crypto_secretbox_MACBYTES) return nullptr;
  env->GetByteArrayRegion(key, 0, sizeof(keyCopy), reinterpret_cast<jbyte *>(keyCopy));
  std::vector<unsigned char> bytes(size);
  env->GetByteArrayRegion(bundle, 0, size, reinterpret_cast<jbyte *>(bytes.data()));
  std::vector<unsigned char> plaintext(size - crypto_secretbox_NONCEBYTES - crypto_secretbox_MACBYTES);
  const int result = crypto_secretbox_open_easy(plaintext.data(), bytes.data() + crypto_secretbox_NONCEBYTES,
      size - crypto_secretbox_NONCEBYTES, bytes.data(), keyCopy);
  sodium_memzero(keyCopy, sizeof(keyCopy));
  if (result != 0) return nullptr;
  auto output = env->NewByteArray(static_cast<jsize>(plaintext.size()));
  if (output) env->SetByteArrayRegion(output, 0, static_cast<jsize>(plaintext.size()), reinterpret_cast<jbyte *>(plaintext.data()));
  sodium_memzero(plaintext.data(), plaintext.size());
  return output;
  } catch (const std::bad_alloc &) {
    sodium_memzero(keyCopy, sizeof(keyCopy));
    env->ThrowNew(env->FindClass("java/lang/OutOfMemoryError"), "Receive codec allocation failed");
    return nullptr;
  }
}
