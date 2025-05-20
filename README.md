# mobilenetv3-aws-pipeline
ML pipeline for inference and auto training/deployment of fine tuned model. 

# Welcome to my pipeline for mobilenetv3 ! 

This is a project for hosting mobilenetv3 on the cloud with automated training on new data when added to the s3 bucket. Newly trained models are automatically deployed to the sagemaker endpoint via a lambda function. Inference on uploaded images is handled by API calls to the sagemaker endpoint. This project was built with the AWS CDK and TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
2e02b16 (COMMITTING FROM CLOUDSHELL - hope this works cause might jump out the third floor of the glucksman otherwise , sound)
