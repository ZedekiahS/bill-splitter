const STORAGE_KEY = 'bill-splitter.language';
let language = 'zh-CN';
try { if (globalThis.localStorage?.getItem(STORAGE_KEY) === 'en') language = 'en'; } catch {}

const messages = Object.assign(Object.create(null), {
  'Bill Splitter · 共同账本': 'Bill Splitter · Shared ledgers',
  '跳到主要内容': 'Skip to content', '一起记，轻松分。': 'Keep track. Share fairly.',
  '主导航': 'Main navigation', '移动导航': 'Mobile navigation', '我的账本': 'My ledgers',
  '新建账本': 'New ledger', '正在加载': 'Loading', '账号': 'Account',
  '登录与账号': 'Sign in and account', '当前账本': 'Current ledger', '选择账本': 'Choose a ledger',
  '刷新账本': 'Refresh ledger', '正在打开你的账本…': 'Opening your ledger…',
  '把账记清，把时间留给生活。': 'Less time on bills. More time for life.',
  '暂时没有访问权限。请确认已加入账本，再刷新重试。': 'You do not have access yet. Make sure you have joined the ledger, then refresh.',
  '没有保存成功，请重试。': 'Could not save. Please try again.',
  '网络连接失败，请检查网络后重试。': 'Could not connect. Check your connection and try again.',
  '暂时无法连接账号服务。': 'Could not connect to the account service. Please try again.',
  '金额必须是支持范围内的整数分。': 'Enter a valid amount with up to two decimal places.',
  '请输入最多两位小数的有效数字。': 'Enter a valid number with up to two decimal places.',
  '金额必须为非负数且在支持范围内。': 'Enter zero or a positive amount within the supported range.',
  '金额必须大于零且在支持范围内。': 'Enter an amount greater than zero within the supported range.',
  '金额超出支持范围。': 'This amount is too large.', '请选择有效日期。': 'Choose a valid date.',
  '请选择不同的参与成员。': 'Choose at least one participant without duplicates.',
  '请填写每位参与人的分摊金额，可明确填写 0。': 'Enter an amount for each participant. Enter 0 for anyone who owes nothing.',
  '分摊金额超出支持范围。': 'This share amount is too large.',
  '分摊金额合计不足账单金额，请补齐后保存。': 'The shares are below the expense total. Allocate the remainder before saving.',
  '分摊金额合计超出账单金额，请调整后保存。': 'The shares exceed the expense total. Adjust them before saving.',
  '分摊方式无效。': 'Choose a valid split method.',
  '请填写每位参与人的比例，可明确填写 0。': 'Enter a percentage for each participant. Enter 0 for anyone who owes nothing.',
  '每位成员的比例应在 0–100% 之间。': 'Each percentage must be between 0 and 100%.',
  '比例合计必须大于 0 且不超过 100%。': 'The percentages must total more than 0 and no more than 100%.',
  '账本记录引用了不存在的成员。': 'A member could not be found. Refresh the ledger and try again.',
  '账本合计超出支持范围。': 'The ledger total is too large.',
  '请先使用真实账号登录，再进行此操作。': 'Sign in to your account to continue.',
  '你还不是该账本成员。认领申请须由管理员批准。': 'You have not joined this ledger yet. The owner needs to approve your request.',
  '只有账本管理员可以进行此操作。': 'Only the ledger owner can do this.',
  '只有收款人或账本管理员可以确认或撤销记录。': 'Only the recipient or ledger owner can confirm or reverse a payment.',
  '这笔费用已撤销。': 'This expense has been reversed.',
  '请选择账本中的付款人。': 'Choose a payer from this ledger.',
  '每笔费用最多选择 8 位分摊成员；账本成员数量不受此限制。': 'An expense can be split among up to 8 people. A ledger can have more members.',
  '请选择账本中的参与成员。': 'Choose participants from this ledger.',
  '分摊金额不能超过总额。': 'The shares cannot exceed the total.',
  '确认金额不能超过这位成员尚未偿还的金额。': 'The payment cannot exceed this member’s outstanding amount.',
  '邀请已失效、过期或被认领。': 'This invitation has expired or has already been claimed.',
  '这份邀请已由其他账号认领。': 'This invitation has been claimed by another account.',
  '找不到待审核的认领申请。': 'This request is no longer pending. Refresh the ledger.',
  '成员已绑定账号，或申请人已经加入账本。': 'This member is already linked to an account, or the applicant has already joined.',
  '币种应为三位代码，例如 CNY。': 'Use a three-letter currency code, such as CNY.',
  '只能记录由自己垫付的费用。': 'You can only add expenses you paid for.',
  '费用不存在。': 'This expense could not be found.',
  '这条还款记录不可再次撤销。': 'This payment cannot be reversed again.',
  '请先撤销关联的还款确认，再撤销费用。': 'Reverse the payments linked to this expense before reversing the expense.',
  '只能邀请尚未绑定账号的临时成员。': 'Only members without a linked account can be invited.',
  '你已经是该账本成员。': 'You have already joined this ledger.',
  '记录不存在或已不可访问。': 'This record no longer exists or is unavailable.',
  '当前浏览器无法保存账本，请允许网站存储后重试。': 'Allow website storage in your browser to save this ledger.',
  '{label}不能为空，且不能超过 {max} 个字。': '{label} is required and must be no more than {max} characters.',
  '费用名称': 'Expense name', '账本名称': 'Ledger name', '成员名字': 'Member name', '名字': 'Name', '币种': 'Currency',
  '请填写此项。': 'Please fill out this field.', '请输入有效的邮箱地址。': 'Enter a valid email address.',
  '请输入有效数字。': 'Enter a valid number.', '请按要求填写此项。': 'Please use the requested format.',
  '请输入不少于 {min} 的值。': 'Enter a value of at least {min}.',
  '请输入不大于 {max} 的值。': 'Enter a value no greater than {max}.',
  '请按 {step} 的精度填写。': 'Enter a value in increments of {step}.'
});

export function registerMessages(entries) { Object.assign(messages, entries); }
export function getLanguage() { return language; }
export function t(source, values = {}) {
  const template = language === 'en' && Object.hasOwn(messages, source) ? messages[source] : source;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export function setLanguage(next) {
  if (!['zh-CN', 'en'].includes(next)) return;
  language = next;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, next); } catch {}
  if (globalThis.document) {
    translatePage();
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { language } }));
  }
}
export function translatePage(root = document) {
  if (globalThis.document) document.documentElement.lang = language;
  for (const attribute of ['text', 'placeholder', 'aria-label', 'title']) {
    const key = attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`;
    const nodes = [...root.querySelectorAll(`[${key}]`)];
    if (root.matches?.(`[${key}]`)) nodes.unshift(root);
    for (const node of nodes) {
      const value = t(node.getAttribute(key));
      if (attribute === 'text') node.textContent = value;
      else node.setAttribute(attribute, value);
    }
  }
  const picker = root.querySelector('#language-picker');
  if (picker) picker.value = language;
}
export function formatDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value || '');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
export function translateError(error) {
  const message = error?.message || String(error || '');
  if (/permission-denied|Missing or insufficient permissions/i.test(`${error?.code} ${message}`)) return t('暂时没有访问权限。请确认已加入账本，再刷新重试。');
  if (/network-request-failed|unavailable|Failed to fetch/i.test(`${error?.code} ${message}`)) return t('网络连接失败，请检查网络后重试。');
  if (message === '浏览器不支持本地演示存储。' || error?.name === 'QuotaExceededError') return t('当前浏览器无法保存账本，请允许网站存储后重试。');
  if (message === 'Firebase 尚未配置，请使用演示模式或配置真实服务。') return t('暂时无法连接账号服务。');
  const field = /^(费用名称|账本名称|成员名字|币种|名字)不能为空，且不能超过 (\d+) 个字。$/.exec(message);
  if (field) return t('{label}不能为空，且不能超过 {max} 个字。', { label: t(field[1]), max: field[2] });
  return Object.hasOwn(messages, message) ? t(message) : t('没有保存成功，请重试。');
}

// Keep browser validation in the selected product language without changing input values.
if (globalThis.document) {
  const customized = new Set();
  document.addEventListener('invalid', event => {
    const input = event.target, validity = input.validity;
    if (!validity || validity.customError) return;
    const message = validity.valueMissing ? t('请填写此项。')
      : validity.typeMismatch && input.type === 'email' ? t('请输入有效的邮箱地址。')
      : validity.badInput ? t('请输入有效数字。')
      : validity.rangeUnderflow ? t('请输入不少于 {min} 的值。', { min: input.min })
      : validity.rangeOverflow ? t('请输入不大于 {max} 的值。', { max: input.max })
      : validity.stepMismatch ? t('请按 {step} 的精度填写。', { step: input.step })
      : t('请按要求填写此项。');
    input.setCustomValidity(message); customized.add(input);
  }, true);
  document.addEventListener('input', event => {
    if (customized.delete(event.target)) event.target.setCustomValidity('');
  });
  document.addEventListener('languagechange', () => {
    for (const input of customized) input.setCustomValidity('');
    customized.clear();
  });
}
