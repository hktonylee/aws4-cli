const { spawn } = require('child_process');
const path = require('path');

// Helper function to run CLI command and capture output
function runCLI(args, env = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, '..', 'index.js');
    const child = spawn('node', [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

describe('AWS4 CLI Integration Tests', () => {
  const mockCredentials = {
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    AWS_REGION: 'us-east-1'
  };

  test('should show help when --help is passed', async () => {
    const result = await runCLI(['--help']);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('aws4-cli - A CLI utility to sign curl-like URLs');
    expect(result.stdout).toContain('USAGE:');
    expect(result.stdout).toContain('ARGUMENTS:');
    expect(result.stdout).toContain('OPTIONS:');
  });

  test('should generate presigned URL for S3 (default output)', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI([url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('https://my-bucket.s3.amazonaws.com/my-file.txt');
    expect(result.stdout).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(result.stdout).toContain('X-Amz-Credential=');
    expect(result.stdout).toContain('X-Amz-Date=');
    expect(result.stdout).toContain('X-Amz-Expires=');
    expect(result.stdout).toContain('X-Amz-SignedHeaders=');
    expect(result.stdout).toContain('X-Amz-Signature=');
  });

  test('should generate curl command for S3', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI(['--output', 'curl', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('curl -X GET');
    expect(result.stdout).toContain('-H "Authorization: AWS4-HMAC-SHA256');
    expect(result.stdout).toContain('-H "X-Amz-Date:');
    expect(result.stdout).toContain(url);
  });

  test('should generate headers only output', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI(['--output', 'headers', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Authorization: AWS4-HMAC-SHA256');
    expect(result.stdout).toContain('X-Amz-Date:');
    expect(result.stdout).not.toContain('curl');
  });

  test('should handle custom HTTP method', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI(['-X', 'PUT', '--output', 'curl', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('curl -X PUT');
  });

  test('should handle custom headers', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI([
      '-H', 'Content-Type: application/json',
      '-H', 'X-Custom-Header: test-value',
      '--output', 'curl',
      url
    ], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Content-Type: application/json');
    expect(result.stdout).toContain('X-Custom-Header: test-value');
  });

  test('should handle request body with POST', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI([
      '-X', 'POST',
      '-d', '{"key": "value"}',
      '--output', 'curl',
      url
    ], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('curl -X POST');
    expect(result.stdout).toContain('-d \'{"key": "value"}\'');
  });

  test('should handle DynamoDB service', async () => {
    const url = 'https://dynamodb.us-east-1.amazonaws.com/';
    const result = await runCLI([
      '-X', 'POST',
      '-H', 'Content-Type: application/x-amz-json-1.0',
      '-H', 'X-Amz-Target: DynamoDB_20120810.ListTables',
      '-d', '{}',
      '--output', 'curl',
      url
    ], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('curl -X POST');
    expect(result.stdout).toContain('Content-Type: application/x-amz-json-1.0');
    expect(result.stdout).toContain('X-Amz-Target: DynamoDB_20120810.ListTables');
    expect(result.stdout).toContain('dynamodb.us-east-1.amazonaws.com');
  });

  test('should handle custom region', async () => {
    const url = 'https://s3.amazonaws.com/my-bucket/my-file.txt';
    const result = await runCLI(['-r', 'eu-west-1', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('eu-west-1');
  });

  test('should handle custom expires time', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI(['--expires', '7200', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('X-Amz-Expires=7200');
  });

  test('should handle verbose output', async () => {
    const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
    const result = await runCLI(['-v', url], mockCredentials);
    
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Signing URL:');
    expect(result.stderr).toContain('Service: s3');
    expect(result.stderr).toContain('Region:');
  });

  test('should handle service auto-detection from URL', async () => {
    const testCases = [
      {
        url: 'https://sqs.us-west-2.amazonaws.com/',
        expectedService: 'sqs'
      },
      {
        url: 'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions',
        expectedService: 'lambda'
      },
      {
        url: 'https://ec2.amazonaws.com/',
        expectedService: 'ec2'
      }
    ];

    for (const testCase of testCases) {
      const result = await runCLI(['-v', '--output', 'headers', testCase.url], mockCredentials);
      expect(result.code).toBe(0);
    }
  });

  test('should handle region auto-detection from URL', async () => {
    const url = 'https://s3.eu-central-1.amazonaws.com/my-bucket/';
    const result = await runCLI(['-v', url], mockCredentials);
    
    expect(result.code).toBe(0);
  });

  describe('Error Handling', () => {
    test('should show error for missing URL', async () => {
      const result = await runCLI([]);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Error: URL is required');
    });

    test('should show error for invalid expires value', async () => {
      const result = await runCLI(['--expires', '999999', 'https://s3.amazonaws.com/test']);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--expires must be a number between 1 and 604800');
    });

    test('should show error for invalid output format', async () => {
      const result = await runCLI(['--output', 'invalid', 'https://s3.amazonaws.com/test']);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--output must be one of: url, curl, headers');
    });

    test('should show error for missing credentials', async () => {
      const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
      const result = await runCLI([url], {
        // Empty environment - no credentials
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined
      });
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Failed to resolve AWS credentials');
    });

    test('should show error for unknown option', async () => {
      const result = await runCLI(['--unknown-option', 'https://s3.amazonaws.com/test']);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Unknown option: --unknown-option');
    });

    test('should show error for multiple URLs', async () => {
      const result = await runCLI([
        'https://s3.amazonaws.com/bucket1',
        'https://s3.amazonaws.com/bucket2'
      ], mockCredentials);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Multiple URLs provided');
    });
  });

  describe('Different AWS Services', () => {
    test('should handle SQS service', async () => {
      const url = 'https://sqs.us-east-1.amazonaws.com/?Action=ListQueues';
      const result = await runCLI(['-v', '--output', 'curl', url], mockCredentials);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('sqs.us-east-1.amazonaws.com');
    });

    test('should handle Lambda service', async () => {
      const url = 'https://lambda.us-west-2.amazonaws.com/2015-03-31/functions';
      const result = await runCLI(['-v', '--output', 'headers', url], mockCredentials);
      
      expect(result.code).toBe(0);
    });

    test('should handle API Gateway service', async () => {
      const url = 'https://apigateway.us-east-1.amazonaws.com/restapis';
      const result = await runCLI(['-v', url], mockCredentials);
      
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('Service: apigateway');
    });
  });

  describe('Credential Sources', () => {
    test('should use command line credentials over environment', async () => {
      const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
      const result = await runCLI([
        '--access-key', 'AKIACMDLINEKEY',
        '--secret-key', 'cmdlinesecret',
        url
      ], {
        ...mockCredentials,
        AWS_ACCESS_KEY_ID: 'AKIAENVKEY',
        AWS_SECRET_ACCESS_KEY: 'envsecret'
      });
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('AKIACMDLINEKEY');
    });

    test('should handle session token', async () => {
      const url = 'https://my-bucket.s3.amazonaws.com/my-file.txt';
      const result = await runCLI([url], {
        ...mockCredentials,
        AWS_SESSION_TOKEN: 'FwoGZXIvYXdzEBUaDExampleSessionToken'
      });
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('X-Amz-Security-Token=');
    });
  });
}); 