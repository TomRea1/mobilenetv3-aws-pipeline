import os, json, boto3

PIPELINE_NAME = os.environ["PIPELINE_NAME"]
sess = boto3.client("sagemaker")

def handler(event, context):
    print(json.dumps(event))
    # pull the S3 object key
    resp = sess.start_pipeline_execution(PipelineName=PIPELINE_NAME)
    print("Started:", resp["PipelineExecutionArn"])
    return {"ExecutionArn": resp["PipelineExecutionArn"]}

