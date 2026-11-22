export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Anda tidak memiliki hak akses untuk tindakan ini.") { super("FORBIDDEN", message, 403); }
}
export class NotFoundError extends AppError {
  constructor(message = "Data tidak ditemukan.") { super("NOT_FOUND", message, 404); }
}
export class ValidationError extends AppError {
  constructor(message: string, public fields?: Record<string, string>) { super("VALIDATION", message, 422); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super("CONFLICT", message, 409); }
}
export class AuthError extends AppError {
  constructor(message = "Sesi tidak valid. Silakan login kembali.") { super("UNAUTHENTICATED", message, 401); }
}
