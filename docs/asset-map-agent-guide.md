# Live Asset Map: Agent 使用指南

Live Asset Map 是本项目的私有资产关系层。它把本地 Git 路径、远程 GitHub 仓库、目录项目、部署、服务器、运行服务、DNS、URL 和云资产连接为一张可验证的图。

## 边界与数据所有权

- 扫描事实来自 `repository_snapshots`、`catalog_projects`、`deployments`、`servers`、`discovered_assets` 和 `resource_links`。
- Cursor、Claude Code、Codex 和其他 Agent 只能通过人工补充层添加备注或关系。
- 人工补充不会修改扫描源字段，也不会被下一次扫描覆盖。
- 本地路径、私有仓库、服务器地址和内部关系仅在管理员 API 与 MCP 中提供，公共 Catalog API 不暴露这些数据。
- 不要将 API Key、密码、私钥、Cookie 或 1Password 引用写入备注、证据或关系字段。

## 管理员 API

根路径：`https://g.ksamint.cn/api/admin/v1`

| 操作               | 方法与路径                                      |
| ------------------ | ----------------------------------------------- |
| 读取当前地图       | `GET /asset-map`                                |
| 搜索地图           | `GET /asset-map?q=owner%2Frepo&kind=repository` |
| 读取版本历史       | `GET /asset-map/versions`                       |
| 创建可恢复版本     | `POST /asset-map/versions`                      |
| 下载一个版本       | `GET /asset-map/versions/{id}?download=1`       |
| 恢复版本中的人工层 | `POST /asset-map/versions/{id}/restore`         |
| 补充节点           | `PUT /asset-map/annotations`                    |
| 补充关系           | `PUT /asset-map/edges`                          |
| 删除人工关系       | `DELETE /asset-map/edges/{id}`                  |

管理员浏览器会话或 `ADMIN_TOKEN` 可使用这些接口。读取需要 `viewer`，修改需要 `operator`。所有响应使用 `{data, meta}` 或 `{error}` envelope。

### 补充节点

先读取地图并使用响应中的稳定 `node.id`，不要自行猜测 ID。

```json
{
  "entityId": "repository:github.com/example/service",
  "label": "Service API",
  "tags": ["production", "api"],
  "notes": "由平台组维护。部署关系已人工确认。"
}
```

### 补充关系

```json
{
  "source": "repository:github.com/example/service",
  "target": "server:server-id",
  "relationship": "backs_up_to",
  "status": "candidate",
  "confidence": 0.7,
  "evidence": ["compose working directory reviewed 2026-08-18"],
  "notes": "等待运行时 commit label 二次确认。"
}
```

关系建议使用稳定动词：

- `syncs_to`: 本地 Git 路径同步到远程仓库。
- `implements`: 仓库实现一个项目。
- `deploys_as`: 项目产生一个部署。
- `runs_on`: 部署或服务运行在服务器。
- `exposes`: 部署暴露 URL。
- `routes_to`: DNS 或入口路由到端点。
- `backs_up_to`: 代码、镜像或数据备份到目标。
- `managed_by`: 资产由指定项目、账户或 Agent 管理。

不能确定的关系必须使用 `candidate`。只有明确的 remote、commit、工作目录、部署配置或人工确认才能使用 `confirmed`。

## MCP

MCP endpoint：`https://g.ksamint.cn/mcp`

API key 存储在 1Password 中，并通过运行环境注入。不要把 key 写入仓库。创建 Agent key 时按最小权限选择：

- `asset-map:read`: 读取 `ops://asset-map/snapshot` 与调用 `asset_map.get`。
- `asset-map:write`: 调用 `asset_map.annotate`、`asset_map.link` 和 `asset_map.snapshot`。

MCP 接口：

| 类型     | 名称                       |
| -------- | -------------------------- |
| Resource | `ops://asset-map/snapshot` |
| Tool     | `asset_map.get`            |
| Tool     | `asset_map.annotate`       |
| Tool     | `asset_map.link`           |
| Tool     | `asset_map.snapshot`       |

推荐 Agent 流程：

1. 调用 `asset_map.get` 获取当前节点、关系、fingerprint 和证据。
2. 仅对本次任务涉及的节点进行补充，避免全量改写。
3. 不确定关系写为 `candidate`，并在 evidence 中写明来源与检查日期。
4. 修改完成后调用 `asset_map.snapshot`，summary 写清本次修改范围。
5. 重新读取地图，确认目标关系存在且没有改变扫描事实。

## 版本与备份

- Cron 每天在内容变化时保存一个 scheduled 版本。
- 人工备注、人工关系、删除和恢复会立即保存版本。
- scheduled 版本保留 90 天。manual、agent、restore 和 pre_restore 版本不自动删除。
- 每个版本包含内容 SHA-256、schema version、actor、reason、时间和完整 JSON 快照。
- 恢复操作只替换 `asset_map_annotations` 与 `asset_map_manual_edges`，不会回滚扫描数据或外部云资源。
- 恢复前会自动生成 `pre_restore` 版本，因此误恢复仍可回退。

## UI

管理员登录后进入 `/resources/`，点击“资产地图”。地图按层显示全部 canonical 节点。搜索可定位本地路径、GitHub owner/repo、服务器、服务或域名。选择节点可查看上下游关系并编辑人工补充；“版本历史与备份”支持下载 JSON 和恢复人工层。
