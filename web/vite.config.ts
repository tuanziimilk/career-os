import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署到 GitHub Pages 的子路径时，base 必须匹配仓库名。
// 本地 dev 时用 "/"，构建时用环境变量切换——和光影作品集的 pages:build 同一套做法。
/* ⚠️ 这里必须是**仓库名**，GitHub Pages 把项目站点挂在 /<repo>/ 下。
   2026-09-15 仓库从 career-web 改名成 career-os，这个值当时没跟着改 ——
   留着的话，哪天真开了 Pages，页面能打开但所有 JS/CSS 都 404，
   而本地 `npm run dev` 和 `vite preview` 全是好的（它们走 base="/"）。
   也就是说这个错**只在部署后才看得见**。 */
const base = process.env.GITHUB_PAGES ? "/career-os/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
