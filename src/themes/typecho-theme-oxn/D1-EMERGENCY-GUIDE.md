# Cloudflare D1 数据库应急操作手册

> 适用项目：Typecho Workers（当前仓库结构）
>
> 本手册是备用操作说明，不会自动执行任何命令。所有命令默认针对 Cloudflare **远程 D1**，执行前必须确认目标数据库。
>
> 数据库绑定名通常是 `DB`；Wrangler 也可以直接使用 Cloudflare D1 数据库名称。若你的项目配置不同，请替换命令中的 `DB`。

---

## 0. 操作前必须确认

### 0.1 确认当前目录和登录账号

在项目根目录打开终端：

```bash
npx wrangler whoami
npx wrangler d1 list
```

查看目标数据库信息：

```bash
npx wrangler d1 info DB
```

本项目生成的 Worker 配置使用 D1 binding `DB`，真实数据库名称和 ID 来自 Cloudflare 构建变量 `TYPECHO_D1_DATABASE_NAME`、`TYPECHO_D1_DATABASE_ID`。如果命令无法识别 `DB`，请改用 Cloudflare 中显示的真实数据库名称。

### 0.2 远程与本地的区别

- `--remote`：操作 Cloudflare 线上数据库，本文的线上命令均使用它。
- `--local`：操作本机 Wrangler 开发数据库，不会修改线上数据。
- 不要因为命令报错就随意切换参数；先确认目标环境。

### 0.3 先备份，再修改

导出线上数据库的结构和全部数据：

```bash
npx wrangler d1 export DB --remote --output=./d1-backup.sql
```

只导出结构：

```bash
npx wrangler d1 export DB --remote --output=./d1-schema.sql --no-data
```

只导出数据：

```bash
npx wrangler d1 export DB --remote --output=./d1-data.sql --no-schema
```

恢复 SQL 文件（建议先恢复到测试数据库验证；不要直接覆盖正在使用的线上库）：

```bash
npx wrangler d1 execute DB --remote --file=./d1-backup.sql
```

**注意：** 导出文件包含用户邮箱、评论、文章和其他站点数据，必须妥善保管，不要上传到公开仓库或发给他人。

---

## 1. 最常用的 D1 命令

### 1.1 执行一条 SQL

```bash
npx wrangler d1 execute DB --remote --command "SELECT 1;"
```

### 1.2 执行 SQL 文件

```bash
npx wrangler d1 execute DB --remote --file=./maintenance.sql
```

### 1.3 查询数据库表

```bash
npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
```

### 1.4 查看表结构

```bash
npx wrangler d1 execute DB --remote --command "PRAGMA table_info('typecho_users');"
```

把表名替换成需要检查的表即可。

### 1.5 查看数据量

```bash
npx wrangler d1 execute DB --remote --command "SELECT 'users' AS table_name, COUNT(*) AS rows FROM typecho_users UNION ALL SELECT 'contents', COUNT(*) FROM typecho_contents UNION ALL SELECT 'comments', COUNT(*) FROM typecho_comments UNION ALL SELECT 'metas', COUNT(*) FROM typecho_metas UNION ALL SELECT 'fields', COUNT(*) FROM typecho_fields;"
```

### 1.6 查看 D1 数据库信息

```bash
npx wrangler d1 info DB
```

---

## 2. 本项目的数据表速查

以下表名和字段来自当前项目的 `src/db/schema.ts`。不要把其他 Typecho/PHP 版本的表结构直接套用到本项目。

| 表名 | 用途 | 常用字段 |
| --- | --- | --- |
| `typecho_users` | 用户与管理员 | `uid`、`name`、`password`、`mail`、`screenName`、`group`、`authCode` |
| `typecho_contents` | 文章、独立页面等内容 | `cid`、`title`、`slug`、`text`、`type`、`status`、`authorId`、`commentsNum` |
| `typecho_comments` | 评论 | `coid`、`cid`、`author`、`mail`、`text`、`type`、`status`、`parent` |
| `typecho_metas` | 分类、标签 | `mid`、`name`、`slug`、`type`、`count`、`parent` |
| `typecho_relationships` | 内容与分类/标签关联 | `cid`、`mid` |
| `typecho_options` | 站点设置、插件设置 | `name`、`user`、`value` |
| `typecho_fields` | 文章自定义字段 | `cid`、`name`、`type`、`str_value`、`int_value`、`float_value` |
| `typecho_login_failures` | 登录失败计数与封禁 | `ip`、`failures`、`windowStartedAt`、`bannedUntil` |
| `typecho_password_reset_requests` | 密码重置请求 | `email`、`uid`、`tokenHash`、`expiresAt` |
| `typecho_webauthn_credentials` | Passkey 凭据 | `uid`、`credentialId`、`publicKey`、`counter` |
| `typecho_db_cache` | D1 作为缓存 L3 时存储的缓存数据 | `cacheKey`、`value`、`expiresAt` |

### 2.1 查看用户组

```sql
SELECT uid, name, mail, screenName, [group], created, logged
FROM typecho_users
ORDER BY uid;
```

用户组：
- `administrator`：管理员
- `editor`：编辑
- `contributor`：贡献者
- `subscriber`：关注者
- `visitor`：访客

### 2.2 查看内容类型和状态

```sql
SELECT type, status, COUNT(*) AS total
FROM typecho_contents
GROUP BY type, status
ORDER BY type, status;
```

常见内容状态：`publish`、`hidden`、`draft`、`private`、`waiting`。隐藏内容与普通草稿不是同一种状态。

---

## 3. 查询与替换站点地址（网址/域名）

### 3.1 查询当前站点主地址

站点主地址保存在 `typecho_options` 的 `siteUrl` 中：

```bash
npx wrangler d1 execute DB --remote --command "SELECT name, value FROM typecho_options WHERE user=0 AND name='siteUrl';"
```

同时查看标题、固定链接规则等相关设置：

```bash
npx wrangler d1 execute DB --remote --command "SELECT name, value FROM typecho_options WHERE user=0 AND name IN ('siteUrl','title','permalinkPattern','pagePattern','categoryPattern','cacheVersion');"
```

### 3.2 查询数据库中是否还保存旧网址

先把下面的 `old.example.com` 换成旧域名（只写域名，不带协议）。

查询站点设置和插件配置：

```bash
npx wrangler d1 execute DB --remote --command "SELECT name, user, substr(value,1,500) AS value_preview FROM typecho_options WHERE value LIKE '%old.example.com%';"
```

查询文章和独立页面正文：

```bash
npx wrangler d1 execute DB --remote --command "SELECT cid, title, type, status FROM typecho_contents WHERE text LIKE '%old.example.com%' ORDER BY cid;"
```

查询评论中是否引用旧网址：

```bash
npx wrangler d1 execute DB --remote --command "SELECT coid, cid, author, substr(text,1,200) AS preview FROM typecho_comments WHERE text LIKE '%old.example.com%' ORDER BY coid;"
```

这些查询只检查 D1 中对应字段，不代表 Cloudflare DNS、Worker 自定义域名或 R2 域名配置。

### 3.3 替换站点主地址

先备份，并确认新地址。将示例替换为自己的完整网址，保留 `https://`，不要附加文章路径：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_options SET value='https://new.example.com' WHERE name='siteUrl' AND user=0; INSERT INTO typecho_options (name,user,value) VALUES ('cacheVersion',0,'1') ON CONFLICT(name,user) DO UPDATE SET value=CAST(COALESCE(typecho_options.value,'0') AS INTEGER)+1;"
```

### 3.4 检查替换结果

```bash
npx wrangler d1 execute DB --remote --command "SELECT name, value FROM typecho_options WHERE user=0 AND name IN ('siteUrl','cacheVersion');"
```

如果原站点已有 `cacheVersion`，上面的语句会递增版本；如果没有则建立初始值。

### 3.5 替换文章正文中的旧网址（按需）

**先执行 3.2 检查命中范围并备份。** 只在确认需要替换正文中的旧网址后执行：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_contents SET text=replace(text,'https://old.example.com','https://new.example.com') WHERE instr(text,'https://old.example.com')>0;"
```

如果正文里还存在 `http://`、带 `www` 或其他子域名形式，需要分别查询、分别替换。不要把域名替换语句不加筛选地套用到所有表；评论、用户资料和插件配置可能包含不应修改的外部链接或历史信息。

### 3.6 替换其他设置中的旧网址（谨慎）

先查看 3.2 的查询结果，确认具体是哪一项设置。只有确定该配置值确实应该整体替换时，才针对明确的 `name` 和 `user` 更新；不要对整个 `typecho_options` 表做无差别替换，以免改坏插件配置或外部服务地址。

**域名迁移提醒：** 修改 D1 的 `siteUrl` 不会自动修改 Cloudflare Worker 自定义域名、DNS、R2 自定义域名、Turnstile、邮件服务、OAuth 回调或 CSP 白名单。这些需要在各自服务中单独核对。

---

## 4. 管理员密码生成与重置

**不要直接把明文密码写进 `typecho_users.password`。** 本项目使用 PBKDF2-SHA256 密码哈希，可能还启用了 Cloudflare Worker Secret `PASSWORD_PEPPER`。普通 SQL、明文、MD5 或随意生成的 SHA256 都不能替代项目重置脚本。

### 4.1 查看用户列表，确认要重置的账号

在项目根目录执行：

```bash
bun run reset-password:cloudflare -- --list
```

也可以使用脚本完整参数：

```bash
bun run scripts/reset-password.ts --target cloudflare --list
```

先核对用户名，不要凭 UID 或昵称猜测账号。

### 4.2 自动生成新密码并替换

推荐让脚本自动生成随机密码：

```bash
bun run reset-password:cloudflare -- --user admin
```

把 `admin` 换成实际用户名。脚本会生成随机密码、计算项目兼容的 PBKDF2 哈希，并更新远程 D1 的 `typecho_users.password`。**新密码会显示在终端输出中**，请立即复制到密码管理器；不要把终端截图或输出发到公开渠道。

也可以自行指定新密码：

```bash
bun run reset-password:cloudflare -- --user admin --password '替换成新的强密码'
```

注意：命令行参数可能留在终端历史记录中。更推荐自动生成方式，避免把自定义密码直接写进命令历史。

### 4.3 如果线上启用了 PASSWORD_PEPPER

重置时，脚本必须使用与线上 Worker 当前 `PASSWORD_PEPPER` 完全相同的值，否则新密码无法通过线上验证。不要把 Pepper 写进 D1、Git、普通 `[vars]` 或公开聊天记录。

如果你已经安全保存了线上 Pepper，可在执行脚本时临时提供：

macOS/Linux：

```bash
PASSWORD_PEPPER='填入线上当前 PASSWORD_PEPPER' bun run reset-password:cloudflare -- --user admin
```

PowerShell：

```powershell
$env:PASSWORD_PEPPER = "填入线上当前 PASSWORD_PEPPER"
bun run reset-password:cloudflare -- --user admin
Remove-Item Env:PASSWORD_PEPPER
```

如果没有启用 Pepper，则不需要设置该环境变量。

### 4.4 首次生成并设置 PASSWORD_PEPPER（上游部署说明）

如果尚未设置 Pepper，可生成 32 字节随机值并直接保存为 Cloudflare Secret：

```bash
openssl rand -hex 32 | bunx wrangler secret put PASSWORD_PEPPER
```

Pepper 必须作为 Secret 保存，不能写入 D1、Git 或普通 `[vars]`。启用 Pepper 后，新密码使用带 Pepper 的 PBKDF2 格式；旧的无 Pepper PBKDF2 密码仍可登录，并会在成功登录时自动升级。

### 4.5 邮件密码重置不可用时：更换 Pepper 并重置管理员

上游仓库提供了应急处理方式：生成新的 Pepper，先更新 Cloudflare Secret，再使用**同一个 Pepper**运行密码重置脚本：

```bash
RECOVERY_PEPPER=$(openssl rand -hex 32)
printf '%s' "$RECOVERY_PEPPER" | bunx wrangler secret put PASSWORD_PEPPER
PBKDF2_ITERATIONS=50000 PASSWORD_PEPPER="$RECOVERY_PEPPER" \
  bun run reset-password:cloudflare -- --user admin
unset RECOVERY_PEPPER
```

将 `admin` 换成实际管理员用户名。该示例按上游说明使用 50000 次迭代，适用于已按 Workers Free 方案配置为 50000 次迭代的部署；如果你的线上 `PBKDF2_ITERATIONS` 配置不同，应让 CLI 与线上配置一致，不要盲目照抄 50000。

**重要风险：PASSWORD_PEPPER 不支持透明轮换。** 更新 Secret 后，原来使用旧 Pepper 生成的密码哈希将无法再通过新 Pepper 验证。上面的流程只重置指定的管理员账号；如果其他用户也有旧 Pepper 密码，他们也需要分别重置密码。执行前必须确认你持有正确的 Cloudflare 账号，并准备好为受影响账号重新设置密码。不要为了普通的单个密码忘记就随意更换全站 Pepper；优先使用现有 Pepper 重置该账号。

### 4.6 密码重置脚本的行为边界

- `--target cloudflare` 或 `reset-password:cloudflare` 指向 Cloudflare 远程 D1；不要误用默认的 local 目标。
- `--list` 只列出用户，不修改数据。
- 不提供 `--password` 时，脚本自动生成随机密码并在终端显示。
- 脚本使用项目兼容的 PBKDF2-SHA256 哈希；迭代次数受项目配置约束。
- 当前脚本更新 `password` 字段，但**不会同步轮换 `authCode`**，因此不能把它当作强制注销所有既有登录会话的操作。
- 不要用 SQL 直接改密码，也不要删除管理员后再尝试恢复。

---

## 5. 评论管理

### 5.1 查看评论状态数量

```bash
npx wrangler d1 execute DB --remote --command "SELECT status, type, COUNT(*) AS total FROM typecho_comments GROUP BY status, type ORDER BY status, type;"
```

### 5.2 查看待审核评论

```bash
npx wrangler d1 execute DB --remote --command "SELECT coid, cid, author, mail, created, substr(text,1,200) AS preview FROM typecho_comments WHERE status='waiting' ORDER BY created DESC LIMIT 100;"
```

### 5.3 查看垃圾评论

```bash
npx wrangler d1 execute DB --remote --command "SELECT coid, cid, author, mail, created, substr(text,1,200) AS preview FROM typecho_comments WHERE status='spam' ORDER BY created DESC LIMIT 100;"
```

### 5.4 查看某篇文章的评论

```bash
npx wrangler d1 execute DB --remote --command "SELECT coid, cid, parent, author, status, created, text FROM typecho_comments WHERE cid=文章CID ORDER BY created ASC;"
```

把 `文章CID` 替换为数字，不要保留中文占位文字。

### 5.5 清空垃圾评论

本项目的垃圾评论状态是 `spam`。垃圾评论不计入文章的已通过评论数，因此可以单独清理：

先检查数量：

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS spam_total FROM typecho_comments WHERE status='spam';"
```

确认后删除：

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM typecho_comments WHERE status='spam';"
```

后台也提供“删除垃圾评论”功能，管理员可清理全部垃圾评论；编辑/贡献者权限只清理自己当前负责文章下的垃圾评论。

### 5.6 将待审核评论设为通过（谨慎）

如果确实需要通过 SQL 批量处理，先确认待审核范围。状态变更后还要同步修正文章的 `commentsNum`：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_comments SET status='approved' WHERE status='waiting'; UPDATE typecho_contents SET commentsNum=(SELECT COUNT(*) FROM typecho_comments WHERE typecho_comments.cid=typecho_contents.cid AND typecho_comments.status='approved') WHERE cid IN (SELECT DISTINCT cid FROM typecho_comments WHERE status='approved');"
```

这会通过**全部**待审核评论，并重新统计有已通过评论的文章数量。执行前备份；如果只想处理部分评论，优先在后台逐条或批量审核，避免误通过。

### 5.7 删除单条评论

优先使用后台评论管理。后台删除流程会同时维护文章评论数、插件钩子和缓存。不要只执行 `DELETE FROM typecho_comments` 删除一条已通过评论，否则文章的 `commentsNum` 可能不一致。

---

## 6. 文章、独立页面与内容维护

### 6.1 查看文章列表

```bash
npx wrangler d1 execute DB --remote --command "SELECT cid, title, slug, type, status, authorId, datetime(created,'unixepoch') AS created_at FROM typecho_contents WHERE type='post' ORDER BY created DESC LIMIT 100;"
```

### 6.2 查看草稿、隐藏、私密内容

```bash
npx wrangler d1 execute DB --remote --command "SELECT cid, title, type, status, authorId, datetime(modified,'unixepoch') AS modified_at FROM typecho_contents WHERE status IN ('draft','hidden','private','waiting') ORDER BY modified DESC;"
```

### 6.3 查看独立页面

```bash
npx wrangler d1 execute DB --remote --command "SELECT cid, title, slug, type, status, parent, [order] FROM typecho_contents WHERE type IN ('page','page_draft') ORDER BY [order], cid;"
```

### 6.4 查看某篇内容的关联分类/标签

```bash
npx wrangler d1 execute DB --remote --command "SELECT m.mid, m.name, m.slug, m.type FROM typecho_relationships r JOIN typecho_metas m ON m.mid=r.mid WHERE r.cid=文章CID ORDER BY m.type,m.mid;"
```

### 6.5 查看内容自定义字段

```bash
npx wrangler d1 execute DB --remote --command "SELECT cid, name, type, str_value, int_value, float_value FROM typecho_fields WHERE cid=文章CID ORDER BY name;"
```

### 6.6 删除文章/页面的注意事项

**不要用一条 `DELETE FROM typecho_contents WHERE cid=...` 直接删除内容。**

本项目删除内容还需要处理：
- `typecho_relationships`：分类/标签关联；
- `typecho_comments`：评论；
- `typecho_fields`：自定义字段；
- `typecho_metas.count`：分类/标签计数；
- 插件删除钩子；
- 页面缓存和共享数据缓存失效。

直接删除主表可能留下孤立数据、错误计数或陈旧缓存。正常删除请使用后台文章/页面管理。若后台删除失败，应先查询内容和关联数据确认删除是否已经发生，不要立即重复执行 SQL。

---

## 7. 用户管理

### 7.1 查看用户

```bash
npx wrangler d1 execute DB --remote --command "SELECT uid, name, mail, screenName, [group], url, datetime(created,'unixepoch') AS created_at, datetime(logged,'unixepoch') AS last_login FROM typecho_users ORDER BY uid;"
```

### 7.2 修改用户邮箱、昵称或角色

先确认目标 UID 和管理员数量：

```bash
npx wrangler d1 execute DB --remote --command "SELECT uid,name,mail,screenName,[group] FROM typecho_users WHERE uid=目标UID; SELECT COUNT(*) AS admin_total FROM typecho_users WHERE [group]='administrator';"
```

修改邮箱、昵称示例：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_users SET mail='new@example.com', screenName='新昵称' WHERE uid=目标UID;"
```

调整角色示例：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_users SET [group]='editor' WHERE uid=目标UID;"
```

角色只能使用：`administrator`、`editor`、`contributor`、`subscriber`。不要降级或删除最后一个管理员。普通用户资料和角色修改优先在后台完成。

### 7.3 删除用户的注意事项

后台删除用户会把该用户名下文章和评论的作者归属转给当前管理员，并保护最后一个管理员及当前登录用户。直接删除 `typecho_users` 不会自动完成这些关联处理。请使用后台用户管理。

### 7.4 查看 Passkey 绑定

```bash
npx wrangler d1 execute DB --remote --command "SELECT id, uid, name, deviceType, backedUp, datetime(createdAt,'unixepoch') AS created_at, datetime(lastUsedAt,'unixepoch') AS last_used FROM typecho_webauthn_credentials ORDER BY uid,id;"
```

不要随意删除 Passkey 凭据；删除后对应设备将无法再使用该凭据登录。

---

## 8. 站点设置与配置项

### 8.1 查看常用站点设置

```bash
npx wrangler d1 execute DB --remote --command "SELECT name,value FROM typecho_options WHERE user=0 ORDER BY name;"
```

### 8.2 查看插件配置项名称（不输出配置值）

```bash
npx wrangler d1 execute DB --remote --command "SELECT name,user,length(value) AS value_length FROM typecho_options WHERE name LIKE 'plugin:%' ORDER BY name,user;"
```

插件设置可能包含密钥、Token、Webhook 等敏感信息。不要把完整查询结果贴到公开渠道。

### 8.3 修改单个普通选项

示例：修改站点标题：

```bash
npx wrangler d1 execute DB --remote --command "UPDATE typecho_options SET value='新的站点标题' WHERE name='title' AND user=0;"
```

只修改已经确认存在的选项。若选项不存在，先检查查询结果，不要盲目插入未知配置。

**缓存提示：** 直接改 `typecho_options` 不会自动执行应用层的缓存失效流程。修改站点设置后，至少要按域名迁移一节同步递增 `cacheVersion`；其他设置可能还涉及插件自己的缓存或运行时同步，能在后台保存的设置尽量通过后台保存。

---

## 9. 缓存与登录故障排查

### 9.1 查看 D1 页面缓存记录数

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS cache_rows FROM typecho_db_cache;"
```

### 9.2 查看已过期的 D1 缓存数量

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS expired_rows FROM typecho_db_cache WHERE expiresAt <= unixepoch();"
```

### 9.3 清理已过期的 D1 缓存

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM typecho_db_cache WHERE expiresAt <= unixepoch();"
```

这只清理 D1 的 L3 缓存表，不会清理 Cloudflare KV，也不会重置 KV generation。不要把它当作 KV Writes 耗尽的解决办法。

### 9.4 查看登录失败限制记录

```bash
npx wrangler d1 execute DB --remote --command "SELECT ip, failures, datetime(windowStartedAt,'unixepoch') AS window_started, datetime(bannedUntil,'unixepoch') AS banned_until FROM typecho_login_failures ORDER BY bannedUntil DESC LIMIT 100;"
```

### 9.5 清理登录失败记录

只有在确认需要解除登录失败计数/封禁时才执行：

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM typecho_login_failures WHERE ip='需要解除的IP';"
```

清空所有登录失败记录（影响所有 IP，谨慎）：

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM typecho_login_failures;"
```

---

## 10. 分类与标签

### 10.1 查看分类和标签

```bash
npx wrangler d1 execute DB --remote --command "SELECT mid,name,slug,type,count,[order],parent FROM typecho_metas ORDER BY type,[order],mid;"
```

### 10.2 查看没有关联内容的分类/标签

```bash
npx wrangler d1 execute DB --remote --command "SELECT m.mid,m.name,m.slug,m.type,m.count FROM typecho_metas m LEFT JOIN typecho_relationships r ON r.mid=m.mid WHERE r.mid IS NULL ORDER BY m.type,m.mid;"
```

### 10.3 查看关联数量与记录计数是否一致

```bash
npx wrangler d1 execute DB --remote --command "SELECT m.mid,m.name,m.type,m.count,COUNT(r.cid) AS actual_count FROM typecho_metas m LEFT JOIN typecho_relationships r ON r.mid=m.mid GROUP BY m.mid,m.name,m.type,m.count HAVING m.count <> COUNT(r.cid) ORDER BY m.mid;"
```

检查结果不为空时，先确认是否包含隐藏、草稿或其他特殊内容，再决定是否修正计数。不要直接删除分类/标签表记录；先通过后台处理关联。

---

## 11. 常用 SQL 模板

### 11.1 按 ID 查询一条文章

```sql
SELECT * FROM typecho_contents WHERE cid=123;
```

### 11.2 按标题关键词搜索文章

```sql
SELECT cid,title,type,status FROM typecho_contents
WHERE title LIKE '%关键词%'
ORDER BY created DESC;
```

### 11.3 按邮箱查询用户

```sql
SELECT uid,name,mail,screenName,[group]
FROM typecho_users
WHERE mail='user@example.com';
```

### 11.4 查询某个用户发布的内容

```sql
SELECT cid,title,type,status,created
FROM typecho_contents
WHERE authorId=用户UID
ORDER BY created DESC;
```

### 11.5 查询某篇文章的评论数量与文章记录值

```sql
SELECT c.cid,c.title,c.commentsNum,
  (SELECT COUNT(*) FROM typecho_comments x
   WHERE x.cid=c.cid AND x.status='approved') AS actual_approved
FROM typecho_contents c
WHERE c.cid=文章CID;
```

---

## 12. 哪些操作不要直接用 SQL

以下操作存在多表联动、权限校验、插件钩子或缓存失效，不建议直接改表：

1. **删除文章或独立页面**：后台会清理评论、字段、分类标签关系、计数并触发插件钩子。
2. **删除用户**：后台会重新分配文章和评论作者，并保护最后一个管理员。
3. **删除单条已通过评论**：需要同步文章 `commentsNum`。
4. **修改管理员密码**：必须使用项目 PBKDF2 重置脚本，不能写明文、MD5 或随意生成的哈希。
5. **修改插件配置**：插件配置可能有私有数据、运行时同步和缓存失效流程。
6. **修改分类/标签关联**：需要同步 `typecho_relationships` 和 `typecho_metas.count`。
7. **清理 KV 页面缓存**：`typecho_db_cache` 是 D1 L3，不是 Cloudflare KV。KV 绑定中的 generation 和缓存数据不在这张表里。

如果后台操作失败，先用本手册的 SELECT 命令确认数据库实际状态，再决定下一步。不要因为页面提示失败就直接重复删除。

---

## 13. 执行前检查清单

- [ ] 确认 Wrangler 登录的是正确 Cloudflare 账号。
- [ ] 确认目标 D1 数据库名称/绑定名正确。
- [ ] 确认命令使用的是 `--remote`，且确实需要修改线上库。
- [ ] 修改或删除前先执行 SELECT，确认命中记录。
- [ ] 批量操作前先导出备份。
- [ ] 先执行小范围操作并检查结果。
- [ ] 涉及后台业务逻辑的操作，优先使用后台或项目自带脚本。
- [ ] 不把密码、Pepper、用户邮箱、评论正文和完整备份泄露出去。

---

## 14. 官方命令参考

- Wrangler D1 命令：<https://developers.cloudflare.com/d1/wrangler-commands/>
- D1 数据导入与导出：<https://developers.cloudflare.com/d1/best-practices/import-export-data/>

本手册中的项目表名和字段以当前仓库 `src/db/schema.ts` 为准；如果后续数据库结构发生变化，应先对照该文件更新本手册。
