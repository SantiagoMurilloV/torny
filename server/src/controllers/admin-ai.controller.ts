import type { Request, Response, NextFunction } from 'express';
import { chatWithAdminContext, type AdminChatMessage } from '../services/admin-ai.service';

export async function adminChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: 'No autorizado' });
      return;
    }
    const { messages, currentPage } = req.body as {
      messages?: AdminChatMessage[];
      currentPage?: string;
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ message: '"messages" es requerido' });
      return;
    }
    const result = await chatWithAdminContext(userId, messages.slice(-16), currentPage);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
