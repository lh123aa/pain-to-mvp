import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest 配置（Task 1 · 脚手架）
// - 单元测试默认 node 环境；浏览器相关测试（FR-4 Web Worker 解析）后续按需加浏览器项目
// - 路径别名对齐 tsconfig 的 "@/*" -> "src/*"
// - 用 .mjs 扩展名避免 Vite CJS 加载 ESM 语法的 configLoader 警告
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "**/e2e/**"],
  },
});
