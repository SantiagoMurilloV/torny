import type { Request, Response, NextFunction } from 'express';
import { chatWithDeepSeek, type ChatMessage } from '../services/deepseek.service';

export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { messages, formState } = req.body as {
      messages?: ChatMessage[];
      formState?: Record<string, unknown>;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ message: '"messages" es requerido' });
      return;
    }
    for (const m of messages) {
      if (!['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
        res.status(400).json({ message: 'Formato de mensaje inválido' });
        return;
      }
    }

    const result = await chatWithDeepSeek(messages, formState ?? {});
    res.json(result);
  } catch (err) {
    next(err);
  }
}
