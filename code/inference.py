import io, json, torch
from PIL import Image
from torchvision import transforms

# ---- load once per worker ----
def model_fn(model_dir):
    m = torch.jit.load(f"{model_dir}/mobilenetv3_traced.pt", map_location="cpu")
    m.eval()
    return m

# ---- request parsing ----
def input_fn(body, content_type="application/x-image"):
    if content_type in ("image/jpeg", "image/jpg", "image/png", "application/x-image"):
        img = Image.open(io.BytesIO(body)).convert("RGB")
        tfm = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]),
        ])
        x = tfm(img).unsqueeze(0)  # [1,3,224,224]
        return x
    elif content_type == "application/json":
        obj = json.loads(body)
        # expects {"instances": [[...]]} or {"inputs": [[...]]}
        key = "instances" if "instances" in obj else "inputs"
        return torch.tensor(obj[key])
    else:
        raise ValueError(f"Unsupported content type: {content_type}")

# ---- prediction ----
def predict_fn(inputs, model):
    with torch.inference_mode():
        logits = model(inputs)
        probs = torch.softmax(logits, dim=1)
    return probs  # tensor [1, num_classes]

# ---- response ----
def output_fn(pred, accept="application/json"):
    if accept not in ("application/json", "application/octet-stream"):
        raise ValueError(f"Unsupported accept: {accept}")
    arr = pred.detach().cpu().numpy().tolist()
    body = json.dumps({"probs": arr, "top1": int(pred.argmax(dim=1).item())})
    return body, "application/json"

