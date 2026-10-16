# Android receive codec

An optional app adapter for the existing encrypted channel. It authenticates and decodes **negotiated** `binaryCiphertext` frames on a dedicated serial worker. It changes no wire format, key agreement, nonce policy, credentials or daemon behavior. iOS, web, Electron, Node, absent native modules, and legacy non-negotiated receive retain the existing JS implementation. No JS fallback retries a failed native frame.

## Supply and build

- Official [libsodium 1.0.22 source](https://download.libsodium.org/libsodium/releases/libsodium-1.0.22.tar.gz), SHA-256 `adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349`. No floating stable/latest download or third-party binary.
- Detached upstream signature is retained in `vendor/`; verified with the public key from the [official installation instructions](https://libsodium.gitbook.io/doc/installation). Primary fingerprint `54A2B8892CC3D6A597B92B6C210627AABA709FE1`, signing subkey `0C7983A8FD9A104C623172CB62F25B592B6F76DA`. Build-time SHA verification pins those verified bytes. ISC license is retained unchanged.
- `scripts/build-sodium.py` runs upstream Autotools, following its Android target/minimal/static PIC path, with `make -j1`. No edited crypto source, handwritten primitive, LTO or sanitizers. NDK comes from the app's resolved `android.ndkDirectory` (current installed app toolchain 27.1.12297006); API 24. A binding file includes actual NDK `source.properties`, source hash, ABI and API.
- Gradle selects exactly `reactNativeArchitectures`; supports arm64-v8a, armeabi-v7a, x86 and x86_64. ARM64 is the first verification target, not a claim all ABIs/iOS ran. Generated source/static libraries stay under module `build/sodium`, separate per ABI. CMake statically links sodium into `libclisbot_receive_codec.so` with 16 KiB page alignment. No existing native caches/artifacts are overwritten.
- The wrapper is an Expo module. Its non-View `AsyncFunction` uses its own single-thread coroutine dispatcher (`clisbot.receive`), not the UI or shared Expo modules queue. JNI calls `crypto_secretbox_open_easy`, compatible with TweetNaCl's already-derived `box.before` key. JNI returns bytes; strict UTF-8 conversion uses Java's reporting decoder, not `NewStringUTF`.

## Admission, order and failure

The app selector opens a pinned known-answer vector through both text and binary paths (including leading BOM, emoji and NUL) before starting the channel handshake. This verifies both String and ByteArray return conversion. Presence alone is not capability. The codec has no native key registry: Expo copies the 32-byte key per call; worker and JNI copies are wiped after use. Binary inputs are copied at channel admission so later transport mutation cannot change authentication input. Base64 conversion, MAC/open and strict UTF-8 run on the worker. JSI/JNI argument/result copies, JSON parsing, store updates and React/Fabric work remain outside that promise of off-thread execution.

`EncryptedChannel` is the one ordered receive owner. It serializes modern frames including stray handshake frames. Only successful native MAC verification returns the nonce; existing `ChannelNonces` then checks reflection/replay/order before any application callback. No failure or close can deliver later queued results. A channel lifetime signal skips queued adapter work after close; an active native call may finish but its result cannot enter the closed channel. A fresh channel has its own key, nonce ledger and lifetime. Rekey rejection remains unchanged.

MAC/malformed/UTF-8 errors close the channel and do not disable native capability. A classified infrastructure/link/worker failure closes the current channel without retry and disables the adapter for the process. Other existing native channels also close on their next receive; the **next fresh** encrypted channel chooses the existing JS implementation. There is no plaintext downgrade. The adapter rejects unexpected result shape as infrastructure failure.

## Bounds and recovery

The existing checkout diff contract budgets encoded wire frames against 32 MiB. The native channel admits at most that single-frame size, 64 queued/in-flight frames, and 64 MiB of charged retained input (text charged at two bytes per UTF-16 code unit; binary by byte length). One maximum supported text frame fits only when both the channel and process adapter have empty input queues. Concurrent traffic can hit the cutoff and disconnect; maximum-frame progress under concurrency is not guaranteed. Overload closes with a generic reconnect reason; it never skips an update or trims the queue and continues. Existing transport reconnection/snapshot reconciliation remains responsible for recovery; no new retry loop is added.

The process adapter also bounds submitted work to 64 frames / 64 MiB and issues only one native call at a time, even across channels. These are **separate bounds**, not a global aggregate retained-memory cap: each channel still owns its queued inputs, native/JS copies amplify peak usage, and WebSocket buffers exist outside this owner. A maximum-sized frame can still be expensive. No claim of bounded application-wide memory, zero-copy transport, nonblocking JSON/render, or accepted latency follows from these limits.

Legacy base64-first/raw fallback is deliberately untouched. Modern text accepts standard/URL-safe base64 and optional padding; malformed input fails closed. Fatal UTF-8 strips one leading BOM and preserves emoji/NUL; binary plaintext is never guessed to be text.

## Verification contract

Run affected channel ordering/replay/close/capacity tests, app capability/queue/error tests, and native known-answer/UTF-8/binary/malformed vectors. A module build proves linkage only; the packaged on-device capability probe and ordinary real-DM entry/return/Back journey prove actual use and interaction separately. Keep exact APK/source/map binding and platform limits; no performance claim from module tests.
