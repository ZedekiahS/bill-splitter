import { t, getLanguage, setLanguage, registerMessages, translatePage } from './i18n.mjs';
import { loginMessages, authErrorSource } from './login-messages.mjs';

registerMessages(loginMessages);
window.billSplitterLogin = { t, authError: authErrorSource };

const picker = document.querySelector('#language-picker');
function renderLanguage() {
  translatePage();
  document.title = t('Bill Splitter · 一起记，轻松分');
  if (picker) picker.value = getLanguage();
}

picker?.addEventListener('change', () => setLanguage(picker.value));
document.addEventListener('languagechange', renderLanguage);
renderLanguage();
