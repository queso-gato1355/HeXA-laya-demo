# 실행 환경 노트

확인일: 2026-10-03

## PC (개발/시연)

| 항목 | 값 |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 (네이티브. WSL2 Ubuntu는 설치되어 있으나 사용 안 함) |
| CPU / RAM | AMD Ryzen 9 9950X3D 16C/32T, 64 GB |
| GPU | NVIDIA GeForce RTX 3090 24 GB (WDDM), 드라이버 591.86, `nvidia-smi` CUDA Version 13.1 |
| CUDA Toolkit / cuDNN (시스템) | 설치 안 됨 (`nvcc` 없음). 시스템은 건드리지 않았다 |
| Node / pnpm | Node v24.15.0, pnpm 11.3.0 |
| Python | 시스템 3.14.4. 전처리는 uv 관리 CPython **3.12.15** venv (`scripts/preprocess/.venv`) |
| uv | 0.12.22 (`python -m pip install --user uv`로 사용자 영역에 설치) |
| ffmpeg | 시스템 없음 → `imageio-ffmpeg` 번들 ffmpeg 7.1 (venv 안) 사용 |

### 전처리 (PyTorch)

- `torch 2.11.0+cu128`, `torchvision 0.26.0+cu128` — PyTorch cu128 휠이 CUDA 런타임과 cuDNN(9.19)을
  포함하므로 시스템 CUDA Toolkit이 필요 없다. 드라이버(CUDA 13.1)가 12.8 런타임보다 최신이라 호환.
- `torch.cuda.is_available() == True`, RTX 3090 인식.
- `torch.cuda.set_per_process_memory_fraction(0.6)` (`common.pick_device`)로 dev 서버와 GPU를 나눠 쓴다.
- 전처리 venv의 `onnxruntime 1.30.0`은 CPU 빌드 (SCDepthV3 256x320은 CPU로 270 프레임 ≈ 6 s라 충분).
- 한글 경로 주의: OpenCV `VideoCapture`/`imwrite`는 Windows에서 비 ASCII 경로를 못 여는 경우가 있어
  영상 입출력은 전부 ffmpeg 파이프로 처리한다. Ultralytics 설정 폴더도 한글 경로에서 쓰기 실패 →
  `scripts/preprocess/Ultralytics/`로 폴백(git 제외).

## onnxruntime-node 실행 프로바이더 (Laya)

`onnxruntime-node` 1.30.0 README의 사전 빌드 바이너리 표:

| EP | Windows x64 | Linux x64 | Linux arm64 |
| --- | --- | --- | --- |
| CPU | ✔ | ✔ | ✔ |
| DirectML (`dml`) | ✔ | ✘ | ✘ |
| WebGPU (`webgpu`, 실험적) | ✔ | ✔ | ✘ |
| CUDA (`cuda`, CUDA 12) | ✘ | ✔ | ✘ |

- 예상은 "Windows 네이티브 → `dml`"이었으나 **실제 확인 결과 DML은 이 모델에서 동작하지 않는다.**
  세션은 만들어지지만 첫 `run`에서 `Reshape node 'node_view' ... DmlExecutionProvider ... 80070057`
  (`graphOptimizationLevel` basic/disabled, `enableMemPattern:false` 모두 동일)로 실패한다.
- **`webgpu`는 동작한다** (결과가 CPU와 소수 4자리까지 동일). 따라서 이 PC의 `LAYA_EP=auto` 순서는
  `["webgpu", "dml", "cpu"]`이고, 각 GPU EP는 로드 후 프로브 호출 1회를 통과해야 채택된다
  (`laya-service/src/laya.ts`). 실패 시 CPU 폴백 + 경고 로그 + UI 배지 "Laya: CPU (GPU 실패 → CPU 폴백)".
- WebGPU 주의: 조용한 상태의 벤치에선 기준 1개 p50 70 ms지만, 브라우저가 대시보드(영상 3개)를
  그리는 중에는 GPU를 공유해서 호출당 250–600 ms로 느려지고 들쭉날쭉하다 (같은 조건에서 CPU INT8은
  105–280 ms). 또 입력 길이가 새로 나올 때마다 셰이더 컴파일로 첫 호출이 0.5–6 s 걸린다.
  시연 중 지연이 더 안정적이어야 하면 `LAYA_EP=cpu` (fp32, 호출당 ~170–230 ms)를 고려.
  INT8 번들은 빠르지만 정확도 검사 실패라 쓰지 않는다 (docs/quant-eval.md).
- CUDA EP는 Linux x64 전용. WSL2 Linux에서 돌리면 가능하지만 CUDA 12 + cuDNN 9 런타임 설치가
  필요하다 → 시스템 변경이라 하지 않았다. 필요하면: WSL2 Ubuntu에
  `cuda-toolkit-12-x` + `libcudnn9-cuda-12` 설치 후 WSL 쪽에서 `pnpm install` (onnxruntime-node
  postinstall이 CUDA EP 바이너리를 받음) → `LAYA_EP=cuda`.
- `@receptron/laya` 0.1.2 (MIT): `Laya.load({ modelDir, executionProviders, sessionOptions })`,
  `systemOne(state, questions)`. 의존성 `onnxruntime-node ^1.22.0`, `@huggingface/tokenizers ^0.2.0`, Node ≥ 20.
  `modelDir`를 주면 다운로드 경로는 전혀 타지 않는다.

## Raspberry Pi 5 (타깃 로버 브레인)

- Pi OS 64-bit = linux-arm64. `onnxruntime-node` 사전 빌드에 **Linux arm64 CPU EP가 포함**되어 있어
  `laya-service`는 Pi에서 `pnpm install` 만으로 동작한다 (GPU EP 없음 → CPU, 스레드 4).
- `@huggingface/tokenizers` 0.2.0은 순수 JS(네이티브/WASM 바이너리 없음)라 아키텍처 무관.
- Hailo-8(AI HAT+ 26 TOPS)은 인식(YOLO11n, SCDepthV3) 전용. Laya는 Pi CPU에서 돈다 (docs/hailo-port.md).
