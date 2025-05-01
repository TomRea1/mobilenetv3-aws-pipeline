import os, json, boto3

sess = boto3.client("sagemaker")
ROLE_ARN      = os.environ["SM_ROLE_ARN"]
ENDPOINT_NAME = os.environ["ENDPOINT_NAME"]

def handler(event, context):
    detail = event["detail"]
    artifacts = detail["outputParameters"]["ModelArtifacts"]["S3ModelArtifacts"]
    print("New model tar:", artifacts)

    model_name = f"mobnet-{detail['pipelineExecutionArn'].split('/')[-1][:8]}"
    sess.create_model(
        ModelName=model_name,
        ExecutionRoleArn=ROLE_ARN,
        PrimaryContainer={
            "Image": os.environ["INFERENCE_IMAGE"],
            "ModelDataUrl": artifacts,
        },
        VpcConfig=json.loads(os.environ["VPC_CONFIG"])
    )

    config_name = f"{model_name}-cfg"
    sess.create_endpoint_config(
        EndpointConfigName=config_name,
        ProductionVariants=[{
            "VariantName": "AllTraffic",
            "ModelName":   model_name,
            "InitialInstanceCount": 1,
            "InstanceType": "ml.m5.xlarge",
        }],
    )

    sess.update_endpoint(
        EndpointName=ENDPOINT_NAME,
        EndpointConfigName=config_name
    )
    return {"Model": model_name}

