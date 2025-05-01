from PIL import Image
import torch
from torchvision import transforms

img = Image.open('test.jpg').convert('RGB')

transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

img_tensor = transform(img)

print("Shape after transform:", img_tensor.shape)

img_tensor = img_tensor.unsqueeze(0)
print("Shape after unsqueeze:", img_tensor.shape)

