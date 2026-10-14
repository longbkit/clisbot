"""Capture native Android switching; pacing sleeps are never latency samples."""
import argparse
import json
import os
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--serial', required=True)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--config', required=True, type=Path)
parser.add_argument('--y', required=True, type=int)
parser.add_argument('--count', default=20, type=int)
parser.add_argument('--interval', default=2.5, type=float)
parser.add_argument('--package', default='com.clisbot.app.dev')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
base = ['adb', '-s', args.serial]

def adb(*command):
    return subprocess.check_output(base + list(command), text=True)

def save(name, command):
    (args.output / name).write_text(adb(*command))

save('meminfo-before.txt', ['shell', 'dumpsys', 'meminfo', args.package])
save('device.txt', ['shell', 'getprop', 'ro.build.fingerprint'])
adb('shell', 'dumpsys', 'gfxinfo', args.package, 'reset')
adb('push', str(args.config), '/data/local/tmp/cto019.cfg')
trace_path = '/data/misc/perfetto-traces/cto019.pftrace'
trace_log = (args.output / 'perfetto.log').open('w')
trace = subprocess.Popen(base + ['shell', 'perfetto', '--txt', '-c', '-', '-o', trace_path], stdin=args.config.open('rb'), stdout=trace_log, stderr=subprocess.STDOUT)
video_log = (args.output / 'screenrecord.log').open('w')
video = subprocess.Popen(base + ['shell', 'screenrecord', '--size', '540x1200', '--time-limit', '65', '--bit-rate', '4000000', '/sdcard/cto019.mp4'], stdout=video_log, stderr=subprocess.STDOUT)
host_load_before = os.getloadavg()
steps = []
try:
    time.sleep(2)
    for index in range(args.count):
        tab = (index + 1) % 4
        x = [135, 405, 675, 945][tab]
        before = time.monotonic_ns()
        adb('shell', 'input', 'tap', str(x), str(args.y))
        steps.append({'index': index, 'tab': ['Home', 'Chat', 'Inbox', 'Automations'][tab], 'host_dispatch_start_ns': before, 'host_dispatch_end_ns': time.monotonic_ns()})
        time.sleep(args.interval)
    if args.count == 0:
        # An idle capture still spans the native recording; sample memory at its end.
        time.sleep(60)
        time.sleep(3)
    save('gfxinfo.txt', ['shell', 'dumpsys', 'gfxinfo', args.package, 'framestats'])
    save('meminfo-after.txt', ['shell', 'dumpsys', 'meminfo', args.package])
    trace.wait(timeout=60)
    video.wait(timeout=60)
    if trace.returncode or video.returncode:
        raise RuntimeError('Native capture failed; inspect logs')
    adb('pull', trace_path, str(args.output / 'trace.pftrace'))
    adb('pull', '/sdcard/cto019.mp4', str(args.output / 'video.mp4'))
    subprocess.run(base + ['exec-out', 'screencap', '-p'], check=True, stdout=(args.output / 'end.png').open('wb'))
    try:
        save('hierarchy-command.txt', ['shell', 'uiautomator', 'dump', '/sdcard/cto019.xml'])
        adb('pull', '/sdcard/cto019.xml', str(args.output / 'hierarchy.xml'))
    except subprocess.CalledProcessError as error:
        (args.output / 'hierarchy-unavailable.txt').write_text(str(error) + '\n')
finally:
    for process in (trace, video):
        if process.poll() is None:
            process.terminate()
    trace_log.close()
    video_log.close()
    (args.output / 'steps.json').write_text(json.dumps({'parameters': vars(args) | {'output': str(args.output), 'config': str(args.config)}, 'steps': steps, 'host_load_before': host_load_before, 'host_load_after': os.getloadavg()}, indent=2) + '\n')
print(str(args.output))
