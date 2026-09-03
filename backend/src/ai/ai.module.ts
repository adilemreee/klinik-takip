import { Module } from '@nestjs/common';
import type { FetchLike } from './ai-provider';
import { AIController } from './ai.controller';
import { AI_FETCH, AIService } from './ai.service';

/**
 * The AI layer (spec section 3.4, T5.1).
 *
 * Exported rather than global: a module that wants AI should have to say so,
 * because "which parts of this system talk to a model" is a question the
 * specification's red lines make somebody ask.
 */
@Module({
  controllers: [AIController],
  providers: [
    {
      // Wrapped rather than passed by reference: `fetch` needs its own `this`,
      // and the wrapper is also the seam a test replaces.
      provide: AI_FETCH,
      useValue: ((input, init) => globalThis.fetch(input, init)) satisfies FetchLike,
    },
    AIService,
  ],
  exports: [AIService],
})
export class AIModule {}
