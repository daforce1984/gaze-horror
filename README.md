# 응시 — THE GAZE

의자에 묶인 채 눈을 뜬 303호. 일어설 수 없고, 고개만 돌릴 수 있다.
방 어딘가에 나타나는 그 애를 **확대해서 응시**하면 벽에 단서가 떠오른다 — 하지만 오래 바라볼수록 공포가 차오른다.

**플레이:** https://daforce1984.github.io/gaze-horror/

- HTML5 + **WebGPU** (직접 작성한 포워드 렌더러: HDR·MSAA, 흔들리는 전구의 큐브 섀도맵, 버텍스 AO, 필름 그레인·색수차 포스트 프로세스)
- 방·소품·쓰레기 더미(리지드바디 시뮬레이션)·귀신 모델 전부 **Blender** 파이썬 스크립트로 생성 → GLB (`blender/build.py`)
- 텍스처/키아트: AI 이미지 생성
- 사운드: WebAudio 절차적 합성 (HRTF 입체음향 — 귀신의 위치를 소리로 찾을 수 있다)
- 모바일 세로/가로 모두 지원 (드래그로 둘러보기, 👁 버튼·두 손가락으로 확대)
- 플레이 타임 약 10분, 퍼즐 정답은 매 판 무작위

## 조작
| 동작 | PC | 모바일 |
|---|---|---|
| 둘러보기 | 드래그 / 방향키 | 드래그 |
| 확대(응시) | 우클릭 유지 / 휠 / Space | 👁 버튼 유지 / 두 손가락 |
| 살펴보기 | 클릭 / E | 탭 / 하단 버튼 |
| 메모 | M / Tab | 메모 버튼 |

## 개발
```bash
python3 -m http.server 8797          # 로컬 실행
blender -b --python blender/build.py -- all   # 3D 에셋 재생성 (Blender 5.x)
uv run --with pillow python tools/convert.py  # 이미지 → WebP
```
WebGPU 지원 브라우저(Chrome/Edge 113+, Android Chrome, Safari 26+)가 필요합니다.
