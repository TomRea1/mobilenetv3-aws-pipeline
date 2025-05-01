import os
import torch
import torchvision.models as models
import torchvision.transforms as transforms
from torch.utils.data import DataLoader
from torchvision.datasets import ImageFolder

def main():
    input_data_dir = os.environ.get("SM_CHANNEL_TRAIN", "/opt/ml/input/data/train")
    model_dir = os.environ.get("SM_MODEL_DIR", "/opt/ml/model")

    print("Loading dataset from:", input_data_dir)
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
    ])
    dataset = ImageFolder(input_data_dir, transform=transform)
    dataloader = DataLoader(dataset, batch_size=8, shuffle=True)

    print("Loading pretrained model")
    model = models.resnet18(pretrained=True)

    print("Fine-tuning on batch")
    for inputs, labels in dataloader:
        outputs = model(inputs)
        break

    print("Saving model")
    os.makedirs(model_dir, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(model_dir, "model.pth"))

if __name__ == "__main__":
    main()

