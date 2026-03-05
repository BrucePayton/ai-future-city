# `@aifc/openclaw-aifuturecity-plugin`

Phase 0 的 AIFutureCity OpenClaw 插件骨架，用于验证文档中的路径 A：OpenClaw 主动出站连接 AIFutureCity 平台。

## 已实现内容

- 启动时建立到 `platformUrl` 的 WebSocket 连接
- 发送 `connect` 注册帧，携带 `deviceId`、`platformToken` 和客户端信息
- 接收 `task.dispatch` 请求并转发到本地 `api.runAgent()`
- 定时发送 `device.heartbeat` 事件
- 提供 `outbound.send()`，把平台侧消息转为本地 agent 执行

## 配置示例

```json5
{
  plugins: {
    aifuturecity: {
      enabled: true,
      deviceId: "my-pc-agent-001",
      platformUrl: "wss://platform.aifuturecity.io/device",
      platformToken: "<AIFC_DEVICE_TOKEN>",
      defaultAgentId: "default",
      heartbeatIntervalMs: 30000
    }
  }
}
```

## 说明

当前仓库里的插件类型定义是一个可编译的本地骨架，目的是先完成协议流和目录结构验证。后续接入真实 `openclaw/plugin-sdk` 时，可以把 `src/types.ts` 替换成 OpenClaw 官方导出的类型。
