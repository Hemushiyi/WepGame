import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true, // 监听 0.0.0.0，局域网 / 内网穿透 / 远程可达
    port: 4173,
    open: false,
    // 允许通过向日葵 / DDNS 等远程域名访问（放开 Host 校验）
    // true = 允许任意 Host；如需更严格可改成数组：['187vs60765ih.vicp.fun']
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
