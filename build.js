const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Read .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    });
  }

  return env;
}

const env = loadEnv();
const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['assets/js/src/main.js'],
  bundle: true,
  minify: !isWatch,
  outfile: 'assets/js/main.min.js',
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || ''),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || ''),
    'process.env.TURNSTILE_SITE_KEY': JSON.stringify(env.TURNSTILE_SITE_KEY || ''),
  },
};

if (isWatch) {
  esbuild.context(buildOptions).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log('Build complete!');
  });
}
