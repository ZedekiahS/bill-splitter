export const loginMessages = {
  'Bill Splitter · 一起记，轻松分': 'Bill Splitter · Share expenses, split easily',
  '一起记，轻松分。': 'Keep track. Share fairly.',
  '和朋友，': 'Good times together.',
  '把每笔小账记清。': 'Every expense sorted.',
  '一次旅行、一顿聚餐、一屋子的日常。': 'For trips, dinners, and everyday life at home.',
  '记录共同开销，看清每个人的份额，慢慢结清。': 'Track shared expenses, see each person’s share, and settle up.',
  '先试着记一笔 →': 'Try adding an expense →',
  '无需注册，先试试一起记账。': 'Try sharing expenses. No sign-up needed.',
  '欢迎回来': 'Welcome back',
  '登录后，继续你们共同的账本。': 'Sign in to pick up where you left off.',
  '邮箱': 'Email',
  '密码': 'Password',
  '登录并继续': 'Sign in and continue',
  '正在登录…': 'Signing in…',
  '注册新账号': 'Create an account',
  '正在注册…': 'Creating account…',
  '已有学校账号': 'Have a school account?',
  '保留原账号入口，方便访问以前的账目。': 'Sign in with your original account to access your earlier expenses.',
  '使用原 Rosefire 账号': 'Use your Rosefire account',
  '请填写邮箱与密码。': 'Enter your email and password.',
  '请填写邮箱与密码，再注册账号。': 'Enter an email and password to create your account.',
  '请输入有效的邮箱地址。': 'Enter a valid email address.',
  '邮箱或密码不正确，请重试。': 'The email or password is incorrect. Try again.',
  '这个邮箱已注册，请直接登录。': 'This email already has an account. Sign in instead.',
  '密码至少需要 6 个字符。': 'Use a password with at least 6 characters.',
  '此账号暂时无法登录，请联系支持。': 'This account cannot sign in. Contact support for help.',
  '尝试次数过多，请稍后再试。': 'Too many attempts. Try again later.',
  '无法连接，请检查网络后重试。': 'Could not connect. Check your connection and try again.',
  '此登录方式暂时不可用，请稍后重试。': 'This sign-in method is unavailable. Try again later.',
  '暂时无法完成操作，请稍后再试。': 'Something went wrong. Try again in a moment.'
};

const authErrors = {
  'auth/invalid-email': '请输入有效的邮箱地址。',
  'auth/invalid-login-credentials': '邮箱或密码不正确，请重试。',
  'auth/invalid-credential': '邮箱或密码不正确，请重试。',
  'auth/user-not-found': '邮箱或密码不正确，请重试。',
  'auth/wrong-password': '邮箱或密码不正确，请重试。',
  'auth/email-already-in-use': '这个邮箱已注册，请直接登录。',
  'auth/weak-password': '密码至少需要 6 个字符。',
  'auth/user-disabled': '此账号暂时无法登录，请联系支持。',
  'auth/too-many-requests': '尝试次数过多，请稍后再试。',
  'auth/network-request-failed': '无法连接，请检查网络后重试。',
  'auth/operation-not-allowed': '此登录方式暂时不可用，请稍后重试。'
};

export function authErrorSource(error) {
  return authErrors[error?.code] || '暂时无法完成操作，请稍后再试。';
}
