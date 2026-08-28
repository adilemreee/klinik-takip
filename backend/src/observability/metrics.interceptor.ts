import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { httpRequestDuration } from './metrics';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const stopTimer = httpRequestDuration.startTimer();

    // Express types `route` as any; narrow it rather than letting an untyped
    // value flow into a metric label.
    const matchedRoute = (request.route as { path?: string } | undefined)?.path ?? 'unknown';

    const record = (): void => {
      stopTimer({
        method: request.method,
        // The matched route pattern ('/patients/:id'), falling back to 'unknown'
        // rather than the concrete URL — see the note on cardinality in metrics.ts.
        route: matchedRoute,
        status_code: response.statusCode,
      });
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
