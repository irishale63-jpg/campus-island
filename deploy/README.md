# 云端演示版

公开网址：https://campus-kindness-cjq.round-bell-5229.chatgpt.site

Sites 项目：`appgprj_6adcd5b8b8f081918b8bb55dcb3c4e99`，初次发布为版本 1。

云端版本沿用 `public/` 的界面与 `lib/domain.mjs` 的业务规则，使用 `lib/cloud-api.mjs` 提供 Fetch API 接口。`schema.sql` 是首次建库的表结构参考；正式托管的版本使用 Sites 仓库中 Drizzle 生成的迁移，已应用迁移不能改写。

## 数据与会话

- Cloudflare D1 的 `kindness_state` 表存储互助数据；带 revision 的条件更新防止多人同时操作互相覆盖。
- 仅数据库没有状态记录时加载示例数据；重新构建与部署不重置需求、留言或感谢。
- `kindness_sessions` 保存会话，HTTPS 会话 cookie 设置 HttpOnly、SameSite=Strict、Secure。
- 演示访客共用三个身份，不具备正式用户之间的身份隔离。页面已明确提示只填写模拟内容。
- 云端包含写入频率与演示容量限制。未实现正式账号注册、运营审核和完整生产服务能力。
- 本地 `data/` 不上传；与云端演示数据库相互独立。

## 源码与更新

Sites 构建工程位于本机 `sites/campus-kindness`，由 Sites 独立源码仓库管理；主项目忽略该工程的依赖、构建产物及 Git 元数据。当前站点 ID 保存在该工程 `.openai/hosting.json`。

修改主项目界面或业务后，先运行 `node scripts/sync-cloud.mjs`，把界面、示例数据定义和共享规则同步到现有托管工程，再构建、验证、通过 Sites 保存版本并部署。同步脚本不复制 `data/`、会话或凭据。

主项目运行不依赖托管工程；`npm test` 在真实 SQLite 上验证云端 SQL、会话、协作流程、访问边界和并发写入重试。
