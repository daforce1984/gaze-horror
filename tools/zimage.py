"""Z-Image Turbo stills on the local ComfyUI (text -> image). usage: zimage.py OUT.png WIDTH HEIGHT SEED "prompt"
Used for the modern TV programmes (16:9 first frames for tools/h3_tv.py) while the Codex image worker is down."""
import json, sys, time, urllib.request, urllib.parse
HOST = 'http://192.168.0.148:8188'


def graph(prompt, w, h, seed, prefix='horror/zimg'):
    return {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'z_image_turbo_bf16.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'lumina2'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'ae.safetensors'}},
        '4': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['1', 0], 'shift': 3.0}},
        '5': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['2', 0], 'text': prompt}},
        '6': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['5', 0]}},
        '7': {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': w, 'height': h, 'batch_size': 1}},
        '8': {'class_type': 'KSampler', 'inputs': {'model': ['4', 0], 'positive': ['5', 0], 'negative': ['6', 0], 'latent_image': ['7', 0],
                                                  'seed': seed, 'steps': 8, 'cfg': 1.0, 'sampler_name': 'res_multistep', 'scheduler': 'simple', 'denoise': 1.0}},
        '9': {'class_type': 'VAEDecode', 'inputs': {'samples': ['8', 0], 'vae': ['3', 0]}},
        '10': {'class_type': 'SaveImage', 'inputs': {'images': ['9', 0], 'filename_prefix': prefix}},
    }


def run(out, w, h, seed, prompt):
    pid = json.load(urllib.request.urlopen(urllib.request.Request(HOST + '/prompt', data=json.dumps({'prompt': graph(prompt, w, h, seed)}).encode(),
                                                                  headers={'Content-Type': 'application/json'})))['prompt_id']
    while True:
        time.sleep(3)
        hst = json.load(urllib.request.urlopen(HOST + '/history/' + pid)).get(pid)
        if not hst: continue
        if hst.get('status', {}).get('status_str') == 'error': raise SystemExit('FAILED ' + json.dumps(hst['status'])[:500])
        imgs = [i for o in hst.get('outputs', {}).values() for i in o.get('images', [])]
        if imgs:
            f = imgs[0]
            q = urllib.parse.urlencode({'filename': f['filename'], 'subfolder': f.get('subfolder', ''), 'type': f.get('type', 'output')})
            open(out, 'wb').write(urllib.request.urlopen(HOST + '/view?' + q).read())
            print('saved', out); return


if __name__ == '__main__':
    run(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
