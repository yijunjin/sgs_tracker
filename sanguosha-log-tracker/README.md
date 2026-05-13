# sanguosha-log-tracker

基于公开日志区域截图 OCR 的三国杀记牌器 MVP。当前阶段仅提供浏览器本地开发预览，不接入 Tauri / Electron，也不读取任何隐藏信息。

## 合规说明

本工具仅基于公开日志区域进行 OCR 统计，不读取隐藏信息，不抓包，不改包。

## 环境要求

- Node.js 20+
- pnpm

## 安装

```bash
pnpm install
```

## 启动

```bash
pnpm dev
```

## 打开

浏览器访问 `http://localhost:5173`

## 演示步骤

1. 点击“生成示例日志截图”
2. 点击“使用 Mock OCR 识别示例日志”
3. 点击“解析文本”或直接查看自动解析结果
4. 点击“全部接受高置信度事件”
5. 观察右侧牌库的已见 / 剩余变化
6. 点击“撤销上一条”观察牌库恢复

## 真实 OCR 说明

- 点击“运行真实 OCR”会懒加载并初始化 `@paddleocr/paddleocr-js`
- 首次加载模型可能较慢
- 如果浏览器、WASM、Worker 或跨源隔离配置导致失败，可以先用 Mock OCR 跑通完整流程
- Web 开发服务器已设置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`
- 如果后续改为加载不兼容的第三方 CDN 资源，可能会受到跨源隔离限制。此时建议改成本地静态资源，或暂时关闭相关 header 进行排查

## 项目结构

```text
sanguosha-log-tracker/
  apps/
    api/
    web/
  packages/
    shared/
```

## 后续计划

- 更精细的日志区域拖拽裁剪
- 牌堆配置编辑器
- 支持完整牌堆：花色 + 点数 + 牌名
- 更强 OCR 纠错
- Tauri 桌面化
- 本地持久化历史记录
