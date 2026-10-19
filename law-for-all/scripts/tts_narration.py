#!/usr/bin/env python3
"""시연영상 내레이션 음성 생성 — sherpa-onnx(오프라인) 한국어 음성 모델로 장면별 WAV를 만든다.

  pip install sherpa-onnx soundfile
  # 모델: https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-mimic3-ko_KO-kss_low.tar.bz2
  python3 scripts/tts_narration.py 모델폴더 narration.json 출력폴더 [속도]

narration.json: [{"id": "s01", "text": "..."}] → 출력폴더/s01.wav 와 durations.json({"s01": 초})
영문·숫자는 발음이 부정확하므로 내레이션은 한글로만 쓴다.
"""
import json
import sys
from pathlib import Path

import sherpa_onnx
import soundfile as sf


def main() -> int:
    model_dir, script, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    onnx = next(model_dir.glob("*.onnx"))
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(onnx), tokens=str(model_dir / "tokens.txt"), data_dir=str(model_dir / "espeak-ng-data")),
            num_threads=4,
        ),
        max_num_sentences=2,
    )
    tts = sherpa_onnx.OfflineTts(cfg)
    out.mkdir(parents=True, exist_ok=True)
    durations = {}
    for item in json.loads(script.read_text(encoding="utf-8")):
        audio = tts.generate(item["text"], sid=0, speed=speed)
        sf.write(out / f"{item['id']}.wav", audio.samples, audio.sample_rate)
        durations[item["id"]] = round(len(audio.samples) / audio.sample_rate, 3)
        print(f"{item['id']}: {durations[item['id']]:.1f}초")
    (out / "durations.json").write_text(json.dumps(durations, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
