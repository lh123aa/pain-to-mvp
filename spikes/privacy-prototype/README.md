# W0-A2 隐私验证最小原型 · 占位

> 方案 Task 2 W0-A2（2026-10-18 挂账）：此原型即 M1 解析骨架雏形，不写废弃代码。
> 状态：**未开工**（W0-A1 优先推进；A2 待 A1 出结论后与 M1 骨架合并）

## 范围（PRD AC-1.8 断网 + AC-4.9 抓包）

- `src/app/spike-parse/` + `src/parser/` 初版
- `parseMinimal(file: File): Promise<{count, firstDate, lastDate}>`（M1 适配器接口最小版）
- Playwright 断言 `privacy.spec.ts`：拦截全部请求，断言零请求携带文件内容或解析结果
- DevTools offline 完整跑通 + 抓包 HAR 存证

## 判据（S2 软伤修复）

原型在 M1 开工前必须过 **AC-1.2 fixture 5/25 子集 + AC-1.8 断网**，否则 M1 从骨架重写（+2 天）；判据已写入 W0 出口门。

## 依赖

- A1 出 go/no-go（决定 M1 iMessage 适配器是否进 P0）
- `documentation/权重表-v1.md` approved（M1 雷达图地基，不阻塞 A2 本身）
