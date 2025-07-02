#!/usr/bin/env node

const aws4 = require('aws4');
const { URL } = require('url');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

// CLI Help text
const HELP_TEXT = `
aws4-cli - A CLI utility to sign URLs using Amazon's AWS Signature Version 4

USAGE:
  aws4-cli [OPTIONS] <URL>

ARGUMENTS:
  <URL>                     The URL to sign (required)

OPTIONS:
  -X, --method <METHOD>     HTTP method (default: GET)
  -H, --header <HEADER>     Add custom header (can be used multiple times)
  -d, --data <DATA>         Request body data
  -s, --service <SERVICE>   AWS service name (auto-detected from URL if not provided)
  -r, --region <REGION>     AWS region (default: us-east-1)
  --access-key <KEY>        AWS Access Key ID (or use AWS_ACCESS_KEY_ID env var)
  --secret-key <SECRET>     AWS Secret Access Key (or use AWS_SECRET_ACCESS_KEY env var)
  --session-token <TOKEN>   AWS Session Token (or use AWS_SESSION_TOKEN env var)
  --profile <PROFILE>       AWS profile name (supports assume role, SSO, etc.)
  --expires <SECONDS>       Expiration time for presigned URLs in seconds (default: 3600, max: 604800)
  --sign-query              Force query string signing (automatically enabled for 'url' output)
  --output <FORMAT>         Output format: url|curl|headers (default: url)
                            - url: Presigned URL with query parameters (X-Amz-Algorithm, X-Amz-Credential, etc.)
                            - curl: Complete curl command with signed headers
                            - headers: Just the signed headers
  -v, --verbose             Verbose output
  -h, --help               Show this help message

EXAMPLES:
  # Generate presigned URL (default, expires in 1 hour)
  aws4-cli https://my-bucket.s3.amazonaws.com/my-object

  # Generate presigned URL with custom expiration (24 hours)
  aws4-cli --expires 86400 https://my-bucket.s3.amazonaws.com/my-object

  # Get a curl command with signed headers instead
  aws4-cli --output curl https://my-bucket.s3.amazonaws.com/my-object

  # Sign a DynamoDB request as curl command
  aws4-cli -X POST \\
    -H "Content-Type: application/x-amz-json-1.0" \\
    -H "X-Amz-Target: DynamoDB_20120810.ListTables" \\
    -d '{}' \\
    --output curl \\
    https://dynamodb.us-east-1.amazonaws.com/

  # Generate presigned URL with custom credentials
  aws4-cli --access-key AKIAEXAMPLE --secret-key secretexample \\
    --expires 7200 \\
    https://sqs.us-east-1.amazonaws.com/?Action=ListQueues

  # Generate presigned URL using AWS profile
  aws4-cli --profile my-profile --expires 3600 \\
    https://sqs.us-east-1.amazonaws.com/?Action=ListQueues

  # Generate presigned URL using assume role profile
  aws4-cli --profile cross-account-role --expires 1800 \\
    https://s3.amazonaws.com/my-bucket/

PRESIGNED URL QUERY PARAMETERS:
  When using 'url' output format, the following query parameters are automatically added:
  - X-Amz-Algorithm: AWS4-HMAC-SHA256
  - X-Amz-Credential: <access-key-id>/<date>/<region>/<service>/aws4_request
  - X-Amz-Date: ISO8601 timestamp
  - X-Amz-Expires: Expiration time in seconds
  - X-Amz-SignedHeaders: List of signed headers
  - X-Amz-Signature: Calculated signature
  - X-Amz-Security-Token: (if using temporary credentials)

ENVIRONMENT VARIABLES:
  AWS_ACCESS_KEY_ID         AWS Access Key ID
  AWS_SECRET_ACCESS_KEY     AWS Secret Access Key
  AWS_SESSION_TOKEN         AWS Session Token (optional)
  AWS_REGION               Default AWS region
  AWS_PROFILE              Default AWS profile name
  AWS_CONFIG_FILE          AWS config file location
  AWS_SHARED_CREDENTIALS_FILE  AWS credentials file location

SUPPORTED CREDENTIAL SOURCES:
  - Environment variables
  - AWS profiles (including assume role)
  - AWS SSO
  - EC2 instance metadata
  - ECS task metadata
  - Command line arguments
`;


const DEFAULT_OPTIONS = {
  method: 'GET',
  headers: {},
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
  profile: process.env.AWS_PROFILE,
  expires: 3600, // Default 1 hour
  signQuery: false,
  output: 'url',
  verbose: false
}


class ArgumentParser {
  constructor() {
    this.args = process.argv.slice(2);
    this.options = DEFAULT_OPTIONS;
    this.url = null;
  }

  parse() {
    let i = 0;
    while (i < this.args.length) {
      const arg = this.args[i];

      switch (arg) {
        case '-h':
        case '--help':
          console.log(HELP_TEXT);
          process.exit(0);
          break;

        case '-X':
        case '--method':
          this.options.method = this.args[++i];
          break;

        case '-H':
        case '--header':
          this.parseHeader(this.args[++i]);
          break;

        case '-d':
        case '--data':
          this.options.body = this.args[++i];
          break;

        case '-s':
        case '--service':
          this.options.service = this.args[++i];
          break;

        case '-r':
        case '--region':
          this.options.region = this.args[++i];
          break;

        case '--access-key':
          this.options.accessKeyId = this.args[++i];
          break;

        case '--secret-key':
          this.options.secretAccessKey = this.args[++i];
          break;

        case '--session-token':
          this.options.sessionToken = this.args[++i];
          break;

        case '--profile':
          this.options.profile = this.args[++i];
          break;

        case '--expires':
          const expires = parseInt(this.args[++i]);
          if (isNaN(expires) || expires < 1 || expires > 604800) {
            throw new Error('--expires must be a number between 1 and 604800 (7 days)');
          }
          this.options.expires = expires;
          break;

        case '--sign-query':
          this.options.signQuery = true;
          break;

        case '--output':
          this.options.output = this.args[++i];
          if (!['url', 'curl', 'headers'].includes(this.options.output)) {
            throw new Error('--output must be one of: url, curl, headers');
          }
          break;

        case '-v':
        case '--verbose':
          this.options.verbose = true;
          break;

        default:
          if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
          } else {
            if (this.url) {
              throw new Error('Multiple URLs provided. Only one URL is allowed.');
            }
            this.url = arg;
          }
      }
      i++;
    }

    if (!this.url) {
      console.error('Error: URL is required');
      console.log('\nRun "aws4-cli --help" for usage information.');
      process.exit(1);
    }

    return { url: this.url, options: this.options };
  }

  parseHeader(headerString) {
    const colonIndex = headerString.indexOf(':');
    if (colonIndex === -1) {
      console.error(`Invalid header format: ${headerString}. Expected format: "Name: Value"`);
      process.exit(1);
    }

    const name = headerString.slice(0, colonIndex).trim();
    const value = headerString.slice(colonIndex + 1).trim();
    this.options.headers[name] = value;
  }
}

class AWS4CLI {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.requestOptions = {};
  }

  parseUrl() {
    try {
      const parsedUrl = new URL(this.url);
      this.requestOptions.hostname = parsedUrl.hostname;
      this.requestOptions.path = parsedUrl.pathname + parsedUrl.search;
      this.requestOptions.protocol = parsedUrl.protocol;

      // Extract service from hostname if not provided
      this.requestOptions.service = this.options.service || this.extractServiceFromHost(parsedUrl.hostname);

      // Extract region from hostname if not explicitly set
      this.requestOptions.region = this.options.region || this.extractRegionFromHost(parsedUrl.hostname);

    } catch (error) {
      console.error(`Invalid URL: ${this.url}`);
      process.exit(1);
    }
  }

  extractServiceFromHost(hostname) {
    // Handle common AWS service patterns
    const parts = hostname.split('.');

    // Standard service hostname: service.region.amazonaws.com
    if (parts.length >= 3 && parts[parts.length - 2] === 'amazonaws') {
      return parts[parts.length - 4];
    }
    
    return null;
  }

  extractRegionFromHost(hostname) {
    const parts = hostname.split('.');

    // Standard pattern: service.region.amazonaws.com
    if (parts.length >= 3 && parts[parts.length - 2] === 'amazonaws') {
      return parts[parts.length - 3];
    }

    return null;
  }

  buildRequestOptions() {
    this.requestOptions.method = this.options.method;
    this.requestOptions.headers = { ...this.options.headers };

    if (this.options.body) {
      this.requestOptions.body = this.options.body;
      // Set POST method if body is provided and method wasn't explicitly set
      if (this.options.method === 'GET' && process.argv.indexOf('-X') === -1 && process.argv.indexOf('--method') === -1) {
        this.requestOptions.method = 'POST';
      }
    }

    // For presigned URLs (url output), always use query string signing
    if (this.options.output === 'url' || this.options.signQuery) {
      this.requestOptions.signQuery = true;
    }

    // Add expiration for presigned URLs
    if (this.requestOptions.signQuery) {
      // Calculate expiration timestamp
      const now = new Date();
      const expirationDate = new Date(now.getTime() + (this.options.expires * 1000));
      
      // Add X-Amz-Expires to the URL if not already present
      const url = new URL(this.url);
      if (!url.searchParams.has('X-Amz-Expires')) {
        url.searchParams.set('X-Amz-Expires', this.options.expires.toString());
        this.requestOptions.path = url.pathname + url.search;
      }
      
      if (this.options.verbose) {
        console.error(`Presigned URL will expire in ${this.options.expires} seconds (${expirationDate.toISOString()})`);
      }
    }
  }

  async resolveCredentials() {
    // If explicit credentials are provided via command line, use them
    if (this.options.accessKeyId && this.options.secretAccessKey) {
      const credentials = {
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey
      };

      if (this.options.sessionToken) {
        credentials.sessionToken = this.options.sessionToken;
      }

      if (this.options.verbose) {
        console.error('Using credentials from command line arguments');
      }

      return credentials;
    }

    // Use AWS SDK credential provider chain
    try {
      // Set up environment for AWS SDK
      const originalProfile = process.env.AWS_PROFILE;
      if (this.options.profile) {
        process.env.AWS_PROFILE = this.options.profile;
        if (this.options.verbose) {
          console.error(`Using AWS profile: ${this.options.profile}`);
        }
      }

      // Create credential provider with proper configuration
      const credentialProvider = fromNodeProviderChain({
        profile: this.options.profile,
        clientConfig: { region: this.requestOptions.region }
      });

      // Resolve credentials
      const credentials = await credentialProvider();

      // Restore original profile
      if (originalProfile !== undefined) {
        process.env.AWS_PROFILE = originalProfile;
      } else if (this.options.profile) {
        delete process.env.AWS_PROFILE;
      }

      if (this.options.verbose) {
        console.error(`Successfully resolved credentials using AWS SDK`);
        if (credentials.sessionToken) {
          console.error('Using temporary credentials (assumed role or session token)');
          console.error('Presigned URL will include X-Amz-Security-Token parameter');
        }
      }

      return {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      };

    } catch (error) {
      // Restore original profile on error
      const originalProfile = process.env.AWS_PROFILE;
      if (originalProfile !== undefined) {
        process.env.AWS_PROFILE = originalProfile;
      } else if (this.options.profile) {
        delete process.env.AWS_PROFILE;
      }

      console.error('Error: Failed to resolve AWS credentials.');
      console.error(`Details: ${error.message}`);
      console.error('\nPlease ensure you have configured your AWS credentials using one of:');
      console.error('  - AWS credentials file (~/.aws/credentials)');
      console.error('  - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
      console.error('  - Command line arguments (--access-key, --secret-key)');
      console.error('  - AWS SSO');
      console.error('  - EC2 instance profile');
      console.error('  - ECS task role');

      if (this.options.profile) {
        console.error(`\nMake sure the profile "${this.options.profile}" exists and is properly configured.`);
        console.error('For assume role profiles, ensure the role ARN and source profile are correct.');
      }

      process.exit(1);
    }
  }

  async sign() {
    const credentials = await this.resolveCredentials();

    try {
      const signedOptions = aws4.sign(this.requestOptions, credentials);
      return signedOptions;
    } catch (error) {
      console.error(`Error signing request: ${error.message}`);
      process.exit(1);
    }
  }

  formatOutput(signedOptions) {
    switch (this.options.output) {
      case 'curl':
        return this.formatCurl(signedOptions);
      case 'headers':
        return this.formatHeaders(signedOptions);
      case 'url':
      default:
        return this.formatUrl(signedOptions);
    }
  }

  formatHeaders(signedOptions) {
    let output = '';
    for (const [key, value] of Object.entries(signedOptions.headers || {})) {
      output += `${key}: ${value}\n`;
    }
    return output.trim();
  }

  formatUrl(signedOptions) {
    const protocol = signedOptions.protocol || 'https:';
    const hostname = signedOptions.hostname || signedOptions.host;
    const path = signedOptions.path || '/';
    const sessionToken = this.options.sessionToken || '';
    const url = `${protocol}//${hostname}${path}${sessionToken ? `&X-Amz-Security-Token=${sessionToken}` : ''}`;

    if (this.options.verbose && this.requestOptions.signQuery) {
      console.error('Generated presigned URL with query parameters:');
      const parsedUrl = new URL(url);
      const queryParams = [
        'X-Amz-Algorithm',
        'X-Amz-Credential', 
        'X-Amz-Date',
        'X-Amz-Expires',
        'X-Amz-SignedHeaders',
        'X-Amz-Security-Token',
        'X-Amz-Signature'
      ];
      
      queryParams.forEach(param => {
        if (parsedUrl.searchParams.has(param)) {
          console.error(`  ${param}: ${parsedUrl.searchParams.get(param)}`);
        }
      });
    }
    
    return url;
  }

  formatCurl(signedOptions) {
    const protocol = signedOptions.protocol || 'https:';
    const hostname = signedOptions.hostname || signedOptions.host;
    const path = signedOptions.path || '/';
    const url = `${protocol}//${hostname}${path}`;

    let curlCmd = `curl -X ${signedOptions.method || 'GET'}`;

    // Add headers
    for (const [key, value] of Object.entries(signedOptions.headers || {})) {
      curlCmd += ` \\\n  -H "${key}: ${value}"`;
    }

    // Add session token if present
    if (this.options.sessionToken) {
      curlCmd += ` \\\n  -H "x-amz-security-token: ${this.options.sessionToken}"`;
    }

    // Add body if present
    if (signedOptions.body) {
      curlCmd += ` \\\n  -d '${signedOptions.body}'`;
    }

    curlCmd += ` \\\n  "${url}"`;

    return curlCmd;
  }

  async run() {
    if (this.options.verbose) {
      console.error(`Signing URL: ${this.url}`);
      if (this.options.profile) {
        console.error(`Using AWS profile: ${this.options.profile}`);
      }
    }

    this.parseUrl();
    this.buildRequestOptions();

    if (this.options.verbose) {
      console.error(`Service: ${this.requestOptions.service}`);
      console.error(`Region: ${this.requestOptions.region}`);
      console.error(`Method: ${this.options.method}`);
      console.error(`Output format: ${this.options.output}`);
      if (this.requestOptions.signQuery) {
        console.error(`Generating presigned URL (query string signing enabled)`);
        console.error(`Expiration: ${this.options.expires} seconds`);
      }
    }

    const signedOptions = await this.sign();
    const output = this.formatOutput(signedOptions);

    console.log(output);
  }
}


// Export classes for testing only when in test environment
if (process.env.NODE_ENV === 'test' || typeof jest !== 'undefined') {
  global.ArgumentParser = ArgumentParser;
  global.AWS4CLI = AWS4CLI;
}

// Main execution
async function main() {
  try {
    const parser = new ArgumentParser();
    const { url, options } = parser.parse();

    const cli = new AWS4CLI(url, options);
    await cli.run();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}


if (process.env.NODE_ENV !== 'test') {
  main();

    // Handle uncaught errors gracefully
  process.on('uncaughtException', (error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`Error: ${reason}`);
    process.exit(1);
  });

} else {
  // Export classes for testing
  module.exports = {
    ArgumentParser,
    AWS4CLI,
    DEFAULT_OPTIONS,
  };
}
