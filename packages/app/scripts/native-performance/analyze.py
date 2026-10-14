"""Export inspectable native samples. Never substitute route commit for usable content."""
import argparse
import csv
import io
import json
import math
from collections import Counter
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--processor', required=True)
parser.add_argument('--run', required=True, type=Path)
parser.add_argument('--package', default='com.clisbot.app.dev')
args = parser.parse_args()

def query(name, sql):
    result = subprocess.run([args.processor, str(args.run / 'trace.pftrace'), '-Q', sql], check=True, capture_output=True, text=True)
    (args.run / (name + '.csv')).write_text(result.stdout)
    (args.run / (name + '-query.log')).write_text(result.stderr)
    return list(csv.DictReader(io.StringIO(result.stdout)))

def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)

def stats(values):
    return {'n': len(values), 'p50_ms': percentile(values, .5), 'p95_ms': percentile(values, .95), 'max_ms': max(values) if values else None}

markers = query('markers', "SELECT s.ts, s.dur, s.name, t.name AS thread FROM slice s JOIN thread_track tt ON tt.id=s.track_id JOIN thread t ON t.utid=tt.utid WHERE s.name GLOB 'clisbot.*' ORDER BY s.ts")
frames = query('frames', f"SELECT a.ts, a.dur, a.jank_type, a.present_type, a.layer_name, a.surface_frame_token FROM actual_frame_timeline_slice a WHERE a.layer_name LIKE '%{args.package}%' ORDER BY a.ts")
query('slice-costs', f"SELECT s.name,t.name AS thread,COUNT(*) AS n,SUM(s.dur)/1e6 AS total_ms,MAX(s.dur)/1e6 AS max_ms FROM slice s JOIN thread_track tt ON tt.id=s.track_id JOIN thread t USING(utid) JOIN process p USING(upid) WHERE p.name='{args.package}' AND s.dur>0 GROUP BY s.name,t.name ORDER BY total_ms DESC LIMIT 100")
for marker in markers:
    marker['name'] = marker['name'].replace(' ', '|', 1)
input_markers = [m for m in markers if m['name'].startswith('clisbot.input.up|eventMs=')]
inputs = [int(m['ts']) for m in input_markers]
input_by_event = {int(float(m['name'].split('eventMs=')[1])): int(m['ts']) for m in input_markers}
commits = [m for m in markers if m['name'].startswith('clisbot.route.commit|')]
presses = [m for m in markers if m['name'].startswith('clisbot.tab.press|')]
latencies = []
for press in presses:
    ts = int(press['ts'])
    fields = dict(field.split('=', 1) for field in press['name'].split('|', 1)[1].split(';'))
    native_input = input_by_event.get(int(float(fields['eventMs'])))
    path = fields['path']
    commit = next((m for m in commits if int(m['ts']) >= ts and m['name'].endswith('path=' + path)), None)
    if native_input is None or commit is None:
        continue
    latencies.append({'path': path, 'input_ts': native_input, 'press_ts': ts, 'commit_ts': int(commit['ts']), 'input_to_press_ms': (ts-native_input)/1e6, 'input_to_route_commit_ms': (int(commit['ts'])-native_input)/1e6})
(args.run / 'latencies.json').write_text(json.dumps(latencies, indent=2)+'\n')
window_start = min(inputs) if inputs else 0
window_end = max(inputs)+2_500_000_000 if inputs else 0
sample_frames = [f for f in frames if window_start <= int(f['ts']) <= window_end]
gaps = []
for marker in markers:
    if marker['name'].startswith('clisbot.js.loop|gapMs=') and window_start <= int(marker['ts']) <= window_end:
        gaps.append(float(marker['name'].split('gapMs=')[1]))
summary = {'window_ns': [window_start,window_end], 'route_commit_latency': stats([m['input_to_route_commit_ms'] for m in latencies]), 'input_to_js_press': stats([m['input_to_press_ms'] for m in latencies]), 'native_frame_duration': stats([int(f['dur'])/1e6 for f in sample_frames]), 'native_jank': {'n': len(sample_frames), 'janky': sum(f['jank_type'] != 'None' for f in sample_frames)}, 'js_event_loop_gap': stats(gaps), 'js_gap_over_100ms': sum(g>100 for g in gaps), 'tap_to_first_visible_feedback': 'unavailable until video analysis', 'tap_to_usable_content': 'unavailable until target-specific content validation', 'react_per_component_commits': 'unavailable in release renderer'}
summary['native_jank'].update(app_deadline_missed=sum('App Deadline Missed' in f['jank_type'] for f in sample_frames), over_display_budget=sum(int(f['dur']) > 1e9/60 for f in sample_frames), types=dict(Counter(f['jank_type'] for f in sample_frames)))
(args.run / 'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
