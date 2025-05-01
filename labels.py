# labels.py
def load_imagenet_labels(path="imagenet_classes.txt"):
    with open(path, "r") as f:
        return [line.strip() for line in f]

labels = load_imagenet_labels()

pred_idx = 718
print(labels[pred_idx]) 

