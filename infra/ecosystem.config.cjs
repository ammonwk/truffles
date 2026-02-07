module.exports = {
  apps: [
    {
      name: 'truffles-api',
      cwd: '/opt/truffles/apps/api',
      script: 'dist/index.js',
      env_file: '/opt/truffles/apps/api/.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '4G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
