# 账本导出格式 v1

账本使用固定数据结构，名称和用途由用户自定。每本账只使用一种币种，
不跨币种合并余额。`schemaVersion: 1` 标识本规范；破坏兼容的修改须升级版本。

## 三种下载

- CSV：单独下载 `expenses.csv`，适合浏览账单明细。
- JSON：单独下载 `ledger.json`，包含结构化记录，附件只有元数据和相对路径。
- ZIP：包含下列全部文件和实际附件；账本成员可下载，归档后仍可下载。

| ZIP 文件 | 内容与主要字段 |
| --- | --- |
| `ledger.json` | `schemaVersion`, `exportedAt`, `ledger`, `members`, `expenses`, `payments`, `templates`, `occurrences` |
| `expenses.csv` | `expense_id,date,title,currency,amount_cents,payer_id,payer_name,status,note,created_by,created_at,version,attachments` |
| `shares.csv` | `expense_id,member_id,member_name,share_cents,repaid_cents,is_payer` |
| `items.csv` | `expense_id,item_number,title,amount_cents,participant_ids` |
| `payments.csv` | `payment_id,expense_id,date,from_member,to_member,amount_cents,type,reverses_id,reversed_by,note,created_by,created_at` |
| `members.csv` | `member_id,name,balance_cents` |
| `history.csv` | `expense_id,event_id,event_type,actor_uid,actor_name,at,reason,amount_cents,from_member,to_member,before,after` |
| `ledger-status.csv` | `status,actor_uid,actor_name,at`，归档/恢复记录 |
| `attachments.csv` | `path,original_name,mime,bytes,receipt_id` |
| `attachments/00001.png` 等 | 当前及历史版本引用的附件，同一文件只打包一次 |
| `README.txt` | 导出时间、格式版本、单位和读取说明 |

## 字段规则

- JSON 的 `ledger` 含 `id,title,currency,createdAt,ownerUid,status,archivedAt,statusHistory`；
  `members` 含 `id,name,uid,createdAt`。旧数据没有的可选字段可能省略。
- 账单、还款、模板、已处理期次保留已有业务字段和稳定 ID。
  账单历史的 `before`/`after` 保留更正前后内容；CSV 将它们编码为 JSON 字符串。
- 金额为整数分：`80000` 表示 800.00 元/美元。CSV 的金额列都以 `_cents`
  结尾。成员 `balance_cents` 正数为应收，负数为应付。
- `shares.csv` 列出全部消费份额，包括垫付人自付部分。参与人 ID 和附件路径
  的多值列用分号分隔，具体成员和附件信息用对应表连接。
- `date` 是 `YYYY-MM-DD` 的业务日期；`createdAt`、`at` 和 `exportedAt`
  是带时区的时间戳。导出时不修改原始业务日期。
- 撤销账单仍保留在导出里，不能把所有账单金额直接求和当累计支出。
  还款及其撤销保留原始关联，不把撤销记录当作新的实际付款。
- 归档只改变账本可写状态，不改变债务。恢复不会自动支付或生成已记账开销。
- 附件 JSON 字段为 `id,name,type,size,path`，不含浏览器地址或内嵌数据。
  `path` 相对于 ZIP 根目录，编号避免不同原文件名重名或形成危险路径。
- CSV 使用 UTF-8 BOM、CRLF 和双引号转义，适合中文表格软件。文本若以
  公式触发字符开头，前置单引号防止被解释成公式；JSON 保留精确原文。

## 边界

导出包含已经保存的账单、更正、还款、历史附件、模板和已处理期次；尚未
确认的未来期次可依据模板计算。本地未提交草稿不包含在内。邀请链接、
邀请密钥、会话和密码不导出。可从账本选项导入为独立账本；该文件不是账号或数据库的完整备份，也不会发起转账。

## 导入与可选字段

- `ledger.timeZone/timeZoneHistory` 保存账期时区；旧版本缺失时兼容 Shanghai。成员可包含 `status/nameHistory/statusHistory`。
- 汇总还款在 JSON 的逐笔分配中保留 `batchId`，撤销带 `reversesBatchId`；CSV 的已有列保持兼容，完整关联以 JSON 为准。
- `POST /api/ledger-import/preview` 校验文件并返回标题、人数、笔数与附件数；`POST /api/ledger-import` 带幂等键创建新账本。文件最大 20 MiB，ZIP 解压最大 40 MiB、2000 项；不向磁盘解压。
- 含附件的 JSON 不允许省略文件继续恢复，须使用完整 ZIP。校验金额、还款/撤销关联、分摊与已还金额一致性、附件内容和引用；失败时整个事务回滚。
- 新账本、成员、账单、付款、模板、附件均生成新 ID。导入者明确选择本人对应的成员，其余账号绑定与邀请全部清除。历史操作人的姓名与来源信息保留；旧 UID 不授予访问权限。模板管理归导入者。
- 原账本不修改；归档状态、已处理期次、账单版本和历史附件保留。本地草稿与登录信息不导入。
