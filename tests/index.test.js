const aws4 = require('aws4');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { ArgumentParser, AWS4CLI, DEFAULT_OPTIONS } = require('../src/index.js');

// Mock the AWS dependencies
jest.mock('aws4');
jest.mock('@aws-sdk/credential-providers');

// Import the classes from the main file
// Since index.js is a CLI script, we need to require it in a way that doesn't execute main()
const originalArgv = process.argv;
const originalExit = process.exit;

// Mock process.exit to prevent actual exits during tests
process.exit = jest.fn();

describe('AWS4 CLI', () => {
  beforeAll(() => {
    // Prevent the main function from running during require
    process.argv = ['node', 'src/index.js'];
    
    // Mock console methods to avoid noisy test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Require the module after setting up mocks
    // const indexModule = require('src/index.js');
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Reset environment variables
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_REGION;
    delete process.env.AWS_PROFILE;
    
    // Mock credential provider
    const mockCredentialProvider = jest.fn().mockResolvedValue({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: undefined
    });
    
    fromNodeProviderChain.mockReturnValue(mockCredentialProvider);
    
    // Mock aws4.sign to return a predictable signed request
    aws4.sign.mockImplementation((options, credentials) => {
      return {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20231201/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=example-signature',
          'X-Amz-Date': '20231201T120000Z'
        }
      };
    });
  });

  afterAll(() => {
    // Restore original functions
    process.argv = originalArgv;
    process.exit = originalExit;
    
    // Restore console methods
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe('ArgumentParser', () => {
    test('should parse basic URL argument', () => {
      process.argv = ['node', 'index.js', 'https://s3.amazonaws.com/my-bucket/my-file.txt'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(url).toBe('https://s3.amazonaws.com/my-bucket/my-file.txt');
      expect(options.method).toBe('GET');
      expect(options.output).toBe('url');
    });

    test('should parse method option', () => {
      process.argv = ['node', 'index.js', '-X', 'POST', 'https://s3.amazonaws.com/my-bucket/'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.method).toBe('POST');
    });

    test('should parse headers', () => {
      process.argv = ['node', 'index.js', '-H', 'Content-Type: application/json', 'https://s3.amazonaws.com/my-bucket/'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    test('should parse output format', () => {
      process.argv = ['node', 'index.js', '--output', 'curl', 'https://s3.amazonaws.com/my-bucket/'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.output).toBe('curl');
    });

    test('should parse region', () => {
      process.argv = ['node', 'index.js', '-r', 'eu-west-1', 'https://s3.amazonaws.com/my-bucket/'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.region).toBe('eu-west-1');
    });
  });

  describe('AWS4CLI', () => {
    test('should create instance with URL and options', () => {
      const url = 'https://s3.amazonaws.com/my-bucket/my-file.txt';
      const options = { method: 'GET', output: 'url' };
      
      const cli = new AWS4CLI(url, options);
      
      expect(cli.url).toBe(url);
      expect(cli.options).toEqual(expect.objectContaining(options));
    });

    test('should extract service from S3 URL', () => {
      const url = 'https://my-bucket.s3.ap-northeast-2.amazonaws.com/my-file.txt';
      const cli = new AWS4CLI(url, {});
      
      const service = cli.extractServiceFromHost('my-bucket.s3.ap-northeast-2.amazonaws.com');
      
      expect(service).toBe('s3');
    });

    test('should extract service from DynamoDB URL', () => {
      const url = 'https://dynamodb.us-east-1.amazonaws.com/';
      const cli = new AWS4CLI(url, {});
      
      const service = cli.extractServiceFromHost('dynamodb.us-east-1.amazonaws.com');
      
      expect(service).toBe('dynamodb');
    });

    test('should extract region from hostname', () => {
      const url = 'https://s3.eu-west-1.amazonaws.com/my-bucket/';
      const cli = new AWS4CLI(url, {});
      
      const region = cli.extractRegionFromHost('s3.eu-west-1.amazonaws.com');
      
      expect(region).toBe('eu-west-1');
    });

    test('should resolve credentials using environment variables', async () => {
      // Set up environment variables
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
      process.env.AWS_SECRET_ACCESS_KEY = 'secrettest';
      
      const cli = new AWS4CLI('https://s3.amazonaws.com/test', {
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secrettest'
      });
      
      const credentials = await cli.resolveCredentials();
      
      expect(credentials.accessKeyId).toBe('AKIATEST');
      expect(credentials.secretAccessKey).toBe('secrettest');
    });

    test('should resolve credentials with session token', async () => {
      // Mock temporary credentials
      const mockCredentialProvider = jest.fn().mockResolvedValue({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'IQoJb3JpZ2luX2VjEG0aCXVzLWVhc3QsExample'
      });
      
      fromNodeProviderChain.mockReturnValue(mockCredentialProvider);
      
      const cli = new AWS4CLI('https://s3.amazonaws.com/test', {});
      
      const credentials = await cli.resolveCredentials();
      
      expect(credentials.sessionToken).toBe('IQoJb3JpZ2luX2VjEG0aCXVzLWVhc3QsExample');
    });

    test('should sign request and return signed options', async () => {
      const cli = new AWS4CLI('https://s3.amazonaws.com/test-bucket/test-file.txt', {});
      
      const signedOptions = await cli.sign();
      
      expect(aws4.sign).toHaveBeenCalled();
      expect(signedOptions.headers['Authorization']).toContain('AWS4-HMAC-SHA256');
      expect(signedOptions.headers['X-Amz-Date']).toBeTruthy();
    });

    test('should format output as URL', async () => {
      const cli = new AWS4CLI('https://s3.amazonaws.com/test-bucket/test-file.txt', {
        ...DEFAULT_OPTIONS,
        output: 'url'
      });
      
      // Mock aws4.sign to return presigned URL format
      aws4.sign.mockImplementation((options, credentials) => {
        return {
          ...options,
          path: '/test-bucket/test-file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20231201%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20231201T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=example-signature'
        };
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(output).toContain('X-Amz-Signature=example-signature');
    });

    test('should format output as curl command', async () => {
      const cli = new AWS4CLI('https://s3.amazonaws.com/test-bucket/test-file.txt', {
        output: 'curl',
        method: 'GET'
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('curl -X GET');
      expect(output).toContain('-H "Authorization:');
      expect(output).toContain('-H "X-Amz-Date:');
      expect(output).toContain('https://s3.amazonaws.com/test-bucket/test-file.txt');
    });

    test('should format output as headers only', async () => {
      const cli = new AWS4CLI('https://s3.amazonaws.com/test-bucket/', {
        output: 'headers'
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('Authorization: AWS4-HMAC-SHA256');
      expect(output).toContain('X-Amz-Date: 20231201T120000Z');
    });

    test('should handle DynamoDB requests', async () => {
      const cli = new AWS4CLI('https://dynamodb.us-east-1.amazonaws.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.0',
          'X-Amz-Target': 'DynamoDB_20120810.ListTables'
        },
        body: '{}',
        output: 'curl'
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('curl -X POST');
      expect(output).toContain('Content-Type: application/x-amz-json-1.0');
      expect(output).toContain('X-Amz-Target: DynamoDB_20120810.ListTables');
      expect(output).toContain('-d \'{}\'');
    });

    test('should handle custom expires parameter', () => {
      process.argv = ['node', 'index.js', '--expires', '7200', 'https://s3.amazonaws.com/test'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.expires).toBe(7200);
    });

    test('should handle profile parameter', () => {
      process.argv = ['node', 'index.js', '--profile', 'my-profile', 'https://s3.amazonaws.com/test'];
      
      const parser = new ArgumentParser();
      const { url, options } = parser.parse();
      
      expect(options.profile).toBe('my-profile');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid expires value', () => {
      process.argv = ['node', 'index.js', '--expires', '999999', 'https://s3.amazonaws.com/test'];
      
      const parser = new ArgumentParser();
      
      expect(() => parser.parse()).toThrow();
    });

    test('should handle invalid output format', () => {
      process.argv = ['node', 'index.js', '--output', 'invalid', 'https://s3.amazonaws.com/test'];
      
      const parser = new ArgumentParser();
      
      expect(() => parser.parse()).toThrow();
    });

    test('should handle credential resolution errors', async () => {
      // Mock credential provider to reject
      const mockCredentialProvider = jest.fn().mockRejectedValue(new Error('No credentials found'));
      fromNodeProviderChain.mockReturnValue(mockCredentialProvider);
      
      const cli = new AWS4CLI('https://s3.amazonaws.com/test', {});
      
      await cli.resolveCredentials();
      
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('Integration Tests', () => {
    test('should handle a complete S3 presigned URL workflow', async () => {
      const cli = new AWS4CLI('https://my-bucket.s3.us-west-2.amazonaws.com/my-file.txt', {
        expires: 3600,
        output: 'url'
      });
      
      // Mock aws4.sign for presigned URL
      aws4.sign.mockImplementation((options, credentials) => {
        return {
          ...options,
          path: '/my-file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20231201%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20231201T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=example-signature'
        };
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      
      expect(cli.requestOptions.service).toBe('s3');
      expect(cli.requestOptions.region).toBe('us-west-2');
      expect(cli.requestOptions.signQuery).toBe(true);
      
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('https://my-bucket.s3.us-west-2.amazonaws.com/my-file.txt');
      expect(output).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(output).toContain('X-Amz-Expires=3600');
    });

    test('should handle a complete API Gateway presigned URL', async () => {
      const cli = new AWS4CLI('https://yzzb1hgbpa.execute-api.ap-northeast-2.amazonaws.com/my-file.txt', {
        expires: 3600,
        output: 'url'
      });
      
      // Mock aws4.sign for presigned URL
      aws4.sign.mockImplementation((options, credentials) => {
        return {
          ...options,
          path: '/my-file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20231201%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20231201T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=example-signature'
        };
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      
      expect(cli.requestOptions.service).toBe('execute-api');
      expect(cli.requestOptions.region).toBe('ap-northeast-2');
      expect(cli.requestOptions.signQuery).toBe(true);
      
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('https://yzzb1hgbpa.execute-api.ap-northeast-2.amazonaws.com/my-file.txt?');
      expect(output).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(output).toContain('X-Amz-Expires=3600');
    });

    test('should handle a complete DynamoDB request workflow', async () => {
      const cli = new AWS4CLI('https://dynamodb.us-west-2.amazonaws.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.0',
          'X-Amz-Target': 'DynamoDB_20120810.ListTables'
        },
        body: '{}',
        region: 'us-west-2',
        output: 'curl'
      });
      
      cli.parseUrl();
      cli.buildRequestOptions();
      
      expect(cli.requestOptions.service).toBe('dynamodb');
      expect(cli.requestOptions.region).toBe('us-west-2');
      expect(cli.requestOptions.method).toBe('POST');
      
      const signedOptions = await cli.sign();
      const output = cli.formatOutput(signedOptions);
      
      expect(output).toContain('curl -X POST');
      expect(output).toContain('dynamodb.us-west-2.amazonaws.com');
      expect(output).toContain('Content-Type: application/x-amz-json-1.0');
    });
  });
}); 