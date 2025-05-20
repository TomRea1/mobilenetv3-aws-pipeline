# mobilenetv3-aws-pipeline
ML pipeline for inference and auto training/deployment of fine tuned model. 

# Welcome to my pipeline for mobilenetv3 ! 

This is a project for hosting mobilenetv3 on the cloud with automated training on new data when added to the s3 bucket. Newly trained models are automatically deployed to the sagemaker endpoint via a lambda function. Inference on uploaded images is handled by API calls to the sagemaker endpoint. This project was built with the AWS CDK and TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

# How to deploy for yourself : 

Open up AWS Cloudshell and create a new directory for your project : $ `mkdir <project-name>-cdk && cd <project-name>-cdk`

Initialise your app inside your new directory : $ `cdk init app --language typescript`

- This will create some default files in your app directory - the bones of any cdk app. You can delete them and clone this repository inside your app instead.

Clone this repository : $ `git clone https://<this repo https>`

Now just `npx run build`, `cdk synth`, `cdk deploy` and you should be all set ! 

# Run Inference 

To run inference, 
- Upload a new image or images to the cdk app or to the s3 bucket.
- Run this command to invoke the SageMaker Endpoint :
- `aws sagemaker-runtime invoke-endpoint \
  --endpoint-name <your-endpoint-name> \
  --content-type image/jpeg \
  --body fileb://<your-image-name>.jpg \
  out.json && cat out.json
`
- You should hear back from the endpoint pretty quick.
- To convert the raw output to a label - run the label.py script : $ `python3 label.py`

# Train the Model 

To train the model simply upload new images to the S3 Bucket - easiest to do this through the AWS console. The model will automatically be trained on these new images and deployed when ready. 
If you want to check on its progress you can go to SageMaker on the AWS console, navigate to training jobs and you'll see pending next to the item on the top of the list. 

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
2e02b16 (COMMITTING FROM CLOUDSHELL - hope this works cause might jump out the third floor of the glucksman otherwise , sound)
