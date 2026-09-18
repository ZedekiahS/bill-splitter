# 登录方案研究（待实施）

核对日期：2026-09-18。范围：继续发展现有网页应用，未来允许国内外用户使用，预留 +86 手机号、微信和 QQ 登录。本轮不改登录代码、不创建第三方应用、不部署服务。

## 已保存的基线

- 公开仓库：https://github.com/ZedekiahS/bill-splitter
- 初始提交：`cc3af5ed2dc5c7eaf16fe3273e0c3d0f79984128`
- 已包含 Firestore 权限修复和 32 组模拟器测试。
- 本文是初始备份后的本地研究草稿，尚未作为选型决定实施。

## 当前项目的约束

实际代码 `public/scripts/main.js` 把 Firebase 的 `user.uid` 用作用户文档 ID、`payerUid` 和 `debtors` 成员值；`firestore.rules` 也以 `request.auth.uid` 验证账单权限。Rosefire 目前返回自定义令牌，再由 `firebase.auth().signInWithCustomToken()` 登录。

因此，移除 Rosefire 入口与完全移除 Firebase Authentication 是两件不同的工作。现有客户端直连 Firestore 时，其规则身份来自 Firebase Authentication / Google Cloud Identity Platform，换一个登录按钮并不能让其他厂商的令牌自动满足这些规则。[Firebase 规则身份说明](https://firebase.google.com/docs/firestore/security/rules-conditions)

## 建议先定身份结构，延后选厂商

这是针对本项目的设计建议，不是已经实现的功能：

1. **保留稳定的内部用户 ID。** 现有 Firebase uid 可以先沿用为内部主键，不需要为了抽象而重写所有历史账单。以后换服务时仍保留同一主键，或做明确的一次性映射。
2. **登录身份单独关联。** 记录 `userId`、身份提供方、应用/租户范围和该范围内的身份标识。手机号、邮箱、微信、QQ 都关联到同一个内部账号；它们不是账单的主键。
3. **绑定必须验证身份。** 不按相同昵称、未验证邮箱或猜测的电话号码自动合并账号。旧 Rosefire 用户若要保留账单，应先确认能以另一种方式登录到原账号。
4. **只设一个登录适配接口。** 后续页面只依赖当前用户、登录、退出和绑定能力；提供方 SDK 放在适配实现中。现在没有必要提前构建多套认证系统。

Firebase 本身支持把多个提供方绑定到同一用户 ID；账号绑定也说明了为什么直接新注册一个账号可能丢失对旧账单的访问。[账号绑定文档](https://firebase.google.com/docs/auth/web/account-linking)

## 从 Firebase 过渡的两条路线

| 路线 | 做法 | 适用阶段 |
| --- | --- | --- |
| 保留 Firestore 的过渡方案 | 后端验证新的登录方式，将外部身份映射到稳定 uid，再签发 Firebase 自定义令牌；前端仍以 Firebase 身份访问 Firestore | 希望先替换登录入口、暂不迁移账单存储 |
| 独立后端方案 | 登录由选定身份服务负责；账单读写通过自己的后端，后端根据内部 userId 实施成员权限，再选择数据库 | 确定面向国内长期运营，准备一起调整托管和数据访问方式 |

Firebase 官方支持服务器为指定 uid 创建自定义令牌。[自定义令牌文档](https://firebase.google.com/docs/auth/admin/create-custom-tokens) 这条过渡路线仍依赖 Firebase，并不自动解决国内网络可达性问题。若改用服务端 Firestore SDK，它会绕过客户端 Security Rules，原有的成员权限必须在后端重新落实，不能把“放到服务器”当作授权检查。[服务端访问边界](https://firebase.google.com/docs/firestore/security/rules-conditions)

## 服务候选：先试用，再决定

下面是按本项目需求作出的选型建议，不是对国内网络可用性或审核结果的保证。

| 候选 | 官方资料已确认的能力 | 本项目的取舍 |
| --- | --- | --- |
| Authing 托管认证 | 国内短信、微信网站扫码、微信内网页和 QQ 网站登录都有独立接入文档 | 如果 +86、微信、QQ 都是明确需求，优先做小范围验证；继续使用 Firestore 时仍需上文的身份桥接 |
| 腾讯云 CloudBase | 短信登录文档明确支持 +86，当前限定上海地域；支持微信登录 | 如果后端也准备放腾讯云，值得一起比较。尚未核实 QQ 的原生启用流程；海外短信能力需按地域、SDK 和实际控制台确认 |
| 现有 Firebase | 保留现有账号与数据权限最省迁移工作，支持自定义认证 | 可以作为过渡。官方高短信送达率国家列表未列中国大陆，这不等于绝对不支持，但不足以承诺 +86 的可靠性；国内完整登录和数据访问链路需要实测 |

Authing 官方资料：[国内短信](https://docs.authing.cn/v2/guides/userpool-config/sms/)、[微信网站扫码](https://docs.authing.cn/v2/guides/connections/social/wechat-pc/)、[微信内网页](https://docs.authing.cn/v2/guides/connections/social/wechat-mp/)、[QQ 网站登录](https://docs.authing.cn/v2/guides/connections/social/qq/)。

CloudBase 官方资料：[短信登录与地域限制](https://docs.cloudbase.net/authentication-v2/method/sms-login)、[微信登录](https://docs.cloudbase.net/authentication-v2/method/wechat-login)。Firebase 官方资料：[短信地区说明](https://firebase.google.com/docs/auth/faq-and-troubleshooting)、[自定义令牌交换所用服务](https://firebase.google.com/docs/reference/rest/auth)。

## 国内登录接入时再处理的事项

- **微信先确定产品形态。** 电脑网页扫码、微信内 H5 和小程序是不同接入场景。OpenID 按 AppID 区分，UnionID 也有同一开放平台账号的范围；它们应作为外部身份关联到内部 userId。当前个人/企业主体的精确准入资格需在申请时核实，本次没有足够官方证据作统一断言。[网站扫码](https://cloud.tencent.com/document/product/1441/62649)、[微信内网页](https://cloud.tencent.com/document/product/1441/62650)、[小程序](https://cloud.tencent.com/document/product/1441/62651)、[身份标识定义](https://pay.wechatpay.cn/doc/v3/merchant/4012068676)
- **QQ 需要开发者与应用审核。** 官方允许个人或公司注册；网站和回调域名需要符合审核要求，国际域名另有申请途径，不能假定所有域名都能直接接入。[开发者注册](https://wiki.connect.qq.com/成为开发者)、[网站审核规范](https://wiki.connect.qq.com/网站审核规范)、[创建应用说明](https://wiki.connect.qq.com/__trashed-2)
- **+86 短信先核实供应商与主体。** 以腾讯云为例，其国内短信自 2025-09-18 起不支持个人自用签名；个人账号可按其规则申请企业授权的他用签名或升级企业认证。这是该供应商的政策，不能外推成所有短信服务的统一规则。接入时再确认签名、模板、计费与防刷限制。[腾讯云签名审核标准](https://cloud.tencent.com/document/product/382/39022)

本次只核对公开官方资料，没有注册应用、发送短信、付费开通或进行中国大陆真实网络测试。部分文档仅能通过官方搜索索引核验；上线前需用候选服务的实际控制台和目标用户网络验证。

## 实施节奏建议

先继续修金额、日期和基本记账体验。登录开始实施时，再根据主要用户所在地区、网页/微信小程序形态、开发者主体与预算选服务。第一版保留一个可靠的通用登录入口；+86、微信和 QQ 分批接入，并验证它们都落到同一个内部账号。
