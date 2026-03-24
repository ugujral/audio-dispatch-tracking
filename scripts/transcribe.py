#!/usr/bin/env python3
"""
Wrapper script for faster-whisper transcription.
Usage: python3 scripts/transcribe.py <wav_file> [--model medium.en]
Prints transcription text to stdout.
"""
import sys
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 transcribe.py <wav_file> [--model medium.en]", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]
    model_name = "medium.en"

    # Parse --model arg
    for i, arg in enumerate(sys.argv):
        if arg == "--model" and i + 1 < len(sys.argv):
            model_name = sys.argv[i + 1]

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(wav_path, language="en", beam_size=5)

    text = " ".join(segment.text.strip() for segment in segments)
    print(text)

if __name__ == "__main__":
    main()
