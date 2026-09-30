/**
 * Password policy (Section 4: customers and reps receive a temporary password
 * and must change it on first login).
 *
 * Kept pure so it is unit testable and reusable by both the self service
 * change and any future admin screen.
 */

export interface PasswordPolicyResult {
  ok: boolean;
  /** Arabic, user facing. The first failure only, to keep the form short. */
  message: string | null;
}

const COMMON = ['password', '12345678', 'qwerty123', 'admin123', 'letmein1', 'iloveyou'];

/**
 * Requires length first (the only control that actually works), then rejects
 * the obvious passwords and requires some variety. Never rejects a generated
 * temporary password, which is why `isTemporary` is a parameter: those are
 * handed out by the system and are already high entropy.
 */
export function checkPassword(password: string, isTemporary = false): PasswordPolicyResult {
  if (password.length < 10) {
    return { ok: false, message: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' };
  }
  if (password.length > 128) {
    return { ok: false, message: 'كلمة المرور طويلة جداً' };
  }
  if (isTemporary) {
    return { ok: true, message: null };
  }
  const lower = password.toLowerCase();
  if (COMMON.some((weak) => lower.includes(weak))) {
    return { ok: false, message: 'كلمة المرور شائعة جداً، اختر كلمة مرور أقوى' };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (classes < 3) {
    return {
      ok: false,
      message: 'كلمة المرور يجب أن تجمع بين ثلاثة أنواع على الأقل: أحرف كبيرة وصغيرة وأرقام ورموز',
    };
  }
  return { ok: true, message: null };
}
