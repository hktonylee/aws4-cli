# aws4-cli

A small CLI utility to sign HTTP requests using Amazon's AWS Signature Version 4. Generate presigned URLs, curl commands with signed headers, or just the signed headers for any AWS API endpoint.

## Features

- 🔐 **Multiple Authentication Methods**: Environment variables, AWS profiles, SSO, assume roles, EC2/ECS metadata
- 🌐 **Multiple Output Formats**: Presigned URLs, complete curl commands, or just signed headers  
- 🎯 **Smart Service Detection**: Automatically detects AWS service and region from URL
- 📝 **Custom Headers & Methods**: Support for any HTTP method and custom headers
- 🔍 **Verbose Mode**: Detailed logging for debugging authentication and signing
- ⚡ **Query String Signing**: Option to sign query parameters instead of headers
- 🛠 **Comprehensive Error Handling**: Clear error messages and troubleshooting guidance

## Installation

### Global Installation (Recommended)

```bash
npm install -g aws4-cli
```

### Using npx (No Installation Required)

```bash
npx aws4-cli [options] <url>
```

### Requirements

- Node.js 14.0 or higher
- Valid AWS credentials (see [Authentication](#authentication) section)

## Usage

```bash
aws4-cli [OPTIONS] <URL>
```

### Basic Examples

```bash
# Generate a presigned URL for S3 object access
aws4-cli https://my-bucket.s3.amazonaws.com/my-object

# Get a complete curl command with signed headers
aws4-cli --output curl https://my-bucket.s3.amazonaws.com/my-object

# Sign a DynamoDB API request
aws4-cli --output curl \
  -X POST \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.ListTables" \
  -d '{}' \
  https://dynamodb.us-east-1.amazonaws.com/
```

## Authentication

aws4-cli supports all standard AWS credential sources, tried in this order:

1. **Command Line Arguments**
   ```bash
   aws4-cli --access-key AKIAEXAMPLE --secret-key secretexample <url>
   ```

2. **Environment Variables**
   ```bash
   export AWS_ACCESS_KEY_ID=AKIAEXAMPLE
   export AWS_SECRET_ACCESS_KEY=secretexample
   export AWS_SESSION_TOKEN=token  # Optional, for temporary credentials
   aws4-cli <url>
   ```

3. **AWS Profiles** (including assume role and SSO)
   ```bash
   aws4-cli --profile my-profile <url>
   ```

4. **EC2 Instance Metadata** (when running on EC2)

5. **ECS Task Metadata** (when running in ECS)

### AWS Profile Examples

```bash
# Regular profile
aws4-cli --profile default https://s3.amazonaws.com/my-bucket/

# Assume role profile
aws4-cli --profile cross-account-role https://s3.amazonaws.com/my-bucket/

# SSO profile
aws4-cli --profile sso-profile https://s3.amazonaws.com/my-bucket/
```

## Command Line Options

| Option | Short | Description | Default |
|--------|--------|-------------|---------|
| `--help` | `-h` | Show help message | |
| `--method <METHOD>` | `-X` | HTTP method | `GET` |
| `--header <HEADER>` | `-H` | Add custom header (repeatable) | |
| `--data <DATA>` | `-d` | Request body data | |
| `--service <SERVICE>` | `-s` | AWS service name | Auto-detected |
| `--region <REGION>` | `-r` | AWS region | `us-east-1` |
| `--access-key <KEY>` | | AWS Access Key ID | |
| `--secret-key <SECRET>` | | AWS Secret Access Key | |
| `--session-token <TOKEN>` | | AWS Session Token | |
| `--profile <PROFILE>` | | AWS profile name | |
| `--sign-query` | | Sign query string instead of headers | `false` |
| `--output <FORMAT>` | | Output format: `url`/`curl`/`headers` | `url` |
| `--verbose` | `-v` | Verbose output | `false` |

## Output Formats

### URL Format (Default)
Returns a presigned URL ready to use:
```bash
aws4-cli https://my-bucket.s3.amazonaws.com/my-object
# Output: https://my-bucket.s3.amazonaws.com/my-object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...
```

### Curl Format
Returns a complete curl command with signed headers:
```bash
aws4-cli --output curl https://my-bucket.s3.amazonaws.com/my-object
# Output: curl -X GET \
#   -H "Authorization: AWS4-HMAC-SHA256 Credential=..." \
#   -H "X-Amz-Date: 20231201T120000Z" \
#   "https://my-bucket.s3.amazonaws.com/my-object"
```

### Headers Format
Returns just the signed headers:
```bash
aws4-cli --output headers https://my-bucket.s3.amazonaws.com/my-object
# Output: Authorization: AWS4-HMAC-SHA256 Credential=...
#         X-Amz-Date: 20231201T120000Z
```

## AWS Service Examples

### Amazon S3
```bash
# Get object (presigned URL)
aws4-cli https://my-bucket.s3.amazonaws.com/path/to/object

# List bucket contents
aws4-cli --output curl https://my-bucket.s3.amazonaws.com/

# Upload object
aws4-cli --output curl -X PUT \
  -H "Content-Type: text/plain" \
  -d "Hello World" \
  https://my-bucket.s3.amazonaws.com/hello.txt
```

### Amazon DynamoDB
```bash
# List tables
aws4-cli --output curl -X POST \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.ListTables" \
  -d '{}' \
  https://dynamodb.us-east-1.amazonaws.com/

# Get item
aws4-cli --output curl -X POST \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.GetItem" \
  -d '{"TableName":"MyTable","Key":{"id":{"S":"123"}}}' \
  https://dynamodb.us-east-1.amazonaws.com/
```

### Amazon SQS
```bash
# List queues
aws4-cli https://sqs.us-east-1.amazonaws.com/?Action=ListQueues

# Send message
aws4-cli --output curl -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "Action=SendMessage&QueueUrl=https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue&MessageBody=Hello" \
  https://sqs.us-east-1.amazonaws.com/
```

### Amazon SNS
```bash
# List topics
aws4-cli https://sns.us-east-1.amazonaws.com/?Action=ListTopics

# Publish message
aws4-cli --output curl -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "Action=Publish&TopicArn=arn:aws:sns:us-east-1:123456789012:MyTopic&Message=Hello" \
  https://sns.us-east-1.amazonaws.com/
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key |
| `AWS_SESSION_TOKEN` | AWS Session Token (for temporary credentials) |
| `AWS_REGION` | Default AWS region |
| `AWS_PROFILE` | Default AWS profile name |
| `AWS_CONFIG_FILE` | AWS config file location |
| `AWS_SHARED_CREDENTIALS_FILE` | AWS credentials file location |

## Advanced Usage

### Query String Signing
Some AWS services support signing via query parameters instead of headers:
```bash
aws4-cli --sign-query https://my-bucket.s3.amazonaws.com/my-object
```

### Verbose Mode
Get detailed information about the signing process:
```bash
aws4-cli --verbose --profile my-profile https://s3.amazonaws.com/my-bucket/
```

### Multiple Headers
Add multiple custom headers:
```bash
aws4-cli -H "Content-Type: application/json" \
         -H "X-Custom-Header: value" \
         --output curl \
         https://my-api.execute-api.us-east-1.amazonaws.com/prod/endpoint
```

## Troubleshooting

### Common Issues

**"Failed to resolve AWS credentials"**
- Ensure your AWS credentials are configured properly
- Check that your profile exists in `~/.aws/credentials` or `~/.aws/config`
- Verify environment variables are set correctly
- For assume role profiles, ensure the source profile has valid credentials

**"Invalid header format"**
- Headers must be in format `"Name: Value"`
- Use quotes around headers containing spaces or special characters

**"Unknown option"**
- Check that all option names are spelled correctly
- Use `aws4-cli --help` to see all available options

### Getting Help

Use verbose mode to see detailed information about what the tool is doing:
```bash
aws4-cli --verbose --profile my-profile https://s3.amazonaws.com/my-bucket/
```

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## License

MIT License - see the LICENSE file for details.

## Author

Tony Lee <iamtonylee@gmail.com>
