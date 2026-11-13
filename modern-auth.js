const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const http = require('http');
const { URL } = require('url');

// The single OAuth flow for YouTube: loopback redirect, CSRF `state` and PKCE (S256).
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl'
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function page(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function statesMatch(expected, received) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(received || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Validates an OAuth redirect. Returns { code } on success or { error } with a
 * message that is safe to show (it is escaped by `page`).
 */
function parseCallback(url, expectedState) {
  if (!statesMatch(expectedState, url.searchParams.get('state'))) {
    return { error: 'Invalid or missing state parameter. Start the authorization again from the terminal.' };
  }
  const providerError = url.searchParams.get('error');
  if (providerError) return { error: `Authorization error: ${providerError}` };
  const code = url.searchParams.get('code');
  if (!code) return { error: 'The authorization response did not include a code.' };
  return { code };
}

class ModernAuth {
  constructor(options = {}) {
    const configDir = options.configDir || path.join(__dirname, 'config');
    this.credentialsPath = path.join(configDir, 'credentials.json');
    this.tokensPath = path.join(configDir, 'tokens.json');
    this.server = null;
    this.openBrowser = options.openBrowser !== false;
  }

  async buildAuthRequest(oauth2Client) {
    const state = crypto.randomBytes(32).toString('hex');
    const { codeVerifier, codeChallenge } = await oauth2Client.generateCodeVerifierAsync();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: YOUTUBE_SCOPES,
      prompt: 'consent',
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge
    });
    return { authUrl, state, codeVerifier };
  }

  async authenticate() {
    console.log(chalk.cyan.bold('\n🔐 YouTube Authentication'));
    console.log(chalk.gray('═'.repeat(60)));

    try {
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath));
      const redirect = this.resolveRedirect(credentials);
      const oauth2Client = new google.auth.OAuth2(
        credentials.youtube.client_id,
        credentials.youtube.client_secret,
        redirect.uri
      );

      const authResult = new Promise((resolve, reject) => {
        this.resolveAuth = resolve;
        this.rejectAuth = reject;
        this.authTimeout = setTimeout(() => {
          this.cleanup();
          reject(new Error('Authentication timeout (5 minutes)'));
        }, 300000);
      });

      const request = await this.buildAuthRequest(oauth2Client);
      await this.startTempServer(redirect, oauth2Client, request);

      console.log(chalk.cyan('🔗 Please visit this URL to authorize:'));
      console.log(chalk.blue(request.authUrl));
      if (this.openBrowser) this.open(request.authUrl);
      console.log(chalk.yellow(`\n⚡ A temporary server is running on port ${redirect.port}`));
      console.log(chalk.gray('Waiting for authorization...'));

      return authResult;
    } catch (error) {
      this.cleanup();
      console.error(chalk.red('Authentication failed:'), error.message);
      throw error;
    }
  }

  open(url) {
    // Best effort; spawn without a shell so the URL is never interpreted.
    const { spawn } = require('child_process');
    const commands = {
      win32: ['rundll32', ['url.dll,FileProtocolHandler', url]],
      darwin: ['open', [url]],
      linux: ['xdg-open', [url]]
    };
    const command = commands[process.platform];
    if (!command) return;
    try {
      spawn(command[0], command[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch (_error) {
      // The URL is printed above, so the user can open it manually.
    }
  }

  resolveRedirect(credentials) {
    const explicitRedirect = process.env.YOUTUBE_REDIRECT_URI;
    const configured = [explicitRedirect, ...(credentials.youtube?.redirect_uris || [])].filter(Boolean);
    const legacyGeneratedRedirect = /^http:\/\/localhost:8080\/(?:oauth2callback|callback)\/?$/i;
    let redirect = null;
    for (const value of configured) {
      if (!explicitRedirect && legacyGeneratedRedirect.test(value)) continue;
      try {
        const candidate = new URL(value);
        if (candidate.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(candidate.hostname)) {
          redirect = candidate;
          break;
        }
      } catch (_error) {
        // Ignore obsolete out-of-band and malformed redirect values.
      }
    }
    redirect ||= new URL('http://127.0.0.1/');
    if (!redirect.port) redirect.port = String(8000 + Math.floor(Math.random() * 1000));
    return {
      uri: redirect.toString(),
      hostname: redirect.hostname,
      port: Number(redirect.port),
      pathname: redirect.pathname || '/'
    };
  }

  saveTokens(tokens) {
    fs.mkdirSync(path.dirname(this.tokensPath), { recursive: true });
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(this.tokensPath));
    } catch (_error) {
      // First authorization.
    }
    fs.writeFileSync(this.tokensPath, JSON.stringify({ ...existing, youtube: tokens }, null, 2), { mode: 0o600 });
    fs.chmodSync(this.tokensPath, 0o600);
  }

  async startTempServer(redirect, oauth2Client, request) {
    let settled = false;
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirect.uri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('YouTube Automation Agent', 'Waiting for the OAuth callback.'));
        return;
      }
      if (settled) {
        res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Already handled', 'This authorization was already completed. You can close this window.'));
        return;
      }

      const result = parseCallback(url, request.state);
      if (result.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Authorization failed', result.error));
        // A forged request with a bad state must not cancel the real login.
        if (!url.searchParams.get('state') || !statesMatch(request.state, url.searchParams.get('state'))) return;
        settled = true;
        this.cleanup();
        this.rejectAuth(new Error(result.error));
        return;
      }

      settled = true;
      try {
        const { tokens } = await oauth2Client.getToken({ code: result.code, codeVerifier: request.codeVerifier });
        this.saveTokens(tokens);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Authentication successful', 'You can close this window and return to the terminal.'));
        console.log(chalk.green('\n✅ Authentication successful!'));
        this.cleanup();
        this.resolveAuth(tokens);
      } catch (tokenError) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Token exchange failed', tokenError.message));
        this.cleanup();
        this.rejectAuth(tokenError);
      }
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(redirect.port, redirect.hostname, resolve);
    });
    console.log(chalk.gray(`Temporary OAuth server started on ${redirect.uri}`));
  }

  cleanup() {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async testAuthentication() {
    try {
      const tokens = JSON.parse(fs.readFileSync(this.tokensPath));
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath));
      const oauth2Client = new google.auth.OAuth2(
        credentials.youtube.client_id,
        credentials.youtube.client_secret
      );
      oauth2Client.setCredentials(tokens.youtube);

      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const response = await youtube.channels.list({ part: 'snippet,statistics', mine: true });
      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        console.log(chalk.green(`✅ Connected to channel: ${channel.snippet.title}`));
        console.log(chalk.gray(`   Channel ID: ${channel.id}`));
        console.log(chalk.gray(`   Subscribers: ${channel.statistics?.subscriberCount || 'Hidden'}`));
        return true;
      }
      console.log(chalk.red('❌ No channel found'));
      return false;
    } catch (error) {
      console.error(chalk.red('Authentication test failed:'), error.message);
      return false;
    }
  }
}

async function runAuth() {
  const auth = new ModernAuth();
  try {
    await auth.authenticate();
    console.log(chalk.cyan('\n🧪 Testing authentication...'));
    const success = await auth.testAuthentication();
    if (success) {
      console.log(chalk.green.bold('\n🎉 Authentication Complete!'));
      console.log(chalk.yellow('\n📋 Next Steps:'));
      console.log(chalk.white('1. Run: npm start'));
      console.log(chalk.white('2. Visit: http://localhost:3456'));
    } else {
      console.log(chalk.red('\n❌ Authentication test failed.'));
    }
  } catch (error) {
    console.error(chalk.red('\nAuthentication failed:'), error.message);
    if (error.message.includes('timeout')) {
      console.log(chalk.yellow('\n💡 Try again - the authorization window might have closed.'));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runAuth();
}

module.exports = { ModernAuth, YOUTUBE_SCOPES, parseCallback, escapeHtml };
