const PORTS = { api: 8790, devUi: 8791 };
module.exports = {
  PORTS,
  apps: [
    {
      name: "fly-garden",
      script: "server/index.js",
      node_args: ["--env-file-if-exists=.env"],
      cwd: __dirname,
      env: { PORT: PORTS.api, NODE_ENV: "production" },
      autorestart: true,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      max_restarts: 5,
      restart_delay: 2000,
      time: true,
    },
  ],
};
