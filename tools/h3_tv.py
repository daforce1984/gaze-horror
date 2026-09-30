"""MiniMax H3 (ComfyUI, normal FL2VA i2v) seamless TV loops: first frame = last frame = the still, the kids' song
as the audio guide. usage: h3_tv.py KEY  (KEY in JOBS) -> design/h3/KEY.mp4"""
import json, os, sys, time, subprocess, urllib.request, uuid, importlib.util
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
HOST = 'http://192.168.0.148:8188'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('bw', os.path.expanduser('~/.codex/skills/minimax-h3-lipsync/scripts/build_workflow.py'))
bw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bw)
SRC = '/mnt/d/_AI_GENERATED/______2026/codex_image_generator/output/'
ALIGN = ('Generate a video whose first and last frames match the given keyframe exactly, so it loops seamlessly. '
         'static camera, do not zoom or pan or rotate camera. ')
JOBS = {
 'kids': dict(img=SRC + 'horror_kids_show.png', start=4.0, prompt=ALIGN +
   'integrated_multimodal_description: A cheerful 1990s Korean children\'s TV show on a felt-craft set. (S1) the young woman host with a red and yellow '
   'hair bow rests her chin on her hands and sings the children\'s song along with the recording, lips synchronized to every syllable, gently swaying '
   'her head side to side and smiling; the rabbit puppet next to her bobs and waves its paw to the beat; the felt flowers sway slightly. '
   'At the end everyone settles back into exactly the starting pose. '
   'overall_soundscape: studio children\'s show, bright. non_diegetic_music: the provided children\'s song.'),
 'kids_bad': dict(img=SRC + 'horror_kids_show_bad.png', start=12.0, prompt=ALIGN +
   'integrated_multimodal_description: The same children\'s TV set, decayed and dim, torn felt and grime. The rabbit puppet moves in slow jerky '
   'bobs as if someone unseen works it, its head tilting too far and snapping back; far in the background a pale girl in a white nightgown with long '
   'black hair stands still, only her head slowly tilting and returning; a few torn felt leaves flutter. No one sings. '
   'At the end everything returns exactly to the starting pose. '
   'overall_soundscape: warped slow children\'s song, faint hiss. non_diegetic_music: the provided song, slowed and warped.'),
}
# the modern shows on her flat TV (16:9, muted in the game: the audio guide is only room tone)
TV = '/mnt/d/_AI_GENERATED/______2026/horror/design/tv/'
MOD = dict(w=640, h=352, tone=True)
JOBS.update({
 'mod_cook': dict(img=TV + 'cook.png', **MOD, prompt=ALIGN +
   'integrated_multimodal_description: A bright modern Korean cooking programme. The young woman chef stirs the steaming stew with the wooden spoon in slow circles, '
   'glances at the camera and smiles, steam rises gently from the pot, the vegetables stay on the board. At the end she is back exactly in the starting pose. '
   'overall_soundscape: quiet kitchen studio, soft simmering.'),
 'mod_music': dict(img=TV + 'music.png', **MOD, prompt=ALIGN +
   'integrated_multimodal_description: A Korean music show stage. The five girls dance a light synchronized choreography in place, arms and hips on the beat, '
   'the colored light beams sweep and the LED screens pulse, audience light sticks sway in the foreground. At the end they are back exactly in the starting pose. '
   'overall_soundscape: stage, cheering far away.'),
 'mod_nature': dict(img=TV + 'nature.png', **MOD, prompt=ALIGN +
   'integrated_multimodal_description: A calm underwater documentary shot. The whale shark glides slowly, its tail sweeping gently side to side, small fish dart around it, '
   'sun rays shimmer from the surface. At the end everything is exactly as in the starting frame. overall_soundscape: underwater, quiet.'),
 'mod_weather': dict(img=TV + 'weather.png', **MOD, prompt=ALIGN +
   'integrated_multimodal_description: A weather forecast. The smiling presenter talks to the camera, gestures once toward the map with an open hand and brings it back, '
   'small natural nods, the sun icon glows softly and the cloud icon drifts a little. At the end she is back exactly in the starting pose. '
   'overall_soundscape: quiet studio, a calm female voice.'),
})
FRAMES, W, H = 192, 512, 352

def up(path, kind):
    b = '----' + uuid.uuid4().hex
    name = os.path.basename(path)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + open(path, 'rb').read() + f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(HOST + '/upload/image', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + b})
    return json.load(urllib.request.urlopen(r))['name']

def main(key):
    j = JOBS[key]; out = os.path.join(ROOT, 'design', 'h3', key + '.mp4')
    tmp = os.path.join(ROOT, 'design', 'h3')
    # still -> exact canvas; audio -> exact duration cut of the song
    img = os.path.join(tmp, key + '_frame.png')
    w, h = j.get('w', W), j.get('h', H)
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', j['img'], '-vf', f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}', img], check=True)
    wav = os.path.join(tmp, key + '_guide.wav')
    af = 'atempo=0.8,asetrate=44100*0.9,aresample=44100' if key.endswith('bad') else 'anull'
    if j.get('tone'):   # quiet room tone (pink noise, -40 dB)
        subprocess.run([FF, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=0.01:duration={FRAMES / 24}', '-ac', '1', '-ar', '44100', wav], check=True)
    else:
        subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', str(j['start']), '-i', os.path.join(ROOT, 'assets', 'audio', 'song.mp3'), '-af', af, '-t', str(FRAMES / 24), '-ac', '1', '-ar', '44100', wav], check=True)
    iname, aname = up(img, 'image'), up(wav, 'audio')
    wf = bw.build_workflow(prompt=j['prompt'], first_name=iname, last_name=iname, audio_name=aname, frame_count=FRAMES, seed=1234,
                           filename_prefix='horror/h3_' + key, width=w, height=h, steps=20, adult=False)
    pid = json.load(urllib.request.urlopen(urllib.request.Request(HOST + '/prompt', data=json.dumps({'prompt': wf, 'client_id': 'horror-h3'}).encode(), headers={'Content-Type': 'application/json'})))['prompt_id']
    open(os.path.join(tmp, key + '.pid'), 'w').write(pid)
    print('submitted', key, pid, flush=True)
    t0 = time.time()
    while True:
        time.sleep(10)
        h = json.load(urllib.request.urlopen(HOST + '/history/' + pid)).get(pid)
        if not h: continue
        st = h.get('status', {})
        if st.get('status_str') == 'error': print('FAILED', key); return 1
        outs = [f for o in h.get('outputs', {}).values() for kind in ('images', 'videos', 'gifs', 'animated') for f in o.get(kind, [])]
        if outs:
            f = outs[0]
            url = f"{HOST}/view?filename={urllib.parse.quote(f['filename'])}&subfolder={urllib.parse.quote(f.get('subfolder',''))}&type={f.get('type','output')}"
            open(out, 'wb').write(urllib.request.urlopen(url).read())
            print('saved', out, os.path.getsize(out), int(time.time() - t0), 's'); return 0

import urllib.parse
if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))


def loopify(src, dst, xf=12):
    """drop the last xf frames and cross-fade them into the first xf: frame n-1 -> 0 becomes a normal step"""
    import imageio.v3 as iio, numpy as np
    fr = iio.imread(src, plugin='pyav') if False else iio.imread(src)
    n = len(fr) - xf
    out = [((fr[n + i].astype(np.float32) * (1 - i / xf) + fr[i].astype(np.float32) * (i / xf))).astype(np.uint8) if i < xf else fr[i] for i in range(n)]
    iio.imwrite(dst, np.stack(out), fps=24, codec='libx264', macro_block_size=16, output_params=['-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
    return len(out)
