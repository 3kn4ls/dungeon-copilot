import { z } from 'zod';

/** Nombre de usuario: se guarda en minúsculas para que "Edu" y "edu" sean la misma cuenta. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El nombre de usuario necesita al menos 3 caracteres')
  .max(32, 'El nombre de usuario no puede pasar de 32 caracteres')
  .regex(/^[a-z0-9_.-]+$/, 'Solo letras sin tildes, números, punto, guion y guion bajo');

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña necesita al menos 8 caracteres')
  .max(200, 'La contraseña no puede pasar de 200 caracteres');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Pon el nombre que verán los demás')
  .max(60, 'El nombre no puede pasar de 60 caracteres');

export const registerRequestSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Escribe tu nombre de usuario'),
  password: z.string().min(1, 'Escribe tu contraseña'),
});

export type LoginRequest = z.input<typeof loginRequestSchema>;

/** Lo que se muestra de un usuario a los demás. Nunca incluye la contraseña. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthResponse {
  user: PublicUser;
}

export interface MeResponse {
  /** null si no hay sesión iniciada. */
  user: PublicUser | null;
  /** Si se pueden crear cuentas nuevas en este servidor. */
  registrationOpen: boolean;
}
