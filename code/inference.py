import torch
import io
import json
from PIL import Image
from torchvision import transforms

def model_fn(model_dir):
    model = torch.jit.load(f"{model_dir}/mobilenetv3_traced.pt")
    model.eval()
    return model

def input_fn(request_body, content_type='application/x-image'):
    if content_type == 'application/x-image':
        image = Image.open(io.BytesIO(request_body)).convert('RGB')
        transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406], 
                std=[0.229, 0.224, 0.225]
            )
        ])
        image = transform(image)
        return image.unsqueeze(0)
    else:
        raise Exception(f"Unsupported content type: {content_type}")

def predict_fn(input_data, model):
    with torch.no_grad():
        outputs = model(input_data)
    _, predicted = outputs.max(1)
    return predicted.item()

def output_fn(prediction, accept='application/json'):
    return json.dumps({'predicted_class': prediction})

