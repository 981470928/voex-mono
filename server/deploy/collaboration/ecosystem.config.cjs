const path = require('node:path');
const backend = path.resolve(__dirname, '../..');

module.exports = {
  apps: [{
    name: 'voex-collab',
    cwd: path.join(backend, 'collab'),
    script: 'dist/server.js',
    interpreter: process.env.VOEX_NODE_BINARY || '/usr/local/bin/node',
    node_args: ['--env-file=.env', '--max-old-space-size=384'],
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    restart_delay: 2000,
    kill_timeout: 30000,
    max_memory_restart: '512M',
    time: true,
    env: { NODE_ENV: 'production' },
  }],
};
