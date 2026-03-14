import type { Request } from 'express';
import type { AuthUserContext } from './domain.types';

export interface AuthenticatedRequest extends Request {
  authUser: AuthUserContext;
}
