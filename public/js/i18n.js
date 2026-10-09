const STRINGS = {
  pt: {
    tapToTalk: 'Toque para falar', listening: 'Ouvindo…', thinking: 'Pensando…', speaking: 'Falando…',
    transcribing: 'Entendendo o áudio…', preparingVoice: 'Preparando a voz…', queued: 'Na fila ({n} na frente)…',
    goodMorning: 'Bom dia', goodAfternoon: 'Boa tarde', goodEvening: 'Boa noite', greetName: '{greet}, {name}',
    hints: 'Fala Midas, o João me deve 200 reais até sexta|Desconta 50 da conta da Ana, ela me pagou ontem|Quanto o Pedro ainda me deve?|Eu devo 80 reais pro Carlos|Apaga o último lançamento',
    tagline: 'Seu dinheiro, na ponta da língua.', profile: 'Perfil', security: 'Conta e segurança', people: 'Pessoas', newEntry: 'Novo lançamento', owesYou: 'te deve', youOwe: 'você deve',
    appleIntelligenceOff: 'Ative a Apple Intelligence em Ajustes para falar com o Midas.', deviceNotSupported: 'O Midas precisa de um iPhone com Apple Intelligence (iPhone 15 Pro ou mais novo).',
    didntHear: 'Não ouvi nada. Toque e fale de novo.', micDenied: 'Permita o uso do microfone para falar comigo.',
    offlineTalk: 'Sem conexão. Use o lápis para registrar offline — eu sincronizo quando a conexão voltar.',
    aiOff: 'A IA ainda não está configurada no servidor.', genericError: 'Algo deu errado. Tente de novo.',
    settings: 'Configurações', name: 'Nome', email: 'E-mail',
    currency: 'Moeda', language: 'Idioma', auto: 'Automático', save: 'Salvar', saved: 'Salvo',
    dangerZone: 'Zona de perigo', deleteAccount: 'Deletar conta',
    deleteWarn: 'Isso apaga sua conta, todo o histórico e a planilha do servidor. Não dá para desfazer.',
    deleteType: 'Digite {phrase} para confirmar', deletePhrase: 'DELETAR', deleteConfirm: 'Deletar definitivamente',
    welcome: 'Olá! Eu sou {ai}.', welcomeSub: 'Me diga quem te deve e quanto. Eu cuido do resto.', start: 'Começar',
    ledger: 'Controle financeiro', synced: 'Sincronizado {when}', notSynced: 'Ainda não sincronizado',
    offlinePending: 'Offline · {n} alteração(ões) aguardando', onlinePending: '{n} alteração(ões) enviando…',
    serverDown: 'Servidor indisponível · trabalhando offline',
    toReceive: 'A receber', toPay: 'A pagar', empty: 'Nenhum registro ainda.',
    person: 'Pessoa', amount: 'Valor', type: 'Tipo', date: 'Data', due: 'Vencimento (opcional)', note: 'Observação (opcional)',
    t_debt_in: 'Me deve', t_debt_out: 'Eu devo', t_payment_in: 'Recebi', t_payment_out: 'Paguei',
    add: 'Adicionar', download: 'Baixar planilha (.xlsx)', backupAt: 'Backup no aparelho: {when}', noBackup: 'Sem backup local ainda',
    removeEntry: 'Remover este lançamento?', overdue: 'atrasado', dueOn: 'vence {date}', settled: 'quitado',
    close: 'Fechar', justNow: 'agora', minutesAgo: 'há {n} min', at: 'às {time}',
    login: 'Entrar', register: 'Criar conta', password: 'Senha', newPassword: 'Nova senha', currentPassword: 'Senha atual',
    passwordHint: 'Senha (mínimo {n} caracteres)', code: 'Código recebido por e-mail', sendCode: 'Enviar código',
    resetPassword: 'Redefinir senha', forgotPassword: 'Esqueci minha senha', back: 'Voltar',
    loginSub: 'Entre para continuar de onde parou.', forgotSub: 'Informe seu e-mail. Se houver uma conta, enviaremos um código de 6 dígitos.',
    resetSub: 'Digite o código que enviamos para {email} e escolha uma nova senha.',
    changePassword: 'Alterar senha', passwordChanged: 'Senha alterada. Outros aparelhos precisarão entrar de novo.', logout: 'Sair da conta',
    unsyncedLogout: 'Há {n} alteração(ões) ainda não sincronizada(s) que serão perdidas. Sair mesmo assim?',
    sessionExpired: 'Sua sessão expirou. Entre de novo — seus dados locais serão enviados.',
    err_invalid_credentials: 'E-mail ou senha incorretos.', err_email_taken: 'Já existe uma conta com este e-mail.',
    err_weak_password: 'A senha precisa ter pelo menos {n} caracteres.', err_invalid_code: 'Código inválido ou expirado.',
    err_too_many_attempts: 'Muitas tentativas. Espere alguns minutos.', err_email_failed: 'Não foi possível enviar o e-mail agora.',
    err_name_required: 'Informe seu nome.', err_invalid_email: 'E-mail inválido.',
  },
  en: {
    tapToTalk: 'Tap to talk', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…',
    transcribing: 'Understanding the audio…', preparingVoice: 'Preparing the voice…', queued: 'In line ({n} ahead)…',
    goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening', greetName: '{greet}, {name}',
    hints: 'Hey Midas, John owes me 200 by Friday|Take 50 off Anna, she paid me yesterday|How much does Peter still owe me?|I owe Carlos 80 dollars|Delete the last entry',
    tagline: 'Your money, at the tip of your tongue.', profile: 'Profile', security: 'Account & security', people: 'People', newEntry: 'New entry', owesYou: 'owes you', youOwe: 'you owe',
    appleIntelligenceOff: 'Turn on Apple Intelligence in Settings to talk to Midas.', deviceNotSupported: 'Midas needs an iPhone with Apple Intelligence (iPhone 15 Pro or newer).',
    didntHear: "I didn't hear anything. Tap and try again.", micDenied: 'Allow microphone access to talk to me.',
    offlineTalk: "You're offline. Use the pencil to log changes — I'll sync when you're back.",
    aiOff: 'The AI is not configured on the server yet.', genericError: 'Something went wrong. Try again.',
    settings: 'Settings', name: 'Name', email: 'Email',
    currency: 'Currency', language: 'Language', auto: 'Automatic', save: 'Save', saved: 'Saved',
    dangerZone: 'Danger zone', deleteAccount: 'Delete account',
    deleteWarn: 'This deletes your account, all history and the server spreadsheet. It cannot be undone.',
    deleteType: 'Type {phrase} to confirm', deletePhrase: 'DELETE', deleteConfirm: 'Delete permanently',
    welcome: "Hi! I'm {ai}.", welcomeSub: "Tell me who owes you and how much. I'll handle the rest.", start: 'Get started',
    ledger: 'Financial control', synced: 'Synced {when}', notSynced: 'Not synced yet',
    offlinePending: 'Offline · {n} change(s) waiting', onlinePending: 'Sending {n} change(s)…',
    serverDown: 'Server unavailable · working offline',
    toReceive: 'To receive', toPay: 'To pay', empty: 'No records yet.',
    person: 'Person', amount: 'Amount', type: 'Type', date: 'Date', due: 'Due date (optional)', note: 'Note (optional)',
    t_debt_in: 'Owes me', t_debt_out: 'I owe', t_payment_in: 'Received', t_payment_out: 'Paid',
    add: 'Add', download: 'Download spreadsheet (.xlsx)', backupAt: 'On-device backup: {when}', noBackup: 'No local backup yet',
    removeEntry: 'Remove this entry?', overdue: 'overdue', dueOn: 'due {date}', settled: 'settled',
    close: 'Close', justNow: 'just now', minutesAgo: '{n} min ago', at: 'at {time}',
    login: 'Sign in', register: 'Create account', password: 'Password', newPassword: 'New password', currentPassword: 'Current password',
    passwordHint: 'Password (at least {n} characters)', code: 'Code from the email', sendCode: 'Send code',
    resetPassword: 'Reset password', forgotPassword: 'Forgot my password', back: 'Back',
    loginSub: 'Sign in to pick up where you left off.', forgotSub: "Enter your email. If there's an account, we'll send a 6-digit code.",
    resetSub: 'Enter the code we sent to {email} and choose a new password.',
    changePassword: 'Change password', passwordChanged: 'Password changed. Other devices will need to sign in again.', logout: 'Sign out',
    unsyncedLogout: '{n} change(s) are not synced yet and will be lost. Sign out anyway?',
    sessionExpired: 'Your session expired. Sign in again — your local data will be uploaded.',
    err_invalid_credentials: 'Wrong email or password.', err_email_taken: 'An account with this email already exists.',
    err_weak_password: 'The password needs at least {n} characters.', err_invalid_code: 'Invalid or expired code.',
    err_too_many_attempts: 'Too many attempts. Wait a few minutes.', err_email_failed: "Couldn't send the email right now.",
    err_name_required: 'Enter your name.', err_invalid_email: 'Invalid email.',
  },
  es: {
    tapToTalk: 'Toca para hablar', listening: 'Escuchando…', thinking: 'Pensando…', speaking: 'Hablando…',
    transcribing: 'Entendiendo el audio…', preparingVoice: 'Preparando la voz…', queued: 'En fila ({n} delante)…',
    goodMorning: 'Buenos días', goodAfternoon: 'Buenas tardes', goodEvening: 'Buenas noches', greetName: '{greet}, {name}',
    hints: 'Oye Midas, Juan me debe 200 hasta el viernes|Descuenta 50 a Ana, me pagó ayer|¿Cuánto me debe todavía Pedro?|Le debo 80 a Carlos|Borra el último movimiento',
    tagline: 'Tu dinero, en la punta de la lengua.', profile: 'Perfil', security: 'Cuenta y seguridad', people: 'Personas', newEntry: 'Nuevo movimiento', owesYou: 'te debe', youOwe: 'le debes',
    appleIntelligenceOff: 'Activa Apple Intelligence en Ajustes para hablar con Midas.', deviceNotSupported: 'Midas necesita un iPhone con Apple Intelligence (iPhone 15 Pro o posterior).',
    didntHear: 'No escuché nada. Toca y habla de nuevo.', micDenied: 'Permite el micrófono para hablar conmigo.',
    offlineTalk: 'Sin conexión. Usa el lápiz para registrar — sincronizo cuando vuelva la conexión.',
    aiOff: 'La IA aún no está configurada en el servidor.', genericError: 'Algo salió mal. Inténtalo de nuevo.',
    settings: 'Ajustes', name: 'Nombre', email: 'Correo',
    currency: 'Moneda', language: 'Idioma', auto: 'Automático', save: 'Guardar', saved: 'Guardado',
    dangerZone: 'Zona de peligro', deleteAccount: 'Eliminar cuenta',
    deleteWarn: 'Esto borra tu cuenta, todo el historial y la planilla del servidor. No se puede deshacer.',
    deleteType: 'Escribe {phrase} para confirmar', deletePhrase: 'ELIMINAR', deleteConfirm: 'Eliminar definitivamente',
    welcome: '¡Hola! Soy {ai}.', welcomeSub: 'Dime quién te debe y cuánto. Yo me encargo del resto.', start: 'Empezar',
    ledger: 'Control financiero', synced: 'Sincronizado {when}', notSynced: 'Aún no sincronizado',
    offlinePending: 'Sin conexión · {n} cambio(s) en espera', onlinePending: 'Enviando {n} cambio(s)…',
    serverDown: 'Servidor no disponible · trabajando sin conexión',
    toReceive: 'Por cobrar', toPay: 'Por pagar', empty: 'Aún no hay registros.',
    person: 'Persona', amount: 'Importe', type: 'Tipo', date: 'Fecha', due: 'Vencimiento (opcional)', note: 'Nota (opcional)',
    t_debt_in: 'Me debe', t_debt_out: 'Le debo', t_payment_in: 'Cobré', t_payment_out: 'Pagué',
    add: 'Añadir', download: 'Descargar planilla (.xlsx)', backupAt: 'Copia en el dispositivo: {when}', noBackup: 'Sin copia local aún',
    removeEntry: '¿Eliminar este movimiento?', overdue: 'atrasado', dueOn: 'vence {date}', settled: 'saldado',
    close: 'Cerrar', justNow: 'ahora', minutesAgo: 'hace {n} min', at: 'a las {time}',
    login: 'Entrar', register: 'Crear cuenta', password: 'Contraseña', newPassword: 'Nueva contraseña', currentPassword: 'Contraseña actual',
    passwordHint: 'Contraseña (mínimo {n} caracteres)', code: 'Código recibido por correo', sendCode: 'Enviar código',
    resetPassword: 'Restablecer contraseña', forgotPassword: 'Olvidé mi contraseña', back: 'Volver',
    loginSub: 'Entra para seguir donde lo dejaste.', forgotSub: 'Escribe tu correo. Si hay una cuenta, enviaremos un código de 6 dígitos.',
    resetSub: 'Escribe el código que enviamos a {email} y elige una nueva contraseña.',
    changePassword: 'Cambiar contraseña', passwordChanged: 'Contraseña cambiada. Los otros dispositivos deberán entrar de nuevo.', logout: 'Cerrar sesión',
    unsyncedLogout: 'Hay {n} cambio(s) sin sincronizar que se perderán. ¿Salir de todos modos?',
    sessionExpired: 'Tu sesión expiró. Entra de nuevo — tus datos locales se enviarán.',
    err_invalid_credentials: 'Correo o contraseña incorrectos.', err_email_taken: 'Ya existe una cuenta con este correo.',
    err_weak_password: 'La contraseña necesita al menos {n} caracteres.', err_invalid_code: 'Código inválido o vencido.',
    err_too_many_attempts: 'Demasiados intentos. Espera unos minutos.', err_email_failed: 'No se pudo enviar el correo ahora.',
    err_name_required: 'Escribe tu nombre.', err_invalid_email: 'Correo inválido.',
  },
};

export const LANGUAGE_OPTIONS = [
  ['auto', null], ['pt', 'Português'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['it', 'Italiano'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'],
];

export const CURRENCY_OPTIONS = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'MXN', 'CLP', 'COP', 'CAD', 'AUD', 'CHF', 'JPY', 'CNY'];

let lang = 'pt';

export function setLanguage(preference) {
  const wanted = preference && preference !== 'auto' ? preference : (navigator.language || 'pt').slice(0, 2);
  lang = STRINGS[wanted] ? wanted : 'en';
  document.documentElement.lang = lang;
}

export const uiLanguage = () => lang;

/** Locale para fala/formatos: preferência explícita ou a do aparelho. */
export function speechLocale(preference) {
  if (preference && preference !== 'auto') {
    const map = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };
    return map[preference] || preference;
  }
  return navigator.language || 'pt-BR';
}

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
