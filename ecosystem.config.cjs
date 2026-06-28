module.exports = {
  apps: [
    {
      name: "character-graph",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3005",
      cwd: __dirname,
      env: {
        NEXT_PUBLIC_BASE_PATH: "/character-graph",
        NODE_ENV: "production"
      }
    }
  ]
};
