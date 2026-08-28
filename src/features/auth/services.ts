import { GetCurrentUserUseCase } from '@/application/use-cases/get-current-user';
import { LoginUserUseCase } from '@/application/use-cases/login-user';
import { LogoutUserUseCase } from '@/application/use-cases/logout-user';
import { RegisterUserUseCase } from '@/application/use-cases/register-user';
import { Argon2PasswordHasher } from '@/infrastructure/auth/argon2-password-hasher';
import {
  NodeIdGenerator,
} from '@/infrastructure/crypto/node-id-generator';
import { NodeSessionTokenService } from '@/infrastructure/crypto/node-session-token-service';
import {
  registrationRepository,
  sessionRepository,
  userRepository,
} from '@/infrastructure/database/repositories';

const passwordHasher = new Argon2PasswordHasher();
const idGenerator = new NodeIdGenerator();
const tokenService = new NodeSessionTokenService();

export const registerUserUseCase = new RegisterUserUseCase(
  userRepository,
  registrationRepository,
  passwordHasher,
  idGenerator,
  tokenService,
);

export const loginUserUseCase = new LoginUserUseCase(
  userRepository,
  sessionRepository,
  passwordHasher,
  tokenService,
);

export const logoutUserUseCase = new LogoutUserUseCase(sessionRepository, tokenService);

export const getCurrentUserUseCase = new GetCurrentUserUseCase(
  userRepository,
  sessionRepository,
  tokenService,
);
