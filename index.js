#!/usr/bin/env node

const aws4 = require('aws4');
const { URL } = require('url');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

// CLI Help text
const HELP_TEXT = `
aws4-cli - A CLI utility to sign curl-like URLs using Amazon's AWS Signature Version 4

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
  --sign-query              Sign the query string instead of adding Authorization header
  --output <FORMAT>         Output format: curl|headers|url (default: curl)
  -v, --verbose             Verbose output
  -h, --help               Show this help message

EXAMPLES:
  # Sign an S3 GET request
  aws4-cli https://my-bucket.s3.amazonaws.com/my-object

  # Sign a DynamoDB request with custom headers
  aws4-cli -X POST \\
    -H "Content-Type: application/x-amz-json-1.0" \\
    -H "X-Amz-Target: DynamoDB_20120810.ListTables" \\
    -d '{}' \\
    https://dynamodb.us-east-1.amazonaws.com/

  # Sign with custom credentials
  aws4-cli --access-key AKIAEXAMPLE --secret-key secretexample \\
    https://sqs.us-east-1.amazonaws.com/?Action=ListQueues

  # Sign using AWS profile (supports assume role, SSO, etc.)
  aws4-cli --profile my-profile \\
    https://sqs.us-east-1.amazonaws.com/?Action=ListQueues

  # Sign using assume role profile
  aws4-cli --profile cross-account-role \\
    https://s3.amazonaws.com/my-bucket/

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

class ArgumentParser {
  constructor() {
    this.args = process.argv.slice(2);
    this.options = {
      method: 'GET',
      headers: {},
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      profile: process.env.AWS_PROFILE,
      signQuery: false,
      output: 'curl',
      verbose: false
    };
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

        case '--sign-query':
          this.options.signQuery = true;
          break;

        case '--output':
          this.options.output = this.args[++i];
          break;

        case '-v':
        case '--verbose':
          this.options.verbose = true;
          break;

        default:
          if (arg.startsWith('-')) {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
          } else {
            if (this.url) {
              console.error('Multiple URLs provided. Only one URL is allowed.');
              process.exit(1);
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

    // S3 bucket hostname: bucket.s3.region.amazonaws.com or bucket.s3-region.amazonaws.com
    if (hostname.includes('.s3.') || hostname.includes('.s3-')) {
      return 's3';
    }

    // Standard service hostname: service.region.amazonaws.com
    if (parts.length >= 3 && parts[parts.length - 2] === 'amazonaws') {
      return parts[0];
    }

    // Default fallback
    return 's3';
  }

  extractRegionFromHost(hostname) {
    const parts = hostname.split('.');

    // S3 patterns: bucket.s3.region.amazonaws.com
    if (hostname.includes('.s3.') && parts.length >= 4) {
      const regionIndex = parts.findIndex(part => part === 's3') + 1;
      if (regionIndex < parts.length && parts[regionIndex] !== 'amazonaws') {
        return parts[regionIndex];
      }
    }

    // S3 alternative: bucket.s3-region.amazonaws.com
    if (hostname.includes('.s3-')) {
      const s3Part = parts.find(part => part.startsWith('s3-'));
      if (s3Part) {
        return s3Part.substring(3); // Remove 's3-' prefix
      }
    }

    // Standard pattern: service.region.amazonaws.com
    if (parts.length >= 3 && parts[parts.length - 2] === 'amazonaws') {
      return parts[1];
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

    if (this.options.signQuery) {
      this.requestOptions.signQuery = true;
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
      case 'headers':
        return this.formatHeaders(signedOptions);
      case 'url':
        return this.formatUrl(signedOptions);
      case 'curl':
      default:
        return this.formatCurl(signedOptions);
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
    return `${protocol}//${hostname}${path}`;
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
    }

    const signedOptions = await this.sign();
    const output = this.formatOutput(signedOptions);

    console.log(output);
  }
}

// Main execution
async function main() {
  const parser = new ArgumentParser();
  const { url, options } = parser.parse();

  const cli = new AWS4CLI(url, options);
  await cli.run();
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Error: ${reason}`);
  process.exit(1);
});

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}); 
