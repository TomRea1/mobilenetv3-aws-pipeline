

import sagemaker
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.steps import TrainingStep
from sagemaker.sklearn.processing import SKLearnProcessor
from sagemaker.estimator import Estimator

AWS_REGION = 'eu-west-1'
SM_EXEC_ROLE = "arn:aws:iam::708175751473:role/SageMakerExecRole"


sagemaker_session = sagemaker.session.Session()

# where to run , what to run on, which dependencies, where to put the output 
estimator = Estimator(
    image_uri=sagemaker.image_uris.retrieve(
    framework="pytorch", 
    region=sagemaker_session.boto_region_name, 
    version="1.12",
    image_scope="training",
    instance_type="ml.m5.large"
    ),
    role=SM_EXEC_ROLE,
    instance_count=1,
    instance_type="ml.m5.large",
    entry_point="train.py",
    source_dir=".",
    output_path="s3://cdk-hnb659fds-assets-708175751473-eu-west-1/output/",
)

training_step = TrainingStep(
    name="TrainStep",
    estimator=estimator,
    inputs={
        "train": sagemaker.inputs.TrainingInput(
            "s3://captionstack-ingestbucket2b3522fa-fdkl5cu2mskx/train-images/",
            content_type="application/x-image",
        ),
        "model" : sagemaker.inputs.TrainingInput(
            "s3://cdk-hnb659fds-assets-708175751473-eu-west-1/model//model.tar.gz",
            content_type="application/x-tar" 
        ),
    },
)
# which pipeline 
pipeline = Pipeline(
    name="CaptionModelPipeline",
    steps=[training_step],
)

pipeline.upsert(role_arn=SM_EXEC_ROLE)

