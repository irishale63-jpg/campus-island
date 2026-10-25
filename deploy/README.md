# 校园岛：云端部署

公开体验：[打开校园岛](https://campus-kindness-cjq.round-bell-5229.chatgpt.site)。原网址保留。

Sites 项目：appgprj_6adcd5b8b8f081918b8bb55dcb3c4e99。

## 共享业务与持久化

本机与云端使用同一 lib/application.mjs、lib/domain.mjs、lib/identity.mjs，统一接口、状态规则和权限。云端适配器 lib/cloud-api.mjs 使用：

- D1 DB：kindness_state 保存带 revision 的状态快照，条件更新重试避免并发互相覆盖。
- D1 kindness_sessions：保存 HttpOnly、SameSite=Strict、HTTPS Secure 会话，owned_ids 关联设备拥有的独立身份。
- R2 BUCKET：保存私信图片，数据库只存元信息。图片由带权限校验的接口读取，不开放公共桶地址。
- 学校、个人记录、文字/图片会话和通知逐项校验权限。三个演示身份仍由所有访客共用，独立身份通过恢复码和服务端会话访问。

仅数据库没有状态时创建种子。后续迁移增量补充字段和标识示例，不覆盖原求助、私信与感谢。本机 data/ 与云端互相独立，不复制到部署包。

## 更新流程

托管源码工程为本机 sites/campus-kindness，使用 Sites 独立源码仓库。主工程忽略其依赖、产物和 Git 元数据；主工程本机运行无需该目录。

1. 修改主工程并运行 npm test。
2. node scripts/sync-cloud.mjs 同步页面、图片、共享业务，不复制本机数据或凭据。
3. 在托管工程安装/使用现有依赖，按 db/schema.ts 生成新的 Drizzle 迁移；历史迁移不能改写。
4. 本地 Worker 预览时应用迁移，检查 D1/R2；预览进程退出后再构建，避免 Windows 锁住 dist。
5. 通过 Sites 工作流构建、保存并推送精确源码、生成对应归档、保存版本，再部署已保存版本。保留当前公开访问设置，不新建站点或清库。

本轮新增迁移 0001 只给 kindness_sessions 添加 owned_ids，0000 保持不变。正式发布由托管部署流程应用迁移。

## 未配置与容量

真实学校邮箱认证按用户决定保留待配置，不生成真实认证标记；当前可用的是分校演示圈。站内消息15秒检查，离线留存，无站外系统推送。

云端单状态快照约1.8MB，写入每IP五分钟最多120次，图片单次最多3MB。属于比赛演示规模；正式运营前需完善存储、备份、审核与账号找回。

## 本轮发布

2026-10-25 发布版本 3：校园岛品牌、独立身份与学校演示圈、图片私信和进度通知。托管源码提交 bcebbb8eb46a268c534743351baad0b29c0bd74f，保留原公开网址。邮件验证仍待配置。
