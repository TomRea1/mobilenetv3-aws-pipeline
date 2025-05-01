from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.steps import TrainingStep
from sagemaker.sklearn.processing import SKLearnProcessor
from sagemaker.estimator import Estimator
import sagemaker

role = "arn:aws:iam::564750642551:role/CaptionStackStack-SageMakerExecRole64AF80D2-JZZNSOLfvEen"

sagemaker_session = sagemaker.session.Session()


estimator = Estimator(
    image_uri=sagemaker.image_uris.retrieve(
    framework="pytorch", 
    region=sagemaker_session.boto_region_name, 
    version="1.12",
    image_scope="training",
    instance_type="ml.m5.xlarge"
    ),
    role=role,
    instance_count=1,
    instance_type="ml.m5.xlarge",
    entry_point="train.py",
    source_dir=".",
    output_path="s3://cdk-hnb659fds-assets-564750642551-eu-north-1/output/",
)

training_step = TrainingStep(
    name="TrainStep",
    estimator=estimator,
    inputs={
        "train": sagemaker.inputs.TrainingInput(
            "s3://cdk-hnb659fds-assets-564750642551-eu-north-1/train-images/",
            content_type="application/x-image",
        ),
    },
)

pipeline = Pipeline(
    name="CaptionModelPipeline",
    steps=[training_step],
)

pipeline.upsert(role_arn=role)

