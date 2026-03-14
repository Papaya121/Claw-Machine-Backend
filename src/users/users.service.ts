import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { User } from '../common/domain.types';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

@Injectable()
export class UsersService {
  constructor(private readonly db: InMemoryDatabaseService) {}

  getOrCreateByTelegramUserId(telegramUserId: string): User {
    const existingId = this.db.usersByTelegramId.get(telegramUserId);
    if (existingId) {
      const existing = this.db.users.get(existingId);
      if (!existing) {
        throw new NotFoundException('User map is inconsistent');
      }
      return existing;
    }

    const now = Date.now();
    const user: User = {
      id: randomUUID(),
      telegramUserId,
      createdAt: now,
      updatedAt: now,
    };

    this.db.users.set(user.id, user);
    this.db.usersByTelegramId.set(telegramUserId, user.id);
    return user;
  }

  getById(userId: string): User {
    const user = this.db.users.get(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
