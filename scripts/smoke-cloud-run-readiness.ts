import { spawn } from 'node:child_process';

const port = Number(process.env.SMOKE_PORT ?? 18080);
const baseUrl = `http://127.0.0.1:${port}`;

async function main() {
  await run('npm', ['run', 'build']);

  const server = spawn('node', ['dist/src/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@127.0.0.1:5432/sv5tot_smoke',
      DEFAULT_SCHOOL_YEAR: process.env.DEFAULT_SCHOOL_YEAR ?? '2025-2026',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'smoke_access_secret_change_me',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'smoke_refresh_secret_change_me',
      JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? '120m',
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS ?? '12',
      SEED_DEFAULT_PASSWORD: process.env.SEED_DEFAULT_PASSWORD ?? 'Password@123',
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
      UPLOAD_DIR: process.env.UPLOAD_DIR ?? './uploads',
      MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB ?? '20',
      VNPT_MODE: process.env.VNPT_MODE ?? 'mock',
      VNPT_ENABLED: process.env.VNPT_ENABLED ?? 'false',
      VNPT_REQUIRE_REAL_IN_PIPELINE: process.env.VNPT_REQUIRE_REAL_IN_PIPELINE ?? 'false',
      VNPT_ALLOW_MOCK_RUNTIME: process.env.VNPT_ALLOW_MOCK_RUNTIME ?? 'true',
      SMARTBOT_MODE: process.env.SMARTBOT_MODE ?? 'mock',
      SMARTBOT_WEBHOOK_TOKEN: process.env.SMARTBOT_WEBHOOK_TOKEN ?? 'smoke_webhook_token',
      GEMINI_ENABLED: process.env.GEMINI_ENABLED ?? 'false',
      MAIL_ENABLED: process.env.MAIL_ENABLED ?? 'false',
      MAIL_PROVIDER: process.env.MAIL_PROVIDER ?? 'console',
      APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:5173',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      JOB_WORKER_ENABLED: process.env.JOB_WORKER_ENABLED ?? 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForHttp(`${baseUrl}/health`, 10_000);
    await expectOk('/health');
    await expectOk('/api/version');
    console.log(`Smoke readiness passed at ${baseUrl}`);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }

  if (server.exitCode && server.exitCode !== 0 && server.exitCode !== null) {
    throw new Error(`Server exited with code ${server.exitCode}\n${output}`);
  }
}

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
    child.on('error', reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for server');
}

async function expectOk(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
