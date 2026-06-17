# sanguosha-log-tracker

基于网页三国杀页面公开日志事件的记牌器 MVP。当前主方案是浏览器插件：content script 注入页面内 Laya 文本 hook，读取玩家视角可见的日志文字和公开协议事件，替代原来的截图 OCR。旧 OCR Web 端仍保留为调试备用。

## 合规说明

本工具仅基于游戏画面中公开显示/玩家视角可见的日志文字进行统计，不自动出牌，不改包。插件会在页面内安装只读 hook，用于捕获 Laya 已渲染文本和 `MsgGameOver` 等公开事件。

当前阶段按牌名聚合统计；如果牌库配置后续补齐花色/点数，右侧面板的小牌块会自动显示更细粒度的牌面。牌库剩余数来自已观察事件推导，不代表读取服务端隐藏牌堆。

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

## 浏览器插件方案

构建插件：

```bash
pnpm --filter @slt/extension build
```

Chrome 加载方式：

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `sanguosha-log-tracker/apps/extension/dist`
5. 打开或刷新 `https://web.sanguosha.com/*`

插件会在游戏页右侧显示“ 三 国 杀记牌器 ”面板，布局接近游戏内右侧栏：

- 顶部显示本轮推导剩余 / 牌库总数
- 基本牌、锦囊牌、装备牌按分组折叠显示
- 每行显示牌名、剩余数量、已见数量和小牌块
- `MsgGameOver` 会标记本局结束并暂停监听
- “导出”按钮会复制本局 JSON 到剪贴板

## 旧 OCR Web 端演示步骤

1. 点击“生成示例日志截图”
2. 点击“使用 Mock OCR 识别示例日志”
3. 点击“解析文本”或直接查看自动解析结果
4. 点击“全部接受严格有效事件”
5. 观察右侧牌库的本轮已见 / 本轮剩余 / 历史已见变化
6. 点击“撤销上一条”观察牌库恢复

## 真实 OCR 说明

- 点击“运行真实 OCR”会懒加载并初始化 `@paddleocr/paddleocr-js`
- 首次加载模型可能较慢
- 如果浏览器、WASM、Worker 或跨源隔离配置导致失败，可以先用 Mock OCR 跑通完整流程
- 真实 OCR 初始化失败不会影响 Mock OCR、手动文本解析、牌库统计和测试
- Web 开发服务器已设置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`
- 如果后续改为加载不兼容的第三方 CDN 资源，可能会受到跨源隔离限制。此时建议改成本地静态资源，或暂时关闭相关 header 进行排查

## 自动监听与洗牌检测

- 自动监听不是每 300ms 跑完整 OCR，而是每 300ms 做画面变化检测；满足稳定时间和最小 OCR 间隔后才识别
- 日志 OCR 和剩余牌 OCR 同步执行，且 OCR 期间禁止并发重入
- 剩余牌数需要连续两次识别为同一数字才会成为稳定值
- 当稳定剩余牌数从低值跳到高值时，会产生疑似洗牌提示
- 洗牌检测默认需要人工确认，避免 OCR 数字误识别导致误重置

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
