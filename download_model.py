from huggingface_hub import snapshot_download

snapshot_download(repo_id="timm/mobilenetv3_small_100.lamb_in1k", local_dir="mobilenetv3_model")
