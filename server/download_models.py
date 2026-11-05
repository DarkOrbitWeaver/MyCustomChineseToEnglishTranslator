"""LiveSubs ASR Model Downloader:
Downloads and caches Qwen3-ASR and ForcedAligner models locally using huggingface_hub.
Usage:
  python download_models.py [--model Qwen/Qwen3-ASR-0.6B] [--aligner Qwen/Qwen3-ForcedAligner-0.6B]
"""
import sys
import argparse
from huggingface_hub import snapshot_download

DEFAULT_ASR = "Qwen/Qwen3-ASR-0.6B"
DEFAULT_ALIGN = "Qwen/Qwen3-ForcedAligner-0.6B"

def download_models(asr_model=DEFAULT_ASR, align_model=DEFAULT_ALIGN):
    print(f"[LiveSubs] Ensuring ASR model is downloaded: {asr_model}")
    try:
        asr_path = snapshot_download(repo_id=asr_model)
        print(f"[LiveSubs] ASR model cached at: {asr_path}")
    except Exception as e:
        print(f"[!] Failed to download ASR model {asr_model}: {e}", file=sys.stderr)
        return False

    print(f"[LiveSubs] Ensuring ForcedAligner model is downloaded: {align_model}")
    try:
        align_path = snapshot_download(repo_id=align_model)
        print(f"[LiveSubs] ForcedAligner cached at: {align_path}")
    except Exception as e:
        print(f"[!] Failed to download ForcedAligner {align_model}: {e}", file=sys.stderr)
        return False

    print("[LiveSubs] Both models are cached and ready for local inference.")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download LiveSubs ASR and Aligner models.")
    parser.add_argument("--model", default=DEFAULT_ASR, help=f"ASR model repo (default: {DEFAULT_ASR})")
    parser.add_argument("--aligner", default=DEFAULT_ALIGN, help=f"Aligner model repo (default: {DEFAULT_ALIGN})")
    args = parser.parse_args()

    success = download_models(args.model, args.aligner)
    if not success:
        sys.exit(1)
