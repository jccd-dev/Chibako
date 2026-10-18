export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 1024;

// A small local blocklist; this does not claim to detect all breached passwords.
const COMMON_PASSWORDS = new Set([
  "123456789012345", "1234567890123456", "12345678901234567890",
  "passwordpassword", "password123456789", "qwertyuiopasdfgh", "letmeinletmeinletmein",
]);

export function getNewPasswordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Choose a less common password.";
  }
  return null;
}
