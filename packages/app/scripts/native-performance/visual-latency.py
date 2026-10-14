"""Measure recorded native frames using Android Winscope's elapsed-time metadata."""
import argparse
import json
import struct
from pathlib import Path
import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--run', required=True, type=Path)
parser.add_argument('--references', required=True, type=Path)
args = parser.parse_args()
names = ['Home', 'Chat', 'Inbox', 'Automations']
files = ['nav.png', 'chat.png', 'inbox.png', 'automations.png']
reference = [cv2.resize(cv2.imread(str(args.references / file)), (270, 600), interpolation=cv2.INTER_AREA) for file in files]
video_bytes = (args.run / 'video.mp4').read_bytes()
magic = b'#VV1NSC0PET1ME2#'
position = video_bytes.find(magic)
if position < 0:
    raise RuntimeError('No native frame-clock metadata; visible latency unavailable')
version, real_elapsed_offset, count = struct.unpack_from('<IqI', video_bytes, position + len(magic))
if version != 2:
    raise RuntimeError('Unsupported native frame-clock metadata')
clock = struct.unpack_from('<' + 'Q' * count, video_bytes, position + len(magic) + 16)
footer = [r[552:584, :, :].astype(np.float32) for r in reference]
body = [r[45:540, :210, :].astype(np.float32) for r in reference]
body_masks = [np.min(candidate, axis=2) < 160 for candidate in body]
video = cv2.VideoCapture(str(args.run / 'video.mp4'))
frames = []
index = 0
while True:
    success, frame = video.read()
    if not success:
        break
    if index >= count:
        raise RuntimeError('More decoded frames than native timestamps')
    image = cv2.resize(frame, (270, 600), interpolation=cv2.INTER_AREA).astype(np.float32)
    footer_errors = [float(np.mean(np.abs(image[552:584] - candidate))) for candidate in footer]
    body_errors = [float(np.mean(np.abs(image[45:540, :210] - candidate)[mask])) for candidate, mask in zip(body, body_masks)]
    frames.append({'ts': clock[index], 'footer_errors': footer_errors, 'body_errors': body_errors})
    index += 1
video.release()
if index != count:
    raise RuntimeError(f'Frame/timestamp count mismatch: {index} decoded / {count} native')
(args.run / 'visual-frame-samples.json').write_text(json.dumps(frames, indent=2) + '\n')
latencies = json.loads((args.run / 'latencies.json').read_text())
paths = ['/open-project', '/chat', '/sessions', '/schedules']
results = []
for step_index, latency in enumerate(latencies):
    target = paths.index(latency['path'])
    start = latency['input_ts']
    end = latencies[step_index + 1]['input_ts'] if step_index + 1 < len(latencies) else start + 2_000_000_000
    window = [frame for frame in frames if start <= frame['ts'] < end]
    feedback = next((frame for frame in window if int(np.argmin(frame['footer_errors'])) == target and frame['footer_errors'][target] < 3), None)
    usable = next((frame for frame in window if int(np.argmin(frame['footer_errors'])) == target and int(np.argmin(frame['body_errors'])) == target and frame['body_errors'][target] < 18), None)
    results.append({'path': latency['path'], 'input_ts': start, 'feedback_frame_ts': feedback['ts'] if feedback else None, 'usable_frame_ts': usable['ts'] if usable else None, 'feedback_ms': (feedback['ts']-start)/1e6 if feedback else None, 'usable_ms': (usable['ts']-start)/1e6 if usable else None})
(args.run / 'visual-latencies.json').write_text(json.dumps({'definition': 'First recorded native frame matching selected footer; usable also matches cached target content reference. All decoded frames must match Winscope elapsed timestamps. Footer MAE <3/255; body dark-ink MAE <18/255, nearest of four target templates. Inspect frames and thresholds before accepting.', 'samples': results}, indent=2) + '\n')
print(json.dumps({'native_video_frames': count, 'interactions': len(results), 'feedback_matches': sum(r['feedback_ms'] is not None for r in results), 'usable_matches': sum(r['usable_ms'] is not None for r in results)}, indent=2))
