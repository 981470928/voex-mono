export const characterCount = (value: string) => Array.from(value).length;

export function accountError(value: string) {
  const length = characterCount(value);
  return length < 8 || length > 64 ? '账号需要 8–64 个字符，支持中文、字母、数字和符号' : '';
}

export function passwordError(value: string) {
  const length = characterCount(value);
  return length < 10 || length > 128 ? '密码需要 10–128 个字符' : '';
}

export function profileErrors(input: { name: string; email: string; phone: string }) {
  return {
    name:
      !input.name.trim() || characterCount(input.name.trim()) > 64
        ? '请输入 1–64 个字符的昵称'
        : '',
    email:
      input.email &&
      (characterCount(input.email) > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
        ? '请输入有效的邮箱地址，最多 254 个字符'
        : '',
    phone:
      input.phone && !/^\+?[0-9 ()-]{5,32}$/.test(input.phone)
        ? '手机号需要 5–32 个字符，可包含数字、空格、括号、短横线及开头的 +'
        : '',
  };
}

export function passwordStrength(value: string) {
  if (!value) return { level: 0, label: '至少 10 个字符；更长且不重复的密码更安全' };
  const length = characterCount(value);
  const unique = new Set(Array.from(value)).size;
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u, /\P{ASCII}/u].filter((re) =>
    re.test(value)
  ).length;
  const level = length < 10 || unique < 5 ? 1 : length >= 16 && unique >= 10 && kinds >= 2 ? 3 : 2;
  return {
    level,
    label: [
      '',
      '强度较弱 · 增加长度，避免连续或重复字符',
      '强度适中 · 可以使用更长的密码',
      '强度较强',
    ][level]!,
  };
}

export function safeReturnPath(value: unknown) {
  return typeof value === 'string' &&
    /^\/(?!\/)/.test(value) &&
    !value.includes('\\') &&
    !Array.from(value).some((character) => character.codePointAt(0)! < 32) &&
    !/^\/(login|register)(?:[/?#]|$)/.test(value)
    ? value
    : '/home';
}

export function avatorFileError(file: File) {
  if (file.size === 0) return '头像文件为空，请重新选择';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return '头像仅支持 JPEG、PNG 或 WebP';
  if (file.size > 5 * 1024 * 1024) return '头像不能超过 5 MiB';
  return '';
}
