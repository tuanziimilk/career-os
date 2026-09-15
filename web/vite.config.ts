import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署到 GitHub Pages 的子路径时，base 必须匹配仓库名。
// 本地 dev 时用 "/"，构建时用环境变量切换——和光影作品集的 pages:build 同一套做法。
const base = process.env.GITHUB_PAGES ? "/career-web/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
