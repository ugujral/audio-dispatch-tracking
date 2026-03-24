#!/usr/bin/env python3
"""
Wrapper script for faster-whisper transcription.
Usage: python3 scripts/transcribe.py <wav_file> [--model medium.en]
Prints transcription text to stdout.
"""
import sys
from faster_whisper import WhisperModel

# Bias Whisper toward police radio vocabulary instead of YouTube/podcast hallucinations
INITIAL_PROMPT = (
    "Police dispatch radio communication. "
    "Unit designators: Adam, Lincoln, Mary, David, Sam, Tom, King, Nora, Ocean, William. "
    "Codes: 211 robbery, 459 burglary, 415 disturbance, 245 ADW, 242 battery, 187 homicide, "
    "390 drunk, 484 theft, 5150 mental illness, Code 3 emergency, Code 4 no further. "
    "10-4 acknowledged, 10-97 arrived, 10-8 in service. "
    "Streets: Van Nuys, Sherman Way, Devonshire, Sepulveda, Victory, Ventura, Balboa, "
    "Reseda, Woodman, Laurel Canyon, Coldwater Canyon, Topanga Canyon."
)

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
    segments, _ = model.transcribe(
        wav_path,
        language="en",
        beam_size=5,
        initial_prompt=INITIAL_PROMPT,
        no_speech_threshold=0.6,
        log_prob_threshold=-1.0,
        condition_on_previous_text=False,
    )

    text = " ".join(segment.text.strip() for segment in segments)
    print(text)

if __name__ == "__main__":
    main()
