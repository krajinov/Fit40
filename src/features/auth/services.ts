import { GetCurrentUserUseCase } from '@/application/use-cases/get-current-user';
import { LoginUserUseCase } from '@/application/use-cases/login-user';
import { LogoutUserUseCase } from '@/application/use-cases/logout-user';
import { RegisterUserUseCase } from '@/application/use-cases/register-user';
import { Argon2PasswordHasher } from '@/infrastructure/auth/argon2-password-hasher';
import { sessionRepository, userRepository } from '@/infrastructure/database/repositories';

const passwordHasher = new Argon2PasswordHasher();

export const registerUserUseCase = new RegisterUserUseCase(
  userRepository,
  sessionRepository,
  passwordHasher,
);

export const loginUserUseCase = new LoginUserUseCase(
  userRepository,
  sessionRepository,
  passwordHasher,
);

export const logoutUserUseCase = new LogoutUserUseCase(sessionRepository);

export const getCurrentUserUseCase = new GetCurrentUserUseCase(userRepository, sessionRepository);
