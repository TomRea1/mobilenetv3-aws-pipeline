import os
import boto3
from operator import itemgetter
import json

# env vars set by CDK
ENDPOINT_NAME   = os.environ["ENDPOINT_NAME"]
SM_ROLE_ARN     = os.environ["SM_ROLE_ARN"]
ASSET_BUCKET    = os.environ.get("ASSET_BUCKET", "cdk-hnb659fds-assets-564750642551-eu-north-1")
OUTPUT_PREFIX   = os.environ.get("OUTPUT_PREFIX", "output/")  # trailing slash OK

sm = boto3.client("sagemaker")
s3 = boto3.client("s3")

def handler(event, context):
    # list all model.tar.gz under the training-output prefix
    resp = s3.list_objects_v2(
        Bucket=ASSET_BUCKET,
        Prefix=OUTPUT_PREFIX
    )
    # filter down to only model.tar.gz files
    models = [
      obj for obj in resp.get("Contents", [])
      if obj["Key"].endswith("model.tar.gz")
    ]
    # error if no model where the model should be - this line will likely be run more than the others - I should have done arts :)
    if not models:
        raise RuntimeError(f"No model.tar.gz found under {OUTPUT_PREFIX}")

    # pick newest
    newest = max(models, key=itemgetter("LastModified"))["Key"]
    model_s3_uri = f"s3://{ASSET_BUCKET}/{newest}"
    print(f"Deploying model: {model_s3_uri}")

    # generate unique names
    timestamp = context.aws_request_id.split("-")[0]
    model_name       = f"CaptionModel-{timestamp}"
    endpoint_cfg_name= f"{model_name}-cfg"

    # make the SageMaker modle
    sm.create_model(
      ModelName=model_name,
      ExecutionRoleArn=SM_ROLE_ARN,
      PrimaryContainer={
        "Image": os.environ["INFERENCE_IMAGE"],
        "ModelDataUrl": model_s3_uri,
      },
      VpcConfig=json.loads(os.environ["VPC_CONFIG"]),
    )
    print(f"Created Model: {model_name}")

    # new EndpointConfig to point the endpoint at the newly trained model for infernce calls
    sm.create_endpoint_config(
      EndpointConfigName=endpoint_cfg_name,
      ProductionVariants=[{
        "VariantName": "AllTraffic",
        "ModelName":   model_name,
        "InstanceType":"ml.m5.xlarge",
        "InitialInstanceCount": 1
      }]
    )
    print(f"Created EndpointConfig: {endpoint_cfg_name}")

    # point the endpoint at the new config
    sm.update_endpoint(
      EndpointName=ENDPOINT_NAME,
      EndpointConfigName=endpoint_cfg_name
    )
    print(f"Updated endpoint {ENDPOINT_NAME} → config {endpoint_cfg_name}")

    return {"status": "deployed", "model": model_name, "endpoint": ENDPOINT_NAME}

