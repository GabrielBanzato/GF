// Login por e-mail + senha, sessões por aparelho e recuperação de senha por código.

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const PASSWORD_MIN = 8;
export const SESSION_IDLE_MS = 180 * 24 * 3600_000; // sessão expira após 180 dias sem uso
export const RESET_CODE_TTL_MS = 15 * 60_000;
export const RESET_MAX_ATTEMPTS = 5;

export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const newResetCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar quem tem conta. */
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

/** Limite simples em memória: N tentativas por chave dentro de uma janela. */
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.start > windowMs) return false;
      return h.count >= max;
    },
    hit(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.start > windowMs) hits.set(key, { start: Date.now(), count: 1 });
      else h.count++;
      if (hits.size > 10_000) for (const [k, v] of hits) if (Date.now() - v.start > windowMs) hits.delete(k);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

const RESET_EMAIL = {
  pt: { subject: 'Seu código para redefinir a senha', body: (n, c, m) => `Olá${n ? `, ${n}` : ''}!\n\nSeu código para redefinir a senha é: ${c}\n\nEle vale por ${m} minutos. Se não foi você, ignore este e-mail.` },
  en: { subject: 'Your password reset code', body: (n, c, m) => `Hi${n ? ` ${n}` : ''}!\n\nYour password reset code is: ${c}\n\nIt is valid for ${m} minutes. If this wasn't you, ignore this email.` },
  es: { subject: 'Tu código para restablecer la contraseña', body: (n, c, m) => `¡Hola${n ? `, ${n}` : ''}!\n\nTu código para restablecer la contraseña es: ${c}\n\nEs válido por ${m} minutos. Si no fuiste tú, ignora este correo.` },
};

/**
 * Envia o código de recuperação. Usa a API do Resend se RESEND_API_KEY estiver
 * configurada; caso contrário, escreve o código no log do servidor (útil em testes).
 */
export async function sendResetEmail({ to, name, code, language, assistantName }) {
  const lang = RESET_EMAIL[String(language).slice(0, 2)] ? String(language).slice(0, 2) : 'pt';
  const t = RESET_EMAIL[lang];
  const subject = `${assistantName} — ${t.subject}`;
  const text = t.body(name, code, Math.round(RESET_CODE_TTL_MS / 60_000));
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.log(`[reset] RESEND_API_KEY não configurada. Código para ${to}: ${code}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || `${assistantName} <onboarding@resend.dev>`, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
