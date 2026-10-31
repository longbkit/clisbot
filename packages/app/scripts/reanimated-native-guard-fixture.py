#!/usr/bin/env python3
"""Exercise the actual Reanimated method body with controlled Fabric semantics.

Pass the actual NativeProxy.kt path. This is a diagnostic fixture, not a phone test.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).read_text()
start = source.index('    fun synchronouslyUpdateUIProps(')
opening = source.index('{', start)
depth = 0
for end in range(opening, len(source)):
    if source[end] == '{': depth += 1
    if source[end] == '}':
        depth -= 1
        if depth == 0: break
method = source[start:end + 1]
fixture = r'''
object BuildConfig { var IS_REACT_NATIVE_86_OR_NEWER = true }
class IllegalViewOperationException : Exception()
object Log {
  val warnings = mutableListOf<String>()
  fun w(label: String, message: String, error: Exception) { warnings.add(message) }
}
class FakeFabric {
  var secondTagMounted = false
  val legacy = mutableListOf<Int>()
  fun resolveView(tag: Int): Any? = when (tag) {
    2 -> if (secondTagMounted) Any() else null
    3 -> throw IllegalViewOperationException()
    else -> Any()
  }
  fun synchronouslyUpdateViewOnUIThread(tag: Int, props: Any) { legacy.add(tag) }
}
class FakeMethod(private val fabric: FakeFabric) {
  val called = mutableListOf<Int>()
  fun invoke(manager: Any, tag: Int, props: Any) {
    called.add(tag)
    if ((tag == 2 && !fabric.secondTagMounted) || tag == 4) throw IllegalStateException("fixture-update-failure")
  }
}
object SynchronousPropsBufferParser {
  fun parse(intBuffer: IntArray, doubleBuffer: DoubleArray, callback: (Int, Any) -> Unit) {
    intBuffer.forEach { callback(it, Unit) }
  }
}
class NativeProxy {
  val mFabricUIManager = FakeFabric()
  val mountingManager = Any()
  val updatePropsSynchronouslyMethod = FakeMethod(mFabricUIManager)
%s
}
fun main() {
  val proxy = NativeProxy()
  proxy.synchronouslyUpdateUIProps(intArrayOf(1, 2, 3, 4), doubleArrayOf())
  check(proxy.updatePropsSynchronouslyMethod.called == listOf(1, 3, 4)) {
    "expected live and preallocated tags sent to update, got ${proxy.updatePropsSynchronouslyMethod.called}"
  }
  check(Log.warnings.size == 1 && Log.warnings.single().contains("tag 4")) {
    "unexpected warnings for missing/preallocated tags or suppressed live failure: ${Log.warnings}"
  }
  proxy.mFabricUIManager.secondTagMounted = true
  proxy.synchronouslyUpdateUIProps(intArrayOf(2), doubleArrayOf())
  check(proxy.updatePropsSynchronouslyMethod.called == listOf(1, 3, 4, 2)) {
    "tag that becomes mounted must receive updates; stale state must not be cached"
  }
  BuildConfig.IS_REACT_NATIVE_86_OR_NEWER = false
  proxy.synchronouslyUpdateUIProps(intArrayOf(2), doubleArrayOf())
  check(proxy.mFabricUIManager.legacy == listOf(2)) { "legacy RN path changed" }
  println("PASS: live and preallocated updates, remount, missing target, real failure, legacy path")
}
''' % method
compiler = sys.argv[2]
env = os.environ.copy(); env['JAVA_HOME'] = sys.argv[3]
with tempfile.TemporaryDirectory() as directory:
    main = Path(directory) / 'GuardFixture.kt'; main.write_text(fixture)
    jar = Path(directory) / 'fixture.jar'
    subprocess.run(['bash', compiler, str(main), '-include-runtime', '-d', str(jar)], env=env,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = subprocess.run([env['JAVA_HOME'] + '/bin/java', '-jar', str(jar)], env=env)
    sys.exit(result.returncode)
