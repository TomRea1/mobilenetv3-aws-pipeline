
import os, tarfile, torch, torchvision, glob
from torch.utils.data import DataLoader
from torchvision.datasets import ImageFolder
from torchvision import transforms as T
from pathlib import Path

# sagemaker environment paths
# - training data
# - model we're training
# - where to put the trained model 
train_dir   = os.environ.get("SM_CHANNEL_TRAIN",  "/opt/ml/input/data/train")
model_in    = os.environ.get("SM_CHANNEL_MODEL",  "/opt/ml/input/data/model")  
model_out   = os.environ["SM_MODEL_DIR"]                                           

# Data
transform = T.Compose([
    T.Resize((224, 224)),
    T.ToTensor(),
])
dataset  = ImageFolder(train_dir, transform=transform)
# batch is 1 because i've only uploaded a few test images 
loader   = DataLoader(dataset, batch_size=1, shuffle=True, num_workers=2)

# Scrape the tar off the model
for archive in glob.glob(os.path.join(model_in, "*.tar.gz")):
    print(f"Extracting {archive}")
    with tarfile.open(archive, 'r:*') as tar:
        tar.extractall(model_in)

# build model architecture - thank you torchvision ! 
net = torchvision.models.mobilenet_v3_small(weights=None)




# Load-in previous model weights
checkpoint_pt = Path(model_in) / "model_state.pth"
if checkpoint_pt.exists():
    print(f"Loading checkpoint: {checkpoint_pt}")
    net.load_state_dict(torch.load(checkpoint_pt, map_location="cpu"))
else:
    print("Expected previous model.tar.gz but none found!")
    net.load_state_dict(
        torchvision.models.mobilenet_v3_small(
            weights=models.MobileNet_V3_Small_Weights.IMAGENET1k_V1
        ).state_dict()
    )

# 1 epoch - proof of concept
net.train()
optim= torch.optim.SGD(net.parameters(), lr=1e-4, momentum=0.9)
criterion = torch.nn.CrossEntropyLoss()

for epoch in range(1):             # minimal epoch for infra demo
    for imgs, labels in loader:
        optim.zero_grad()
        logits = net(imgs)
        loss= criterion(logits, labels)
        loss.backward()
        optim.step()

print("[INFO] Training loop finished")

# trace & save updated model
net.eval()
scripted = torch.jit.trace(net, torch.randn(1, 3, 224, 224))
os.makedirs(model_out, exist_ok=True)
pt_path = Path(model_out) / "mobilenetv3_traced.pt"
scripted.save(pt_path)
print(f"[INFO] Saved traced model to {pt_path}")

# package the model up into the .tar.gz format
tar_path = Path(model_out) / "model.tar.gz"
with tarfile.open(tar_path, "w:gz") as tar:
    tar.add(pt_path, arcname="mobilenetv3_traced.pt")
print(f"[INFO] Packaged new model artefact: {tar_path}")

